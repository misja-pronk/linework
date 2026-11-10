// A small Go text/template, as Helm uses it: enough to render a chart's templates from its values
// without Helm. Actions ({{ }} with - trimming and comments), if/else if/else, range (lists, maps,
// numbers; with $i, $v :=), with, define/template/include, block, variables, pipelines, and the
// Sprig functions charts lean on (default, quote, toYaml | nindent, printf, trunc, dict, …). What it
// does not know is not guessed: the caller hears about it, with the file and line.
import { stringify } from 'yaml';
import { isObj, type Obj } from './keep.ts';

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line: number,
  ) {
    super(message);
  }
}

type Tok = { t: 'str' | 'num' | 'bool' | 'nil' | 'ident' | 'field' | 'var' | 'punct'; v: string; /** Right after the token before, no space between: (…).Field */ adj?: boolean };
type Arg = { k: 'lit'; v: unknown } | { k: 'field'; on?: Arg; path: string[] } | { k: 'var'; name: string; path: string[] } | { k: 'fn'; name: string } | { k: 'pipe'; pipe: Pipe; path: string[] };
type Cmd = Arg[];
interface Pipe {
  vars: string[];
  declare: boolean;
  cmds: Cmd[];
}
type Node =
  | { k: 'text'; v: string }
  | { k: 'out'; pipe: Pipe; line: number }
  | { k: 'if'; arms: { cond: Pipe; body: Node[] }[]; else?: Node[]; line: number }
  | { k: 'range'; pipe: Pipe; body: Node[]; else?: Node[]; line: number }
  | { k: 'with'; arms: { cond: Pipe; body: Node[] }[]; else?: Node[]; line: number }
  | { k: 'template'; name: string; pipe?: Pipe; line: number }
  | { k: 'break' | 'continue' };

// ---------------------------------------------------------------- reading

function lexPipe(s: string, file: string, line: number): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if (/\s/.test(c)) i++;
    else if (c === '"') {
      let v = '';
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\') {
          const e = s[++i]!;
          v += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else v += s[i];
      }
      i++;
      out.push({ t: 'str', v });
    } else if (c === '`') {
      const end = s.indexOf('`', i + 1);
      out.push({ t: 'str', v: s.slice(i + 1, end < 0 ? s.length : end) });
      i = end < 0 ? s.length : end + 1;
    } else if (c === "'" && (m = /^'(\\.|[^'])'/.exec(rest))) {
      out.push({ t: 'num', v: String(m[1]!.replace(/^\\/, '').charCodeAt(0)) });
      i += m[0].length;
    } else if ((m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(rest))) {
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if ((m = /^\$\w*(\.[A-Za-z_]\w*)*/.exec(rest))) {
      out.push({ t: 'var', v: m[0] });
      i += m[0].length;
    } else if ((m = /^(\.[A-Za-z_]\w*)+|^\./.exec(rest))) {
      out.push({ t: 'field', v: m[0], adj: i > 0 && s[i - 1] === ')' });
      i += m[0].length;
    } else if ((m = /^[A-Za-z_]\w*/.exec(rest))) {
      const v = m[0];
      out.push(v === 'true' || v === 'false' ? { t: 'bool', v } : v === 'nil' ? { t: 'nil', v } : { t: 'ident', v });
      i += v.length;
    } else if (rest.startsWith(':=')) (out.push({ t: 'punct', v: ':=' }), (i += 2));
    else if ('|(),='.includes(c)) (out.push({ t: 'punct', v: c }), i++);
    else throw new TemplateError(`cannot read "${c}" in {{ ${s.trim()} }}`, file, line);
  }
  return out;
}

function parsePipe(s: string, file: string, line: number): Pipe {
  const ts = lexPipe(s, file, line);
  let i = 0;
  const pipe = (): Pipe => {
    const vars: string[] = [];
    let declare = false;
    // $a := …, $i, $v := …, $a = …
    let j = i;
    const names: string[] = [];
    while (ts[j]?.t === 'var') {
      names.push(ts[j]!.v);
      if (ts[j + 1]?.v === ',') j += 2;
      else break;
    }
    if (names.length && (ts[j + 1]?.v === ':=' || ts[j + 1]?.v === '=')) {
      vars.push(...names);
      declare = ts[j + 1]!.v === ':=';
      i = j + 2;
    }
    const cmds: Cmd[] = [];
    let cmd: Cmd = [];
    while (i < ts.length && ts[i]!.v !== ')') {
      const t = ts[i]!;
      if (t.t === 'punct' && t.v === '|') {
        cmds.push(cmd);
        cmd = [];
        i++;
        continue;
      }
      cmd.push(operand());
    }
    cmds.push(cmd);
    if (cmds.some((c) => !c.length)) throw new TemplateError(`an empty command in {{ ${s.trim()} }}`, file, line);
    return { vars, declare, cmds };
  };
  const operand = (): Arg => {
    const t = ts[i++]!;
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'bool') return { k: 'lit', v: t.v === 'true' };
    if (t.t === 'nil') return { k: 'lit', v: null };
    if (t.t === 'ident') return { k: 'fn', name: t.v };
    if (t.t === 'field') return { k: 'field', path: t.v === '.' ? [] : t.v.slice(1).split('.') };
    if (t.t === 'var') {
      const [name, ...path] = t.v.split('.');
      return { k: 'var', name: name!, path };
    }
    if (t.v === '(') {
      const inner = pipe();
      if (ts[i]?.v !== ')') throw new TemplateError(`a ( without ) in {{ ${s.trim()} }}`, file, line);
      i++;
      const path: string[] = [];
      if (ts[i]?.t === 'field' && ts[i]!.adj && ts[i]!.v !== '.') path.push(...ts[i++]!.v.slice(1).split('.'));
      return { k: 'pipe', pipe: inner, path };
    }
    throw new TemplateError(`unexpected "${t.v}" in {{ ${s.trim()} }}`, file, line);
  };
  const p = pipe();
  if (i < ts.length) throw new TemplateError(`unexpected "${ts[i]!.v}" in {{ ${s.trim()} }}`, file, line);
  return p;
}

/** A template's text into its tree; `define`d templates go into `defs`. */
export function parseTemplate(text: string, file: string, defs: Map<string, Node[]>): Node[] {
  const src = text.replace(/\r\n?/g, '\n');
  // Pieces: text and actions, with the trimming done.
  const pieces: ({ k: 'text'; v: string } | { k: 'act'; v: string; line: number })[] = [];
  let at = 0;
  const lineAt = (pos: number) => src.slice(0, pos).split('\n').length;
  while (at < src.length) {
    const open = src.indexOf('{{', at);
    if (open < 0) {
      pieces.push({ k: 'text', v: src.slice(at) });
      break;
    }
    let text = src.slice(at, open);
    const trimLeft = src[open + 2] === '-' && /\s/.test(src[open + 3] ?? '');
    if (trimLeft) text = text.replace(/\s+$/, '');
    pieces.push({ k: 'text', v: text });
    let inner = open + (trimLeft ? 3 : 2);
    // A comment may hold }}: it ends at */.
    const comment = /^\s*\/\*/.test(src.slice(inner, inner + 10));
    const close = comment ? src.indexOf('*/', inner) : -1;
    const end = src.indexOf('}}', comment && close >= 0 ? close : inner);
    if (end < 0) throw new TemplateError('a {{ without }}', file, lineAt(open));
    const trimRight = src[end - 1] === '-' && /\s/.test(src[end - 2] ?? '');
    const body = src.slice(inner, trimRight ? end - 1 : end);
    if (!comment) pieces.push({ k: 'act', v: body.trim(), line: lineAt(open) });
    at = end + 2;
    if (trimRight) while (at < src.length && /\s/.test(src[at]!)) at++;
  }

  let p = 0;
  const block = (stops: RegExp): { nodes: Node[]; stop?: { word: string; rest: string; line: number } } => {
    const nodes: Node[] = [];
    while (p < pieces.length) {
      const piece = pieces[p++]!;
      if (piece.k === 'text') {
        if (piece.v) nodes.push({ k: 'text', v: piece.v });
        continue;
      }
      const m = /^(\w+)\b\s*([\s\S]*)$/.exec(piece.v);
      const word = m?.[1] ?? '';
      const rest = m?.[2] ?? '';
      const line = piece.line;
      if (stops.test(word) && ['end', 'else'].includes(word)) return { nodes, stop: { word, rest, line } };
      if (word === 'if' || word === 'with') {
        const arms = [{ cond: parsePipe(rest, file, line), body: [] as Node[] }];
        let elseBody: Node[] | undefined;
        for (;;) {
          const r = block(/^(end|else)$/);
          if (!r.stop) throw new TemplateError(`{{ ${word} }} without {{ end }}`, file, line);
          if (elseBody) elseBody = r.nodes;
          else arms.at(-1)!.body = r.nodes;
          if (r.stop.word === 'end') break;
          const chained = /^(if|with)\s+([\s\S]+)$/.exec(r.stop.rest);
          if (chained) arms.push({ cond: parsePipe(chained[2]!, file, r.stop.line), body: [] });
          else elseBody = [];
          if (elseBody && !chained) {
            const r2 = block(/^end$/);
            if (!r2.stop) throw new TemplateError(`{{ else }} without {{ end }}`, file, r.stop.line);
            elseBody = r2.nodes;
            break;
          }
        }
        nodes.push({ k: word, arms, else: elseBody, line });
      } else if (word === 'range') {
        const pipe = parsePipe(rest, file, line);
        const r = block(/^(end|else)$/);
        if (!r.stop) throw new TemplateError('{{ range }} without {{ end }}', file, line);
        let elseBody: Node[] | undefined;
        if (r.stop.word === 'else') elseBody = block(/^end$/).nodes;
        nodes.push({ k: 'range', pipe, body: r.nodes, else: elseBody, line });
      } else if (word === 'define' || word === 'block') {
        const name = /^"([^"]*)"|^`([^`]*)`/.exec(rest);
        if (!name) throw new TemplateError(`{{ ${word} }} needs a name in quotes`, file, line);
        const r = block(/^end$/);
        if (!r.stop) throw new TemplateError(`{{ ${word} }} without {{ end }}`, file, line);
        defs.set(name[1] ?? name[2]!, r.nodes);
        if (word === 'block') {
          const arg = rest.slice(name[0].length).trim();
          nodes.push({ k: 'template', name: name[1] ?? name[2]!, pipe: arg ? parsePipe(arg, file, line) : undefined, line });
        }
      } else if (word === 'template') {
        const name = /^"([^"]*)"|^`([^`]*)`/.exec(rest);
        if (!name) throw new TemplateError('{{ template }} needs a name in quotes', file, line);
        const arg = rest.slice(name[0].length).trim();
        nodes.push({ k: 'template', name: name[1] ?? name[2]!, pipe: arg ? parsePipe(arg, file, line) : undefined, line });
      } else if (word === 'break' || word === 'continue') nodes.push({ k: word });
      else if (word === 'end' || word === 'else') throw new TemplateError(`{{ ${word} }} without what it ends`, file, line);
      else nodes.push({ k: 'out', pipe: parsePipe(piece.v, file, line), line });
    }
    return { nodes };
  };
  const r = block(/^$/);
  return r.nodes;
}

// ---------------------------------------------------------------- running

class Stop {
  constructor(readonly what: 'break' | 'continue') {}
}

export interface RunContext {
  defs: Map<string, Node[]>;
  file: string;
  /** Told once per function or construct that is not known, with where it is. */
  unknown: (what: string, file: string, line: number) => void;
  /** A template given as text (tpl): read and run here. */
  depth: number;
}

const truthy = (v: unknown): boolean => !(v == null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length && !(v as { __method?: boolean }).__method));

/** A value as Go prints it: maps as map[a:b], nil as <no value>. */
export function print(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(print).join(' ')}]`;
  if (isObj(v)) return `map[${Object.keys(v).sort().map((k) => `${k}:${print(v[k])}`).join(' ')}]`;
  return String(v);
}

export function toYaml(v: unknown): string {
  if (v == null) return 'null';
  return stringify(v, { lineWidth: 0 }).replace(/\n$/, '');
}

const indent = (n: number, s: string) => s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

function field(on: unknown, path: string[]): unknown {
  let v = on;
  for (const p of path) {
    if (v == null) return undefined;
    if (isObj(v)) v = v[p];
    else return undefined;
  }
  return v;
}

function deepMerge(dst: Obj, src: Obj): Obj {
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(dst[k])) deepMerge(dst[k] as Obj, v);
    else if (!(k in dst) || dst[k] == null) dst[k] = isObj(v) ? deepMerge({}, v) : v;
  }
  return dst;
}

export function run(nodes: Node[], dot: unknown, ctx: RunContext, vars: Map<string, unknown> = new Map([['$', dot]])): string {
  let out = '';
  const funcs = functions(ctx);
  const evalArg = (a: Arg, line: number, final?: unknown[]): unknown => {
    if (a.k === 'lit') return a.v;
    if (a.k === 'field') return field(dot, a.path);
    if (a.k === 'var') {
      if (!vars.has(a.name)) throw new TemplateError(`undefined variable ${a.name}`, ctx.file, line);
      return field(vars.get(a.name), a.path);
    }
    if (a.k === 'pipe') return field(evalPipe(a.pipe, line), a.path);
    return call(a.name, final ?? [], line);
  };
  const call = (name: string, args: unknown[], line: number): unknown => {
    const f = funcs[name];
    if (!f) {
      ctx.unknown(`the function ${name}`, ctx.file, line);
      return undefined;
    }
    try {
      return f(...args);
    } catch (e) {
      if (e instanceof TemplateError || e instanceof Stop) throw e;
      throw new TemplateError(`${name}: ${(e as Error).message}`, ctx.file, line);
    }
  };
  const evalCmd = (cmd: Cmd, line: number, piped: unknown[]): unknown => {
    const [head, ...rest] = cmd;
    if (head!.k === 'fn') return call(head!.name, [...rest.map((a) => evalArg(a, line)), ...piped], line);
    // A method: .Capabilities.APIVersions.Has "x", .Files.Get "x".
    const v = evalArg(head!, line);
    if (typeof v === 'function') return (v as (...a: unknown[]) => unknown)(...rest.map((a) => evalArg(a, line)), ...piped);
    if (rest.length || piped.length) throw new TemplateError('a value cannot take arguments', ctx.file, line);
    return v;
  };
  const evalPipe = (pipe: Pipe, line: number): unknown => {
    let v: unknown;
    pipe.cmds.forEach((c, i) => (v = evalCmd(c, line, i ? [v] : [])));
    if (pipe.vars.length === 1) vars.set(pipe.vars[0]!, v);
    return v;
  };
  for (const n of nodes) {
    switch (n.k) {
      case 'text':
        out += n.v;
        break;
      case 'out': {
        const v = evalPipe(n.pipe, n.line);
        if (!n.pipe.vars.length) out += print(v);
        break;
      }
      case 'if':
      case 'with': {
        let done = false;
        for (const arm of n.arms) {
          const v = evalPipe(arm.cond, n.line);
          if (truthy(v)) {
            out += n.k === 'with' ? run(arm.body, v, ctx, new Map(vars)) : run(arm.body, dot, ctx, vars);
            done = true;
            break;
          }
        }
        if (!done && n.else) out += run(n.else, dot, ctx, vars);
        break;
      }
      case 'range': {
        const names = n.pipe.vars;
        const v = evalPipe({ ...n.pipe, vars: [] }, n.line);
        const items: [unknown, unknown][] = Array.isArray(v) ? v.map((x, i) => [i, x]) : isObj(v) ? Object.keys(v).sort().map((k) => [k, v[k]]) : typeof v === 'number' ? Array.from({ length: Math.max(0, Math.min(v, 1000)) }, (_, i) => [i, i]) : [];
        if (!items.length) {
          if (n.else) out += run(n.else, dot, ctx, vars);
          break;
        }
        for (const [k, x] of items) {
          const inner = new Map(vars);
          if (names.length === 1) inner.set(names[0]!, x);
          if (names.length === 2) (inner.set(names[0]!, k), inner.set(names[1]!, x));
          try {
            out += run(n.body, x, ctx, inner);
          } catch (e) {
            if (!(e instanceof Stop)) throw e;
            if (e.what === 'break') break;
          }
        }
        break;
      }
      case 'template': {
        const body = ctx.defs.get(n.name);
        if (!body) throw new TemplateError(`no template "${n.name}"`, ctx.file, n.line);
        const arg = n.pipe ? evalPipe(n.pipe, n.line) : undefined;
        out += run(body, arg, { ...ctx, depth: ctx.depth + 1 }, new Map([['$', arg]]));
        break;
      }
      case 'break':
      case 'continue':
        out += '';
        throw new Stop(n.k);
    }
  }
  return out;
}

type Fn = (...a: any[]) => unknown;

function functions(ctx: RunContext): Record<string, Fn> {
  const include = (name: string, arg: unknown) => {
    const body = ctx.defs.get(name);
    if (!body) throw new Error(`no template "${name}"`);
    if (ctx.depth > 50) throw new Error('templates include each other without end');
    return run(body, arg, { ...ctx, depth: ctx.depth + 1 }, new Map([['$', arg]]));
  };
  const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
  const printf = (f: string, ...a: unknown[]) => {
    let i = 0;
    return String(f).replace(/%(-?\d*)(\.\d+)?([sdvqtfx%])/g, (_, w: string, prec: string | undefined, c: string) => {
      if (c === '%') return '%';
      const v = a[i++];
      let s = c === 'q' ? JSON.stringify(print(v)) : c === 'd' ? String(Math.trunc(num(v))) : c === 'f' ? num(v).toFixed(prec ? Number(prec.slice(1)) : 6) : c === 'x' ? Math.trunc(num(v)).toString(16) : print(v);
      const width = Math.abs(Number(w) || 0);
      if (s.length < width) s = w.startsWith('-') ? s.padEnd(width) : s.padStart(width);
      return s;
    });
  };
  const empty = (v: unknown) => !truthy(v);
  return {
    include,
    tpl: (text: string, dot: unknown) => {
      const defs = new Map(ctx.defs);
      return run(parseTemplate(String(text), ctx.file, defs), dot, { ...ctx, defs, depth: ctx.depth + 1 }, new Map([['$', dot]]));
    },
    required: (msg: string, v: unknown) => {
      if (v == null || v === '') throw new Error(`required: ${msg}`);
      return v;
    },
    fail: (msg: string) => {
      throw new Error(String(msg));
    },
    default: (d: unknown, v?: unknown) => (empty(v) ? d : v),
    empty,
    coalesce: (...a: unknown[]) => a.find(truthy),
    ternary: (a: unknown, b: unknown, c: unknown) => (c ? a : b),
    quote: (...a: unknown[]) => a.map((x) => JSON.stringify(print(x))).join(' '),
    squote: (...a: unknown[]) => a.map((x) => `'${print(x)}'`).join(' '),
    toYaml,
    toYamlPretty: toYaml,
    toJson: (v: unknown) => JSON.stringify(v ?? null),
    toPrettyJson: (v: unknown) => JSON.stringify(v ?? null, null, 2),
    fromYaml: () => ({}),
    fromJson: (s: string) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        return {};
      }
    },
    indent: (n: number, s: unknown) => indent(n, print(s)),
    nindent: (n: number, s: unknown) => '\n' + indent(n, print(s)),
    trim: (s: unknown) => print(s).trim(),
    trimSuffix: (x: string, s: unknown) => (print(s).endsWith(x) ? print(s).slice(0, -x.length || undefined) : print(s)),
    trimPrefix: (x: string, s: unknown) => (print(s).startsWith(x) ? print(s).slice(x.length) : print(s)),
    trimAll: (x: string, s: unknown) => print(s).replace(new RegExp(`^[${x.replace(/[\]\\^-]/g, '\\$&')}]+|[${x.replace(/[\]\\^-]/g, '\\$&')}]+$`, 'g'), ''),
    trunc: (n: number, s: unknown) => (n >= 0 ? print(s).slice(0, n) : print(s).slice(n)),
    lower: (s: unknown) => print(s).toLowerCase(),
    upper: (s: unknown) => print(s).toUpperCase(),
    title: (s: unknown) => print(s).replace(/\b\w/g, (c) => c.toUpperCase()),
    replace: (a: string, b: string, s: unknown) => print(s).split(a).join(b),
    nospace: (s: unknown) => print(s).replace(/\s+/g, ''),
    repeat: (n: number, s: unknown) => print(s).repeat(Math.max(0, n)),
    contains: (x: string, s: unknown) => print(s).includes(x),
    hasPrefix: (x: string, s: unknown) => print(s).startsWith(x),
    hasSuffix: (x: string, s: unknown) => print(s).endsWith(x),
    cat: (...a: unknown[]) => a.filter((x) => x != null).map(print).join(' '),
    print: (...a: unknown[]) => a.map(print).join(''),
    println: (...a: unknown[]) => a.map(print).join(' ') + '\n',
    printf,
    regexMatch: (re: string, s: unknown) => new RegExp(re).test(print(s)),
    regexReplaceAll: (re: string, s: unknown, r: string) => print(s).replace(new RegExp(re, 'g'), r.replace(/\$\{?(\d+)\}?/g, '$$$1')),
    regexFind: (re: string, s: unknown) => new RegExp(re).exec(print(s))?.[0] ?? '',
    splitList: (sep: string, s: unknown) => print(s).split(sep),
    split: (sep: string, s: unknown) => Object.fromEntries(print(s).split(sep).map((x, i) => [`_${i}`, x])),
    join: (sep: string, l: unknown) => list(l).map(print).join(sep),
    toString: (v: unknown) => print(v),
    toStrings: (l: unknown) => list(l).map(print),
    int: (v: unknown) => Math.trunc(num(v)),
    int64: (v: unknown) => Math.trunc(num(v)),
    float64: (v: unknown) => num(v),
    atoi: (v: unknown) => Math.trunc(num(v)),
    add: (...a: unknown[]) => a.reduce((s: number, x) => s + num(x), 0),
    add1: (v: unknown) => num(v) + 1,
    sub: (a: unknown, b: unknown) => num(a) - num(b),
    mul: (...a: unknown[]) => a.reduce((s: number, x) => s * num(x), 1),
    div: (a: unknown, b: unknown) => Math.trunc(num(a) / (num(b) || 1)),
    mod: (a: unknown, b: unknown) => num(a) % (num(b) || 1),
    max: (...a: unknown[]) => Math.max(...a.map(num)),
    min: (...a: unknown[]) => Math.min(...a.map(num)),
    eq: (a: unknown, ...b: unknown[]) => b.some((x) => x === a || (x == null && a == null)),
    ne: (a: unknown, b: unknown) => a !== b,
    lt: (a: unknown, b: unknown) => cmp(a, b) < 0,
    le: (a: unknown, b: unknown) => cmp(a, b) <= 0,
    gt: (a: unknown, b: unknown) => cmp(a, b) > 0,
    ge: (a: unknown, b: unknown) => cmp(a, b) >= 0,
    not: (a: unknown) => !truthy(a),
    and: (...a: unknown[]) => a.find((x) => !truthy(x)) ?? a.at(-1),
    or: (...a: unknown[]) => a.find(truthy) ?? a.at(-1),
    len: (v: unknown) => (Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : print(v).length),
    list: (...a: unknown[]) => a,
    tuple: (...a: unknown[]) => a,
    append: (l: unknown, v: unknown) => [...list(l), v],
    mustAppend: (l: unknown, v: unknown) => [...list(l), v],
    prepend: (l: unknown, v: unknown) => [v, ...list(l)],
    concat: (...a: unknown[]) => a.flatMap(list),
    first: (l: unknown) => list(l)[0],
    last: (l: unknown) => list(l).at(-1),
    rest: (l: unknown) => list(l).slice(1),
    initial: (l: unknown) => list(l).slice(0, -1),
    uniq: (l: unknown) => [...new Set(list(l))],
    compact: (l: unknown) => list(l).filter(truthy),
    has: (v: unknown, l: unknown) => list(l).includes(v),
    sortAlpha: (l: unknown) => list(l).map(print).sort(),
    until: (n: number) => Array.from({ length: Math.max(0, Math.min(n, 1000)) }, (_, i) => i),
    untilStep: (a: number, b: number, s: number) => Array.from({ length: Math.max(0, Math.min(Math.ceil((b - a) / (s || 1)), 1000)) }, (_, i) => a + i * s),
    dict: (...a: unknown[]) => {
      const o: Obj = {};
      for (let i = 0; i + 1 < a.length; i += 2) o[print(a[i])] = a[i + 1];
      return o;
    },
    get: (o: unknown, k: string) => (isObj(o) ? (o[k] ?? '') : ''),
    set: (o: unknown, k: string, v: unknown) => (isObj(o) ? ((o[k] = v), o) : o),
    unset: (o: unknown, k: string) => (isObj(o) ? (delete o[k], o) : o),
    hasKey: (o: unknown, k: string) => isObj(o) && k in o,
    keys: (...os: unknown[]) => os.flatMap((o) => (isObj(o) ? Object.keys(o) : [])),
    values: (o: unknown) => (isObj(o) ? Object.values(o) : []),
    pluck: (k: string, ...os: unknown[]) => os.filter(isObj).map((o) => o[k]),
    pick: (o: unknown, ...ks: string[]) => (isObj(o) ? Object.fromEntries(ks.filter((k) => k in o).map((k) => [k, o[k]])) : {}),
    omit: (o: unknown, ...ks: string[]) => (isObj(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !ks.includes(k))) : {}),
    dig: (...a: unknown[]) => {
      const o = a.at(-1);
      const d = a.at(-2);
      const v = field(o, a.slice(0, -2).map(String));
      return v === undefined ? d : v;
    },
    merge: (dst: unknown, ...src: unknown[]) => src.filter(isObj).reduce((d: Obj, s) => deepMerge(d, s), isObj(dst) ? dst : {}),
    mustMerge: (dst: unknown, ...src: unknown[]) => src.filter(isObj).reduce((d: Obj, s) => deepMerge(d, s), isObj(dst) ? dst : {}),
    mergeOverwrite: (dst: unknown, ...src: unknown[]) => Object.assign(isObj(dst) ? dst : {}, ...src.filter(isObj)),
    deepCopy: (v: unknown) => structuredClone(v),
    kindIs: (k: string, v: unknown) => kindOf(v) === k,
    kindOf: (v: unknown) => kindOf(v),
    typeOf: (v: unknown) => kindOf(v),
    typeIs: (k: string, v: unknown) => kindOf(v) === k,
    b64enc: (s: unknown) => btoa(unescape(encodeURIComponent(print(s)))),
    b64dec: (s: unknown) => {
      try {
        return decodeURIComponent(escape(atob(print(s))));
      } catch {
        return '';
      }
    },
    sha256sum: () => '…',
    sha1sum: () => '…',
    randAlphaNum: () => '…',
    uuidv4: () => '…',
    now: () => '…',
    date: () => '…',
    semverCompare: () => true,
    semver: (v: unknown) => ({ Major: Number(/\d+/.exec(print(v))?.[0] ?? 0) }),
    lookup: () => ({}),
    genCA: () => ({ Cert: '…', Key: '…' }),
    genSelfSignedCert: () => ({ Cert: '…', Key: '…' }),
    genSignedCert: () => ({ Cert: '…', Key: '…' }),
    htpasswd: () => '…',
    derivePassword: () => '…',
    index: (o: unknown, ...ks: unknown[]) => ks.reduce((v: unknown, k) => (Array.isArray(v) ? v[num(k)] : isObj(v) ? v[print(k)] : undefined), o),
    slice: (l: unknown, a?: number, b?: number) => (typeof l === 'string' ? l.slice(a, b) : list(l).slice(a, b)),
  };
}

const kindOf = (v: unknown) => (v == null ? 'invalid' : typeof v === 'string' ? 'string' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float64') : typeof v === 'boolean' ? 'bool' : Array.isArray(v) ? 'slice' : 'map');
