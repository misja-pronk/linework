// ARM templates → the estate: the JSON `az bicep build` writes, and templates exported from the portal or
// with `az group export`. Bicep is never run; the compiled JSON is read. Expressions are worked out as
// far as the template itself says: parameters with defaults (or a parameters file), variables,
// concat, format, resourceId, modules (nested deployments) with what they are given and what they
// give back. What depends on the deployment (uniqueString of a resource group id) reads `…`; what
// cannot be known at all (a reference to something deployed elsewhere) keeps the expression's words.
import { Estate, readDetails } from './azure-estate.ts';
import { subnet } from './azure-graph.ts';
import { isObj, str, type Obj } from './keep.ts';

/** A deployment template: `$schema` …/deploymentTemplate.json#, with resources. */
export const isTemplate = (json: unknown): json is Obj => isObj(json) && /deploymentTemplate\.json/i.test(String(json.$schema ?? '')) && (Array.isArray(json.resources) || isObj(json.resources));
/** A parameters file: `$schema` …/deploymentParameters.json#. */
export const isParameters = (json: unknown): json is Obj => isObj(json) && /deploymentParameters\.json/i.test(String(json.$schema ?? '')) && isObj(json.parameters);

// ---------------------------------------------------------------- expressions

type Token = { t: 'str' | 'num' | 'id' | 'punct'; v: string };

function tokens(s: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (/\s/.test(c)) i++;
    else if (c === "'") {
      let v = '';
      for (i++; i < s.length; i++) {
        if (s[i] === "'" && s[i + 1] === "'") (v += "'"), i++;
        else if (s[i] === "'") break;
        else v += s[i];
      }
      i++;
      out.push({ t: 'str', v });
    } else if (/[0-9-]/.test(c) && /[0-9]/.test(s[i + (c === '-' ? 1 : 0)] ?? '')) {
      const m = /^-?\d+(\.\d+)?/.exec(s.slice(i))![0];
      out.push({ t: 'num', v: m });
      i += m.length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][\w]*/.exec(s.slice(i))![0];
      out.push({ t: 'id', v: m });
      i += m.length;
    } else (out.push({ t: 'punct', v: c }), i++);
  }
  return out;
}

type Node = { k: 'lit'; v: unknown } | { k: 'call'; name: string; args: Node[] } | { k: 'prop'; of: Node; name: Node };

function parse(s: string): Node {
  const ts = tokens(s);
  let i = 0;
  const expect = (v: string) => {
    if (ts[i]?.v !== v) throw new Error(`expected ${v}`);
    i++;
  };
  const primary = (): Node => {
    const t = ts[i++];
    if (!t) throw new Error('unexpected end');
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'num') return { k: 'lit', v: Number(t.v) };
    if (t.t === 'id') {
      if (ts[i]?.v !== '(') return { k: 'lit', v: t.v === 'true' ? true : t.v === 'false' ? false : t.v === 'null' ? null : t.v };
      i++;
      const args: Node[] = [];
      while (ts[i] && ts[i]!.v !== ')') {
        args.push(expr());
        if (ts[i]?.v === ',') i++;
      }
      expect(')');
      return { k: 'call', name: t.v.toLowerCase(), args };
    }
    throw new Error(`unexpected ${t.v}`);
  };
  const expr = (): Node => {
    let n = primary();
    for (;;) {
      if (ts[i]?.v === '.' && ts[i + 1]?.t === 'id') {
        n = { k: 'prop', of: n, name: { k: 'lit', v: ts[i + 1]!.v } };
        i += 2;
      } else if (ts[i]?.v === '[') {
        i++;
        const at = expr();
        expect(']');
        n = { k: 'prop', of: n, name: at };
      } else return n;
    }
  };
  const n = expr();
  if (i < ts.length) throw new Error('trailing text');
  return n;
}

/** What could not be worked out, in words: {parameters('env')}. Strings that hold one are marked. */
const UNKNOWN = /\{[^{}]*\}/;
const unknown = (what: string) => `{${what}}`;

export interface Scope {
  params: Obj;
  variables: Obj;
  rg: string;
  sub: string;
  copy: Map<string, number>;
  /** Symbolic names of resources (languageVersion 2.0) and names given to deployments → resource id. */
  symbols: Map<string, string>;
  deployments: Map<string, () => Obj>;
  /** Variables are worked out once, when first used. */
  cache: Map<string, unknown>;
  unresolved: Set<string>;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v == null ? '' : JSON.stringify(v));

function resourceIdOf(scope: Scope, args: unknown[], level: 'rg' | 'sub' | 'tenant'): string {
  let a = args.map(asString);
  let sub = scope.sub;
  let rg = scope.rg;
  const typeAt = a.findIndex((x) => /^[A-Za-z0-9]+\.[A-Za-z0-9.]+\/[A-Za-z]/.test(x));
  if (typeAt < 0) return unknown('resourceId');
  if (level === 'rg') {
    if (typeAt === 2) [sub, rg] = [a[0]!, a[1]!];
    else if (typeAt === 1) rg = a[0]!;
  } else if (level === 'sub' && typeAt === 1) sub = a[0]!;
  const [type, ...names] = a.slice(typeAt);
  const [ns, ...types] = type!.split('/');
  const path = types.map((t, j) => `${t}/${names[j] ?? unknown('name')}`).join('/');
  if (level === 'tenant') return `/providers/${ns}/${path}`;
  if (level === 'sub') return `/subscriptions/${sub}/providers/${ns}/${path}`;
  return `/subscriptions/${sub}/resourceGroups/${rg}/providers/${ns}/${path}`;
}

function evaluate(node: Node, scope: Scope): unknown {
  if (node.k === 'lit') return node.v;
  if (node.k === 'prop') {
    const of = evaluate(node.of, scope);
    const name = evaluate(node.name, scope);
    if (Array.isArray(of) && typeof name === 'number') return of[name];
    if (isObj(of) && typeof name === 'string') {
      const key = Object.keys(of).find((k) => k.toLowerCase() === name.toLowerCase());
      return key === undefined ? unknown(`${asString(of.__ref ?? 'object')}.${name}`) : of[key];
    }
    return typeof of === 'string' && UNKNOWN.test(of) ? `${of.slice(0, -1)}.${asString(name)}}` : unknown(`.${asString(name)}`);
  }
  const lazy = node.args;
  const args = () => lazy.map((a) => evaluate(a, scope));
  switch (node.name) {
    case 'parameters': {
      const n = asString(evaluate(lazy[0]!, scope));
      if (n in scope.params) return scope.params[n];
      scope.unresolved.add(`parameter ${n}`);
      return unknown(n);
    }
    case 'variables': {
      const n = asString(evaluate(lazy[0]!, scope));
      if (scope.cache.has(n)) return scope.cache.get(n);
      if (!(n in scope.variables)) return unknown(n);
      scope.cache.set(n, unknown(n));
      const v = deep(scope.variables[n], scope);
      scope.cache.set(n, v);
      return v;
    }
    case 'concat': {
      const a = args();
      return a.every(Array.isArray) && a.length ? (a as unknown[][]).flat() : a.map(asString).join('');
    }
    case 'format': {
      const [f, ...rest] = args();
      return asString(f).replace(/\{(\d+)(:[^}]*)?\}/g, (_, i: string) => asString(rest[Number(i)]));
    }
    case 'resourceid':
      return resourceIdOf(scope, args(), 'rg');
    case 'subscriptionresourceid':
      return resourceIdOf(scope, args(), 'sub');
    case 'tenantresourceid':
    case 'managementgroupresourceid':
      return resourceIdOf(scope, args(), 'tenant');
    case 'extensionresourceid': {
      const [on, ...rest] = args();
      return `${asString(on)}${resourceIdOf(scope, rest, 'tenant')}`;
    }
    case 'resourceinfo':
    case 'reference': {
      const what = asString(evaluate(lazy[0]!, scope));
      const id = scope.symbols.get(what) ?? what;
      // A module's outputs: worked out from its own template.
      const deployment = /\/providers\/Microsoft\.Resources\/deployments\/([^/]+)$/i.exec(id)?.[1] ?? (scope.deployments.has(what) ? what : undefined);
      if (deployment && scope.deployments.has(deployment)) return { outputs: scope.deployments.get(deployment)!(), __ref: deployment };
      return { id, name: id.split('/').pop(), __ref: `reference(${id.split('/').pop()})`, ...(node.name === 'resourceinfo' ? {} : { properties: {} }) };
    }
    case 'resourcegroup':
      return { name: scope.rg, id: `/subscriptions/${scope.sub}/resourceGroups/${scope.rg}`, location: unknown('location') };
    case 'subscription':
      return { subscriptionId: scope.sub, id: `/subscriptions/${scope.sub}`, tenantId: unknown('tenantId') };
    case 'tenant':
      return { tenantId: unknown('tenantId') };
    case 'deployment':
      return { name: 'deployment', properties: {} };
    case 'environment':
      return { name: 'AzureCloud', suffixes: { storage: 'core.windows.net', keyvaultDns: '.vault.azure.net', sqlServerHostname: '.database.windows.net', acrLoginServer: '.azurecr.io' } };
    case 'uniquestring':
    case 'guid':
    case 'newguid':
    case 'utcnow':
      // Different for every deployment: not something to guess.
      return '…';
    case 'copyindex': {
      const a = args();
      const name = typeof a[0] === 'string' ? a[0] : undefined;
      const offset = Number(typeof a[0] === 'number' ? a[0] : a[1] ?? 0);
      const at = name ? scope.copy.get(name) : [...scope.copy.values()].at(-1);
      return at === undefined ? unknown('copyIndex') : at + offset;
    }
    case 'tolower':
      return asString(args()[0]).toLowerCase();
    case 'toupper':
      return asString(args()[0]).toUpperCase();
    case 'trim':
      return asString(args()[0]).trim();
    case 'string':
      return asString(args()[0]);
    case 'int':
      return Number(args()[0]);
    case 'bool':
      return /^true$/i.test(asString(args()[0]));
    case 'replace': {
      const [s, a, b] = args().map(asString);
      return s!.split(a!).join(b!);
    }
    case 'substring': {
      const [s, start, len] = args();
      return asString(s).substr(Number(start ?? 0), len === undefined ? undefined : Number(len));
    }
    case 'take':
    case 'skip': {
      const [x, n] = args();
      const f = (v: string | unknown[]) => (node.name === 'take' ? v.slice(0, Number(n)) : v.slice(Number(n)));
      return Array.isArray(x) ? f(x) : f(asString(x));
    }
    case 'first':
    case 'last': {
      const x = args()[0];
      const v = Array.isArray(x) ? x : asString(x);
      return node.name === 'first' ? v[0] : v[v.length - 1];
    }
    case 'length': {
      const x = args()[0];
      return Array.isArray(x) ? x.length : isObj(x) ? Object.keys(x).length : asString(x).length;
    }
    case 'split':
      return asString(args()[0]).split(asString(args()[1]));
    case 'join':
      return (args()[0] as unknown[]).map(asString).join(asString(args()[1]));
    case 'if':
      return evaluate(lazy[evaluate(lazy[0]!, scope) === true ? 1 : 2]!, scope);
    case 'equals': {
      const [a, b] = args();
      return JSON.stringify(a) === JSON.stringify(b);
    }
    case 'not':
      return args()[0] !== true;
    case 'and':
      return args().every((x) => x === true);
    case 'or':
      return args().some((x) => x === true);
    case 'empty': {
      const x = args()[0];
      return x == null || x === '' || (Array.isArray(x) && !x.length) || (isObj(x) && !Object.keys(x).length);
    }
    case 'contains': {
      const [x, v] = args();
      return Array.isArray(x) ? x.some((y) => JSON.stringify(y) === JSON.stringify(v)) : isObj(x) ? asString(v) in x : asString(x).toLowerCase().includes(asString(v).toLowerCase());
    }
    case 'startswith':
      return asString(args()[0]).toLowerCase().startsWith(asString(args()[1]).toLowerCase());
    case 'endswith':
      return asString(args()[0]).toLowerCase().endsWith(asString(args()[1]).toLowerCase());
    case 'coalesce':
      return args().find((x) => x != null);
    case 'union': {
      const a = args();
      return a.every(Array.isArray) ? [...new Set((a as unknown[][]).flat().map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x) as unknown) : Object.assign({}, ...a.filter(isObj));
    }
    case 'createobject': {
      const a = args();
      const o: Obj = {};
      for (let j = 0; j + 1 < a.length; j += 2) o[asString(a[j])] = a[j + 1];
      return o;
    }
    case 'createarray':
    case 'array':
      return node.name === 'array' && Array.isArray(args()[0]) ? args()[0] : args();
    case 'range': {
      const [start, count] = args().map(Number);
      return Array.from({ length: Math.min(count!, 200) }, (_, j) => start! + j);
    }
    case 'add':
      return Number(args()[0]) + Number(args()[1]);
    case 'sub':
      return Number(args()[0]) - Number(args()[1]);
    case 'mul':
      return Number(args()[0]) * Number(args()[1]);
    case 'div':
      return Math.trunc(Number(args()[0]) / Number(args()[1]));
    case 'mod':
      return Number(args()[0]) % Number(args()[1]);
    case 'min':
    case 'max': {
      const a = args().flat().map(Number);
      return node.name === 'min' ? Math.min(...a) : Math.max(...a);
    }
    case 'true':
      return true;
    case 'false':
      return false;
    case 'null':
      return null;
    case 'json':
      try {
        return JSON.parse(asString(args()[0])) as unknown;
      } catch {
        return unknown('json');
      }
    default:
      scope.unresolved.add(`${node.name}()`);
      return unknown(`${node.name}()`);
  }
}

/** One value of a template: a string in [brackets] is an expression; [[ is a plain [. */
export function value(v: unknown, scope: Scope): unknown {
  if (typeof v !== 'string' || !v.startsWith('[') || !v.endsWith(']') || v.startsWith('[[')) return typeof v === 'string' && v.startsWith('[[') ? v.slice(1) : v;
  try {
    return evaluate(parse(v.slice(1, -1)), scope);
  } catch {
    scope.unresolved.add('an expression');
    return unknown(v.slice(1, 41));
  }
}

/** A value with everything in it worked out; `copy` loops in properties (Bicep's for) unrolled. */
function deep(v: unknown, scope: Scope): unknown {
  if (Array.isArray(v)) return v.map((x) => deep(x, scope));
  if (!isObj(v)) return value(v, scope);
  const out: Obj = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'copy' && Array.isArray(x)) {
      for (const loop of x.filter(isObj)) {
        const name = asString(loop.name);
        const count = Math.min(Number(value(loop.count, scope)) || 0, 200);
        out[name] = Array.from({ length: count }, (_, j) => {
          scope.copy.set(name, j);
          const item = deep(loop.input, scope);
          scope.copy.delete(name);
          return item;
        });
      }
      continue;
    }
    out[k] = deep(x, scope);
  }
  return out;
}

// ---------------------------------------------------------------- resources

export const TARGET_RG = '(target resource group)';
export const TARGET_SUB = '(subscription)';

/** Reads a template (and the modules in it) into the estate; the number of resources read. */
export function readTemplate(estate: Estate, template: Obj, given: Obj = {}, at: { rg?: string; sub?: string } = {}, unresolved = new Set<string>()): number {
  estate.sources.add('arm');
  const params: Obj = {};
  for (const [k, p] of Object.entries(isObj(template.parameters) ? template.parameters : {})) if (isObj(p) && 'defaultValue' in p) params[k] = p.defaultValue;
  const scope: Scope = { params, variables: isObj(template.variables) ? template.variables : {}, rg: at.rg ?? TARGET_RG, sub: at.sub ?? TARGET_SUB, copy: new Map(), symbols: new Map(), deployments: new Map(), cache: new Map(), unresolved };
  // Defaults may use other parameters; what was given wins.
  for (const [k, v] of Object.entries(params)) params[k] = deep(v, scope);
  Object.assign(params, given);
  // Variable copy loops: `copy: [{ name, count, input }]` at the top of variables.
  if (Array.isArray(scope.variables.copy)) scope.variables = { ...scope.variables, ...(deep({ copy: scope.variables.copy }, scope) as Obj) };

  let n = 0;
  const entries: [string | undefined, Obj][] = Array.isArray(template.resources) ? template.resources.filter(isObj).map((r) => [undefined, r]) : Object.entries(template.resources as Obj).flatMap(([k, r]) => (isObj(r) ? [[k, r] as [string, Obj]] : []));
  // Symbols first: a resource may refer to one declared after it.
  const idOf = (r: Obj, parent?: { type: string; name: string }) => {
    let type = asString(value(r.type, scope));
    let name = asString(value(r.name, scope));
    if (parent && !type.includes('/')) type = `${parent.type}/${type}`;
    if (parent && name.split('/').length < type.split('/').length - 1) name = `${parent.name}/${name}`;
    if (typeof r.parent === 'string') {
      const p = scope.symbols.get(r.parent);
      // The parent's names come before the child's: vnet/snet-app.
      if (p && !name.includes('/')) name = [...p.slice(p.lastIndexOf('/providers/') + 11).split('/').slice(1).filter((_, j) => j % 2 === 1), name].join('/');
    }
    const names = name.split('/');
    const rid = /^microsoft\.resources\/deployments$/i.test(type)
      ? `/subscriptions/${scope.sub}/resourceGroups/${scope.rg}/providers/Microsoft.Resources/deployments/${name}`
      : resourceIdOf(scope, [type, ...names], 'rg');
    // An extension resource is on what its scope names.
    const on = r.scope !== undefined ? asString(value(r.scope, scope)) : undefined;
    const scoped = on ? `${scope.symbols.get(on) ?? on}${rid.slice(rid.indexOf('/providers/'))}` : rid;
    return { type, name, id: scoped };
  };
  const expanded: { symbol?: string; r: Obj; index?: number; loop?: string }[] = [];
  for (const [symbol, r] of entries) {
    const copy = isObj(r.copy) ? r.copy : undefined;
    if (!copy) {
      expanded.push({ symbol, r });
      continue;
    }
    const loop = asString(copy.name);
    const count = Math.min(Number(value(copy.count, scope)) || 0, 200);
    for (let j = 0; j < count; j++) expanded.push({ symbol, r, index: j, loop });
  }
  for (const e of expanded) {
    if (e.loop) scope.copy.set(e.loop, e.index!);
    const { id } = idOf(e.r);
    if (e.symbol && e.index === undefined) scope.symbols.set(e.symbol, id);
    if (e.loop) scope.copy.delete(e.loop);
  }
  const read = (r: Obj, parent?: { type: string; name: string }) => {
    if (r.condition !== undefined && value(r.condition, scope) === false) return;
    const { type, name, id } = idOf(r, parent);
    if (r.existing === true) return;
    if (/^microsoft\.resources\/deployments$/i.test(type)) {
      const p = isObj(r.properties) ? r.properties : {};
      const inner = isObj(p.template) ? p.template : undefined;
      if (!inner) return void unresolved.add(`module ${name} (a linked template is not read)`);
      const where = { rg: r.resourceGroup !== undefined ? asString(value(r.resourceGroup, scope)) : scope.rg, sub: r.subscriptionId !== undefined ? asString(value(r.subscriptionId, scope)) : scope.sub };
      let outputs: Obj | undefined;
      // In a loop: the module of this turn, when it is read later.
      const turn = new Map(scope.copy);
      const run = () => {
        if (outputs) return outputs;
        outputs = {};
        const saved = scope.copy;
        scope.copy = new Map(turn);
        // What the module is given is worked out here, the outputs of its siblings known by now.
        const values: Obj = {};
        for (const [k, v] of Object.entries(isObj(p.parameters) ? p.parameters : {})) if (isObj(v) && 'value' in v) values[k] = deep(v.value, scope);
        scope.copy = saved;
        const before = estate.resources.size;
        readTemplate(estate, inner, values, where, unresolved);
        n += estate.resources.size - before;
        outputs = outputsOf(inner, values, where, unresolved);
        return outputs;
      };
      scope.deployments.set(name, run);
      return;
    }
    const props = deep(r.properties ?? {}, scope);
    const row: Obj = { properties: props, sku: deep(r.sku, scope), kind: value(r.kind, scope), location: value(r.location, scope), identity: deep(r.identity, scope) };
    const res = estate.resource(id, { type: type.toLowerCase(), name: name.split('/').pop(), unresolved: UNKNOWN.test(name) || undefined });
    readDetails(res, row);
    n++;
    if (/^microsoft\.network\/virtualnetworks$/i.test(type) && isObj(props)) for (const s of Array.isArray(props.subnets) ? props.subnets.filter(isObj) : []) subnet(estate, res, s);
    for (const child of Array.isArray(r.resources) ? r.resources.filter(isObj) : []) read(child, { type, name });
  };
  // Modules first, so what is given to one or set from one can use the outputs of another.
  const isModule = (r: Obj) => /^microsoft\.resources\/deployments$/i.test(asString(value(r.type, scope)));
  for (const pass of [true, false])
    for (const e of expanded) {
      if (isModule(e.r) !== pass) continue;
      if (e.loop) scope.copy.set(e.loop, e.index!);
      read(e.r);
      if (e.loop) scope.copy.delete(e.loop);
    }
  // Modules no output of which was asked for: read them now.
  for (const run of scope.deployments.values()) run();
  return n;
}

function outputsOf(template: Obj, given: Obj, at: { rg: string; sub: string }, unresolved: Set<string>): Obj {
  const params: Obj = {};
  for (const [k, p] of Object.entries(isObj(template.parameters) ? template.parameters : {})) if (isObj(p) && 'defaultValue' in p) params[k] = p.defaultValue;
  Object.assign(params, given);
  const scope: Scope = { params, variables: isObj(template.variables) ? template.variables : {}, rg: at.rg, sub: at.sub, copy: new Map(), symbols: new Map(), deployments: new Map(), cache: new Map(), unresolved };
  // Symbols, so an output can name a resource of the module by its symbolic name.
  if (isObj(template.resources))
    for (const [k, r] of Object.entries(template.resources))
      if (isObj(r)) scope.symbols.set(k, resourceIdOf(scope, [asString(value(r.type, scope)), ...asString(value(r.name, scope)).split('/')], 'rg'));
  const out: Obj = {};
  for (const [k, o] of Object.entries(isObj(template.outputs) ? template.outputs : {})) if (isObj(o)) out[k] = { value: deep(o.value, scope) };
  return out;
}
