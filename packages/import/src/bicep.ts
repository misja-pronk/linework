// Bicep source → the ARM template `az bicep build` would write, so the Azure importer reads it as it
// reads a compiled template (azure-arm.ts): no compiler, no Azure CLI. Parameters with their defaults,
// variables, resources (`parent:`, nested children, `existing`, conditions, `[for …]` loops), modules
// (the file they name, compiled too, with what they are given and what they give back) and outputs.
// Expressions become ARM expressions: x.id is resourceInfo('x').id, a module's outputs are its
// deployment's, '${a}-b' is format(). What cannot be written as one is named, not guessed.
import { isObj, type Obj } from './keep.ts';

type Tok = { t: 'id' | 'str' | 'num' | 'punct' | 'nl' | 'eof'; v: string; parts?: (string | Tok[])[]; line: number };

export class BicepError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

const PUNCT = ['??', '?.', '==', '!=', '<=', '>=', '&&', '||', '=>', '::', '{', '}', '[', ']', '(', ')', ',', ':', '.', '?', '!', '=', '<', '>', '+', '-', '*', '/', '%', '@'];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let line = 1;
  let i = 0;
  const s = src.replace(/\r\n?/g, '\n');
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\n') {
      out.push({ t: 'nl', v: '\n', line });
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (s.startsWith('//', i)) while (i < s.length && s[i] !== '\n') i++;
    else if (s.startsWith('/*', i)) {
      const end = s.indexOf('*/', i + 2);
      const body = s.slice(i, end < 0 ? s.length : end + 2);
      line += body.split('\n').length - 1;
      i += body.length;
    } else if (s.startsWith("'''", i)) {
      const end = s.indexOf("'''", i + 3);
      const body = s.slice(i + 3, end < 0 ? s.length : end);
      out.push({ t: 'str', v: body.replace(/^\n/, ''), parts: [body.replace(/^\n/, '')], line });
      line += body.split('\n').length - 1;
      i = end < 0 ? s.length : end + 3;
    } else if (c === "'") {
      // A string, with ${…} inside: each hole lexed on its own.
      const parts: (string | Tok[])[] = [];
      let text = '';
      i++;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\') {
          const e = s[i + 1]!;
          text += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          i += 2;
        } else if (s.startsWith('${', i)) {
          let depth = 1;
          let j = i + 2;
          for (; j < s.length && depth; j++) {
            if (s[j] === '{') depth++;
            else if (s[j] === '}') depth--;
            else if (s[j] === "'") {
              // A string inside the hole.
              for (j++; j < s.length && s[j] !== "'"; j++) if (s[j] === '\\') j++;
            }
          }
          if (text) parts.push(text);
          text = '';
          parts.push(lex(s.slice(i + 2, j - 1)).filter((t) => t.t !== 'eof' && t.t !== 'nl'));
          i = j;
        } else text += s[i++];
      }
      i++;
      if (text || !parts.length) parts.push(text);
      out.push({ t: 'str', v: parts.filter((p) => typeof p === 'string').join(''), parts, line });
    } else if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(s.slice(i))![0];
      out.push({ t: 'num', v: m, line });
      i += m.length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(s.slice(i))![0];
      out.push({ t: 'id', v: m, line });
      i += m.length;
    } else {
      const p = PUNCT.find((x) => s.startsWith(x, i));
      if (!p) throw new BicepError(`cannot read "${c}"`, line);
      out.push({ t: 'punct', v: p, line });
      i += p.length;
    }
  }
  out.push({ t: 'eof', v: '', line });
  return out;
}

// ---------------------------------------------------------------- the tree

export type E =
  | { k: 'str'; parts: (string | E)[] }
  | { k: 'num'; v: number }
  | { k: 'lit'; v: boolean | null }
  | { k: 'id'; name: string }
  | { k: 'obj'; props: [string | E, E][]; children: Decl[] }
  | { k: 'arr'; items: E[] }
  | { k: 'for'; item: string; index?: string; src: E; cond?: E; body: E }
  | { k: 'if'; cond: E; body: E }
  | { k: 'call'; name: string; args: E[] }
  | { k: 'member'; of: E; name: string }
  | { k: 'index'; of: E; at: E }
  | { k: 'un'; op: string; e: E }
  | { k: 'bin'; op: string; a: E; b: E }
  | { k: 'tern'; c: E; a: E; b: E }
  | { k: 'lambda' };

export type Decl =
  | { k: 'param'; name: string; type: string; value?: E; line: number }
  | { k: 'var'; name: string; value: E; line: number }
  | { k: 'resource'; name: string; type: string; existing: boolean; value: E; line: number }
  | { k: 'module'; name: string; path: string; value: E; line: number }
  | { k: 'output'; name: string; type: string; value: E; line: number }
  | { k: 'scope'; value: string; line: number }
  | { k: 'using'; path: string; line: number }
  | { k: 'other'; what: string; line: number };

const BIN: [string[], number][] = [[['??'], 1], [['||'], 2], [['&&'], 3], [['==', '!=', '=~', '!~'], 4], [['<', '>', '<=', '>='], 5], [['+', '-'], 6], [['*', '/', '%'], 7]];

class Parser {
  i = 0;
  constructor(readonly ts: Tok[]) {}
  get tok() {
    return this.ts[this.i]!;
  }
  next() {
    return this.ts[this.i++]!;
  }
  is(v: string) {
    return this.tok.t === 'punct' && this.tok.v === v;
  }
  eat(v: string) {
    if (!this.is(v)) throw new BicepError(`expected "${v}", found "${this.tok.v || 'the end'}"`, this.tok.line);
    this.i++;
  }
  skipNl() {
    while (this.tok.t === 'nl') this.i++;
  }

  file(): Decl[] {
    const out: Decl[] = [];
    for (;;) {
      this.skipNl();
      if (this.tok.t === 'eof') return out;
      // Decorators: @description('…'), @allowed([…]), @secure().
      while (this.is('@')) {
        this.i++;
        this.expr();
        this.skipNl();
      }
      out.push(this.decl());
    }
  }

  decl(): Decl {
    const t = this.next();
    const line = t.line;
    const word = t.v;
    if (t.t !== 'id') throw new BicepError(`unexpected "${t.v}"`, line);
    if (word === 'targetScope') {
      this.eat('=');
      const v = this.expr();
      return { k: 'scope', value: v.k === 'str' ? v.parts.join('') : 'resourceGroup', line };
    }
    if (word === 'using') return { k: 'using', path: this.string(), line };
    if (word === 'param' || word === 'output') {
      const name = this.next().v;
      // param env = 'prod' (a .bicepparam file) has no type.
      let type = '';
      if (!this.is('=')) type = this.typeExpr();
      let value: E | undefined;
      if (this.is('=')) {
        this.i++;
        value = this.expr();
      }
      if (word === 'output') return { k: 'output', name, type, value: value ?? { k: 'lit', v: null }, line };
      return { k: 'param', name, type, value, line };
    }
    if (word === 'var') {
      const name = this.next().v;
      this.eat('=');
      return { k: 'var', name, value: this.expr(), line };
    }
    if (word === 'resource') {
      const name = this.next().v;
      const type = this.string();
      let existing = false;
      if (this.tok.t === 'id' && this.tok.v === 'existing') ((existing = true), this.i++);
      this.eat('=');
      return { k: 'resource', name, type, existing, value: this.expr(), line };
    }
    if (word === 'module') {
      const name = this.next().v;
      const path = this.string();
      this.eat('=');
      return { k: 'module', name, path, value: this.expr(), line };
    }
    // import, type, func, metadata, extension, assert: read past the line (and what it opens).
    this.restOfStatement();
    return { k: 'other', what: word, line };
  }

  restOfStatement() {
    let depth = 0;
    while (this.tok.t !== 'eof' && !(this.tok.t === 'nl' && depth === 0)) {
      if (this.is('{') || this.is('[') || this.is('(')) depth++;
      if (this.is('}') || this.is(']') || this.is(')')) depth--;
      this.i++;
    }
  }

  typeExpr(): string {
    // string, int, bool, object, array, a user type, string[], 'a' | 'b', resource '…', or { … }.
    const start = this.i;
    if (this.tok.t === 'id' && this.tok.v === 'resource') (this.i++, this.i++);
    else if (this.is('{') || this.is('(')) {
      this.restUntilBalanced();
    } else this.i++;
    while (this.is('[') && this.ts[this.i + 1]?.v === ']') this.i += 2;
    while (this.is('|')) (this.i++, this.i++);
    if (this.is('?')) this.i++;
    return this.ts.slice(start, this.i).map((t) => t.v).join('');
  }

  restUntilBalanced() {
    let depth = 0;
    do {
      if (this.is('{') || this.is('[') || this.is('(')) depth++;
      if (this.is('}') || this.is(']') || this.is(')')) depth--;
      this.i++;
    } while (depth > 0 && this.tok.t !== 'eof');
  }

  string(): string {
    const t = this.next();
    if (t.t !== 'str') throw new BicepError(`expected a string, found "${t.v}"`, t.line);
    return t.v;
  }

  expr(): E {
    const c = this.binary(0);
    if (this.is('?')) {
      this.i++;
      this.skipNl();
      const a = this.expr();
      this.skipNl();
      this.eat(':');
      this.skipNl();
      return { k: 'tern', c, a, b: this.expr() };
    }
    return c;
  }

  binary(min: number): E {
    let a = this.unary();
    for (;;) {
      const op = this.tok.t === 'punct' ? this.tok.v : '';
      const level = BIN.find(([ops]) => ops.includes(op))?.[1];
      if (level === undefined || level <= min) return a;
      this.i++;
      this.skipNl();
      a = { k: 'bin', op, a, b: this.binary(level) };
    }
  }

  unary(): E {
    if (this.is('!') || this.is('-')) {
      const op = this.next().v;
      return { k: 'un', op, e: this.unary() };
    }
    return this.postfix(this.primary());
  }

  postfix(e: E): E {
    for (;;) {
      if (this.is('.') || this.is('?.')) {
        this.i++;
        const name = this.next().v;
        if (this.is('(')) {
          // sys.concat(), az.resourceGroup(): a namespace; a method on a resource (x.listKeys()) is not read.
          const args = this.args();
          e = e.k === 'id' && (e.name === 'sys' || e.name === 'az') ? { k: 'call', name, args } : { k: 'call', name: `${(e as { name?: string }).name ?? '?'}.${name}`, args: [e, ...args] };
        } else e = { k: 'member', of: e, name };
      } else if (this.is('[') ) {
        this.i++;
        this.skipNl();
        const at = this.expr();
        this.skipNl();
        this.eat(']');
        e = { k: 'index', of: e, at };
      } else if (this.is('!')) {
        // x.y! asserts it is not null: nothing to do here.
        this.i++;
      } else return e;
    }
  }

  args(): E[] {
    this.eat('(');
    const args: E[] = [];
    this.skipNl();
    while (!this.is(')')) {
      args.push(this.expr());
      this.skipNl();
      if (this.is(',')) this.i++;
      this.skipNl();
    }
    this.eat(')');
    return args;
  }

  primary(): E {
    const t = this.tok;
    if (t.t === 'str') {
      this.i++;
      return { k: 'str', parts: t.parts!.map((p) => (typeof p === 'string' ? p : new Parser([...p, { t: 'eof', v: '', line: t.line }]).expr())) };
    }
    if (t.t === 'num') return (this.i++, { k: 'num', v: Number(t.v) });
    if (t.t === 'id') {
      this.i++;
      if (t.v === 'true' || t.v === 'false') return { k: 'lit', v: t.v === 'true' };
      if (t.v === 'null') return { k: 'lit', v: null };
      if (t.v === 'if' && this.is('(')) {
        this.eat('(');
        const cond = this.expr();
        this.eat(')');
        this.skipNl();
        return { k: 'if', cond, body: this.expr() };
      }
      if (this.is('=>')) {
        this.i++;
        this.expr();
        return { k: 'lambda' };
      }
      if (this.is('(')) return { k: 'call', name: t.v, args: this.args() };
      return { k: 'id', name: t.v };
    }
    if (this.is('(')) {
      // (a, b) => … is a lambda; (x) a group.
      const save = this.i;
      this.i++;
      this.skipNl();
      const e = this.expr();
      this.skipNl();
      if (this.is(',')) {
        this.i = save;
        this.restUntilBalanced();
        if (this.is('=>')) (this.i++, this.expr());
        return { k: 'lambda' };
      }
      this.eat(')');
      if (this.is('=>')) return (this.i++, this.expr(), { k: 'lambda' });
      return e;
    }
    if (this.is('{')) return this.object();
    if (this.is('[')) return this.array();
    throw new BicepError(`unexpected "${t.v || 'end of file'}"`, t.line);
  }

  object(): E {
    this.eat('{');
    const props: [string | E, E][] = [];
    const children: Decl[] = [];
    for (;;) {
      while (this.tok.t === 'nl' || this.is(',')) this.i++;
      if (this.is('}')) break;
      while (this.is('@')) {
        this.i++;
        this.expr();
        this.skipNl();
      }
      if (this.tok.t === 'id' && this.tok.v === 'resource' && this.ts[this.i + 1]?.t === 'id' && this.ts[this.i + 2]?.t === 'str') {
        children.push(this.decl());
        continue;
      }
      const k = this.next();
      let key: string | E;
      if (k.t === 'id') key = k.v;
      else if (k.t === 'str') key = k.parts!.length === 1 && typeof k.parts![0] === 'string' ? k.v : (((this.i--, this.primary()) as E));
      else throw new BicepError(`expected a property name, found "${k.v}"`, k.line);
      this.eat(':');
      this.skipNl();
      props.push([key, this.expr()]);
    }
    this.eat('}');
    return { k: 'obj', props, children };
  }

  array(): E {
    this.eat('[');
    this.skipNl();
    if (this.tok.t === 'id' && this.tok.v === 'for') {
      this.i++;
      let item: string;
      let index: string | undefined;
      if (this.is('(')) {
        this.i++;
        item = this.next().v;
        this.eat(',');
        index = this.next().v;
        this.eat(')');
      } else item = this.next().v;
      if (this.next().v !== 'in') throw new BicepError('expected "in" in a for loop', this.tok.line);
      const src = this.expr();
      this.eat(':');
      this.skipNl();
      let body = this.expr();
      let cond: E | undefined;
      if (body.k === 'if') ((cond = body.cond), (body = body.body));
      this.skipNl();
      this.eat(']');
      return { k: 'for', item, index, src, cond, body };
    }
    const items: E[] = [];
    for (;;) {
      while (this.tok.t === 'nl' || this.is(',')) this.i++;
      if (this.is(']')) break;
      items.push(this.expr());
    }
    this.eat(']');
    return { k: 'arr', items };
  }
}

export function parseBicep(text: string): Decl[] {
  return new Parser(lex(text)).file();
}

// ---------------------------------------------------------------- to ARM

export interface BicepFile {
  path: string;
  text: string;
}

export interface Compiled {
  template: Obj;
  /** What could not be written as an ARM expression, with the line. */
  notes: string[];
  /** Files this one uses as modules. */
  modules: string[];
}

type Sym = { k: 'param' | 'var' | 'resource' | 'module' } | { k: 'loop'; arm: string };

class Unsupported extends Error {}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const OPS: Record<string, string> = { '==': 'equals', '&&': 'and', '||': 'or', '<': 'less', '>': 'greater', '<=': 'lessOrEquals', '>=': 'greaterOrEquals', '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod', '??': 'coalesce' };

/** dir/a/../b.bicep → dir/b.bicep */
export function resolvePath(from: string, rel: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** One file to an ARM template; the modules it names are read from `files` and compiled into it. */
export function compileBicep(path: string, files: Map<string, string>, seen: string[] = []): Compiled {
  const notes: string[] = [];
  const modules: string[] = [];
  const text = files.get(path);
  if (text === undefined) return { template: {}, notes: [`${path}: not found`], modules };
  let decls: Decl[];
  try {
    decls = parseBicep(text);
  } catch (e) {
    const err = e as BicepError;
    return { template: {}, notes: [`${path}:${err.line ?? '?'}: ${err.message}`], modules };
  }
  const syms = new Map<string, Sym>();
  for (const d of decls) if (d.k === 'param' || d.k === 'var' || d.k === 'resource' || d.k === 'module') syms.set(d.name, { k: d.k });
  // Children declared inside a resource are resources of their own, by their symbol.
  const flat: { d: Extract<Decl, { k: 'resource' }>; parent?: { name: string; type: string } }[] = [];
  const walk = (d: Extract<Decl, { k: 'resource' }>, parent?: { name: string; type: string }) => {
    flat.push({ d, parent });
    syms.set(d.name, { k: 'resource' });
    const body = d.value.k === 'if' ? d.value.body : d.value.k === 'for' ? d.value.body : d.value;
    if (body.k === 'obj') for (const c of body.children) if (c.k === 'resource') walk(c, { name: d.name, type: d.type.split('@')[0]! });
  };
  for (const d of decls) if (d.k === 'resource') walk(d);

  let line = 0;
  const note = (what: string) => notes.push(`${path}:${line}: ${what}`);

  /** An ARM expression (no brackets). */
  const x = (e: E, scope: Map<string, Sym>): string => {
    switch (e.k) {
      case 'str': {
        if (e.parts.every((p) => typeof p === 'string')) return q(e.parts.join(''));
        let fmt = '';
        const args: string[] = [];
        for (const p of e.parts) {
          if (typeof p === 'string') fmt += p.replace(/\{/g, '{{').replace(/\}/g, '}}');
          else {
            fmt += `{${args.length}}`;
            args.push(x(p, scope));
          }
        }
        return `format(${q(fmt)}, ${args.join(', ')})`;
      }
      case 'num':
        return String(e.v);
      case 'lit':
        return e.v === null ? 'null()' : e.v ? 'true()' : 'false()';
      case 'id': {
        const s = scope.get(e.name);
        if (!s) throw new Unsupported(`"${e.name}" is not declared here`);
        if (s.k === 'loop') return s.arm;
        if (s.k === 'param') return `parameters(${q(e.name)})`;
        if (s.k === 'var') return `variables(${q(e.name)})`;
        if (s.k === 'module') return `reference(${q(e.name)})`;
        return `resourceInfo(${q(e.name)})`;
      }
      case 'member': {
        const of = e.of;
        if (of.k === 'id' && scope.get(of.name)?.k === 'resource') {
          if (e.name === 'id' || e.name === 'name' || e.name === 'type') return `resourceInfo(${q(of.name)}).${e.name}`;
          if (e.name === 'properties') return `reference(${q(of.name)})`;
          return `reference(${q(of.name)}, 'Full').${e.name}`;
        }
        // module.outputs.x is the deployment's output x: its value.
        if (of.k === 'member' && of.name === 'outputs' && of.of.k === 'id' && scope.get(of.of.name)?.k === 'module') return `reference(${q(of.of.name)}).outputs.${e.name}.value`;
        if (of.k === 'id' && scope.get(of.name)?.k === 'module' && e.name === 'name') return `${q(of.name)}`;
        return `${x(of, scope)}.${e.name}`;
      }
      case 'index':
        return `${x(e.of, scope)}[${x(e.at, scope)}]`;
      case 'call': {
        if (e.name.includes('.')) throw new Unsupported(`${e.name}() is only known once deployed`);
        const name = e.name === 'resourceGroup' && e.args.length ? 'resourceGroup' : e.name;
        if (/^(loadTextContent|loadJsonContent|loadYamlContent|loadFileAsBase64|readEnvironmentVariable|getSecret)$/.test(name)) throw new Unsupported(`${name}() is not read`);
        return `${name}(${e.args.map((a) => x(a, scope)).join(', ')})`;
      }
      case 'obj':
        return `createObject(${e.props.map(([k, v]) => `${typeof k === 'string' ? q(k) : x(k, scope)}, ${x(v, scope)}`).join(', ')})`;
      case 'arr':
        return `createArray(${e.items.map((v) => x(v, scope)).join(', ')})`;
      case 'un':
        return e.op === '!' ? `not(${x(e.e, scope)})` : `sub(0, ${x(e.e, scope)})`;
      case 'bin':
        if (e.op === '!=') return `not(equals(${x(e.a, scope)}, ${x(e.b, scope)}))`;
        if (!OPS[e.op]) throw new Unsupported(`the operator ${e.op}`);
        return `${OPS[e.op]}(${x(e.a, scope)}, ${x(e.b, scope)})`;
      case 'tern':
        return `if(${x(e.c, scope)}, ${x(e.a, scope)}, ${x(e.b, scope)})`;
      case 'for':
        throw new Unsupported('a for loop inside an expression');
      case 'if':
        return x(e.body, scope);
      case 'lambda':
        throw new Unsupported('a lambda');
    }
  };

  /** A JSON value: literals as they are, anything else an expression in [brackets]. */
  const json = (e: E, scope: Map<string, Sym>): unknown => {
    try {
      if (e.k === 'str' && e.parts.every((p) => typeof p === 'string')) {
        const s = e.parts.join('');
        return s.startsWith('[') ? `[${s}` : s;
      }
      if (e.k === 'num') return e.v;
      if (e.k === 'lit') return e.v;
      if (e.k === 'arr') return e.items.map((v) => json(v, scope));
      if (e.k === 'obj') {
        const out: Obj = {};
        for (const [k, v] of e.props) {
          // A property that is a loop: ARM's copy, which the reader unrolls.
          if (v.k === 'for' && typeof k === 'string') {
            const inner = loopScope(v, k, scope);
            const copy = Array.isArray(out.copy) ? (out.copy as Obj[]) : [];
            copy.push({ name: k, count: `[length(${x(v.src, scope)})]`, input: json(v.body, inner) });
            out.copy = copy;
            continue;
          }
          const key = typeof k === 'string' ? k : `[${x(k, scope)}]`;
          out[key] = json(v, scope);
        }
        return out;
      }
      return `[${x(e, scope)}]`;
    } catch (err) {
      if (!(err instanceof Unsupported)) throw err;
      note(err.message);
      return `{${err.message}}`;
    }
  };

  const loopScope = (f: Extract<E, { k: 'for' }>, name: string, scope: Map<string, Sym>, arm = `copyIndex(${q(name)})`) => {
    const inner = new Map(scope);
    const src = f.src.k === 'call' && f.src.name === 'range' ? undefined : x(f.src, scope);
    // range(a, n): the item is a + i.
    const item = src ? `${src}[${arm}]` : `add(${x((f.src as Extract<E, { k: 'call' }>).args[0]!, scope)}, ${arm})`;
    inner.set(f.item, { k: 'loop', arm: item });
    if (f.index) inner.set(f.index, { k: 'loop', arm });
    return inner;
  };

  const template: Obj = { $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#', languageVersion: '2.0', contentVersion: '1.0.0.0', parameters: {}, variables: {}, resources: {}, outputs: {} };
  const params = template.parameters as Obj;
  const variables = template.variables as Obj;
  const resources = template.resources as Obj;
  const outputs = template.outputs as Obj;
  const typeOf = (t: string) => (/^(string|int|bool|object|array)$/.test(t) ? t : t.endsWith('[]') ? 'array' : /^'/.test(t) ? 'string' : 'object');

  for (const d of decls) {
    line = d.line;
    if (d.k === 'param') params[d.name] = { type: typeOf(d.type), ...(d.value ? { defaultValue: json(d.value, syms) } : {}) };
    else if (d.k === 'var') {
      if (d.value.k === 'for') {
        const copy = Array.isArray(variables.copy) ? (variables.copy as Obj[]) : [];
        copy.push({ name: d.name, count: `[length(${(() => { try { return x((d.value as Extract<E, { k: 'for' }>).src, syms); } catch { return '0'; } })()})]`, input: json(d.value.body, loopScope(d.value, d.name, syms)) });
        variables.copy = copy;
      } else variables[d.name] = json(d.value, syms);
    }
    // An output made by a loop is only for whoever deploys it: not drawn, so not worth a note.
    else if (d.k === 'output') outputs[d.name] = { type: typeOf(d.type), value: d.value.k === 'for' ? '{a loop}' : json(d.value, syms) };
    else if (d.k === 'module') {
      const at = resolvePath(path, d.path);
      let body = d.value;
      const r: Obj = { type: 'Microsoft.Resources/deployments', apiVersion: '2022-09-01' };
      if (body.k === 'if') ((r.condition = json(body.cond, syms)), (body = body.body));
      let scope = syms;
      if (body.k === 'for') {
        scope = loopScope(body, d.name, syms, 'copyIndex()');
        r.copy = { name: d.name, count: `[length(${x(body.src, syms)})]` };
        if (body.cond) r.condition = json(body.cond, scope);
        body = body.body;
      }
      const props = body.k === 'obj' ? new Map(body.props.filter(([k]) => typeof k === 'string') as [string, E][]) : new Map<string, E>();
      r.name = props.has('name') ? json(props.get('name')!, scope) : d.name;
      if (props.has('scope')) {
        const sc = props.get('scope')!;
        if (sc.k === 'call' && sc.name === 'resourceGroup' && sc.args.length) r.resourceGroup = json(sc.args.at(-1)!, scope);
      }
      if (/^(br|ts)[:/]/.test(d.path)) {
        notes.push(`${path}:${d.line}: the module ${d.path} is in a registry: not read`);
        r.properties = { mode: 'Incremental', parameters: {} };
      } else if (seen.includes(at)) notes.push(`${path}:${d.line}: ${d.path} uses itself`);
      else {
        modules.push(at);
        const inner = compileBicep(at, files, [...seen, path]);
        notes.push(...inner.notes);
        modules.push(...inner.modules);
        const given = props.get('params');
        const parameters: Obj = {};
        if (given?.k === 'obj') for (const [k, v] of given.props) if (typeof k === 'string') parameters[k] = { value: json(v, scope) };
        r.properties = { mode: 'Incremental', expressionEvaluationOptions: { scope: 'inner' }, parameters, template: inner.template };
      }
      resources[d.name] = r;
    }
  }
  for (const { d, parent } of flat) {
    line = d.line;
    const [type, apiVersion] = d.type.split('@');
    const r: Obj = { type: parent && !type!.includes('/') ? `${parent.type}/${type}` : type, apiVersion };
    let body = d.value;
    if (body.k === 'if') ((r.condition = json(body.cond, syms)), (body = body.body));
    let scope = syms;
    if (body.k === 'for') {
      scope = loopScope(body, d.name, syms, 'copyIndex()');
      r.copy = { name: d.name, count: `[length(${x(body.src, syms)})]` };
      if (body.cond) r.condition = json(body.cond, scope);
      body = body.body;
    }
    if (d.existing) r.existing = true;
    if (parent) r.parent = parent.name;
    if (body.k === 'obj')
      for (const [k, v] of body.props) {
        if (typeof k !== 'string') continue;
        if (k === 'parent' && v.k === 'id') r.parent = v.name;
        else if (k === 'scope') {
          // On another resource (an extension: a role assignment, diagnostic settings): its symbol. resourceGroup('x'): not drawn here.
          if (v.k === 'id' && syms.get(v.name)?.k === 'resource') r.scope = `[resourceInfo(${q(v.name)}).id]`;
        } else if (k === 'dependsOn') continue;
        else r[k] = json(v, scope);
      }
    resources[d.name] = r;
  }
  return { template, notes, modules };
}

/** A .bicepparam file: the file it is for, and the values it gives (those it can know). */
export function readBicepParams(text: string, path: string): { using?: string; values: Obj; notes: string[] } {
  const notes: string[] = [];
  let decls: Decl[];
  try {
    decls = parseBicep(text);
  } catch (e) {
    return { values: {}, notes: [`${path}:${(e as BicepError).line ?? '?'}: ${(e as Error).message}`] };
  }
  const using = decls.find((d) => d.k === 'using') as Extract<Decl, { k: 'using' }> | undefined;
  const values: Obj = {};
  const lit = (e: E): unknown => {
    if (e.k === 'str' && e.parts.every((p) => typeof p === 'string')) return e.parts.join('');
    if (e.k === 'num') return e.v;
    if (e.k === 'lit') return e.v;
    if (e.k === 'arr') return e.items.map(lit);
    if (e.k === 'obj') return Object.fromEntries(e.props.filter(([k]) => typeof k === 'string').map(([k, v]) => [k, lit(v)]));
    if (e.k === 'un' && e.op === '-' && e.e.k === 'num') return -e.e.v;
    throw new Unsupported('');
  };
  for (const d of decls)
    if (d.k === 'param' && d.value) {
      try {
        values[d.name] = lit(d.value);
      } catch {
        notes.push(`${path}:${d.line}: ${d.name} is only known when deployed`);
      }
    }
  return { using: using && !/^(br|ts)[:/]/.test(using.path) ? resolvePath(path, using.path) : undefined, values, notes };
}

export const isBicepName = (name: string): boolean => /\.bicep$/i.test(name);

/** The files no other file uses as a module: what is deployed. */
export function bicepEntries(files: Map<string, string>): { entries: string[]; compiled: Map<string, Compiled> } {
  const compiled = new Map<string, Compiled>();
  const used = new Set<string>();
  for (const p of files.keys()) {
    if (!isBicepName(p)) continue;
    const c = compileBicep(p, files);
    compiled.set(p, c);
    for (const m of c.modules) used.add(m);
  }
  return { entries: [...compiled.keys()].filter((p) => !used.has(p)).sort(), compiled };
}

export const isCompiled = (t: Obj): boolean => isObj(t.resources) && Object.keys(t.resources as Obj).length > 0;
