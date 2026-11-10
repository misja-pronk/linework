// Systems and C4: what any architecture review asks, whatever runs it: who touches the data, how
// deep calls go, what everything hangs on, and calls that go round in circles.
import { t } from '../nl.ts';
import type { Hit, Rule } from '../types.ts';
import type { Line, ReviewModel } from '../model.ts';

const pack = 'systems';
const generic = ['systems', 'c4'];
const STORES = ['database', 'cache', 'storage', 'warehouse', 'search'];
/** People are not called: lines to and from them are not part of a call chain. */
const PEOPLE = ['user', 'users', 'person'];
const REPLY = /\b(repl(y|ies)|responds?|response|returns?|callback|ack(nowledges?)?|notif(y|ies))\b/i;

/** Calls that wait for an answer, between parts of the architecture (not people, not outsiders). */
function calls(m: ReviewModel): Map<string, Line[]> {
  const out = new Map<string, Line[]>();
  for (const l of m.lines) {
    if (l.badge || l.from === l.to || m.async(l) || REPLY.test(l.label)) continue;
    if (m.outsider(l.from) || PEOPLE.includes(m.el(l.from)?.kind ?? '') || PEOPLE.includes(m.el(l.to)?.kind ?? '')) continue;
    if (!m.nodes.has(l.from) || !m.nodes.has(l.to)) continue;
    // A dashed or dotted line is a supporting link, not a request (systems: dotted "Supporting").
    if (m.edge(l.id)?.line === 'dotted') continue;
    out.set(l.from, [...(out.get(l.from) ?? []), l]);
  }
  return out;
}

/** How many instances it says it runs: count:, replicas:, instances:, or a stack of two cards. */
function instances(m: ReviewModel, id: string): number | undefined {
  for (const k of ['count', 'replicas', 'instances']) {
    const v = m.prop(id, k);
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+/.test(v)) return Number(/^\d+/.exec(v)![0]);
  }
  const n = m.graph.nodes.find((x) => x.id === id);
  if (n?.shape.kind === 'card' && n.shape.stack) return 2;
  const z = m.prop(id, 'zones');
  if ((typeof z === 'number' && z > 1) || (Array.isArray(z) && z.length > 1) || z === 'redundant') return 2;
  if (m.tagged(id, 'ha', 'redundant', 'clustered', 'zone-redundant')) return 2;
  return undefined;
}

export const systemsRules: Rule[] = [
  {
    id: 'arch.external-to-datastore',
    pack,
    title: 'Outside parties reach data through a service',
    why: 'A person or another company\'s system writing to a database directly bypasses every check, log and limit a service would apply.',
    severity: 'warn',
    category: 'security',
    appliesTo: generic,
    fix: 'Put an API or service in front of the store that authenticates, validates and logs; draw the line through it',
    check(m) {
      return m.lines
        .filter((l) => !l.badge && m.outsider(l.from) && !m.outsider(l.to) && STORES.includes(m.el(l.to)?.kind ?? ''))
        .map((l) => ({ on: { kind: 'edge', id: l.id }, message: t(m.lang, '{from} reaches {to} directly', { from: m.name(l.from), to: m.name(l.to) }) }));
    },
  },
  {
    id: 'arch.deep-sync-chain',
    pack,
    title: 'Synchronous call chains stay short',
    why: 'Every synchronous hop adds latency and multiplies the chance of failure: five services at 99.9 % each are up 99.5 % together.',
    severity: 'warn',
    category: 'performance',
    appliesTo: generic,
    options: { 'max-chain': 4 },
    fix: 'Cut the chain: answer from a cache or a read model, or hand the rest of the work to a queue (an async line); max-chain in rules.yaml sets how deep is too deep',
    check(m, o) {
      const max = o['max-chain'] ?? 4;
      const graph = calls(m);
      const longest = new Map<string, string[]>();
      // The longest simple path is a hard problem: a budget keeps a big import from taking long.
      let budget = 20000;
      const walk = (id: string, seen: Set<string>): string[] => {
        let best: string[] = [id];
        if (--budget < 0) return best;
        for (const l of graph.get(id) ?? []) {
          if (seen.has(l.to)) continue;
          seen.add(l.to);
          const rest = walk(l.to, seen);
          seen.delete(l.to);
          if (rest.length + 1 > best.length) best = [id, ...rest];
        }
        return best;
      };
      const called = new Set([...graph.values()].flat().map((l) => l.to));
      // From where chains start: called by nobody inside (a cycle starts anywhere, its own rule says so).
      const starts = [...graph.keys()].filter((id) => !called.has(id));
      for (const s of starts.length ? starts : [...graph.keys()].slice(0, 1)) longest.set(s, walk(s, new Set([s])));
      const hits: Hit[] = [];
      const said = new Set<string>();
      for (const [start, chain] of [...longest].sort((a, b) => b[1].length - a[1].length)) {
        const hops = chain.length - 1;
        const key = chain.slice(1).join('>');
        if (hops <= max || said.has(key)) continue;
        said.add(key);
        hits.push({ on: { kind: 'node', id: start }, message: t(m.lang, '{count} synchronous calls in a row: {chain}', { count: hops, chain: chain.map((id) => m.name(id)).join(' → ') }) });
      }
      return hits;
    },
  },
  {
    id: 'arch.single-point-of-failure',
    pack,
    title: 'What many depend on runs more than once',
    why: 'One instance with many dependents takes them all down when it fails or is patched.',
    severity: 'warn',
    category: 'reliability',
    appliesTo: generic,
    options: { 'min-dependents': 3 },
    fix: 'Run it at least twice, in different zones, and say so: props: { count: 2 } (count: on a deployment node), zones: 3 or tags: [ha]',
    check(m, o) {
      const min = o['min-dependents'] ?? 3;
      // Instances only mean something where the drawing counts them somewhere.
      const counted = [...m.nodes.keys()].some((id) => instances(m, id) !== undefined);
      const hits: Hit[] = [];
      for (const e of m.nodes.values()) {
        if (m.outsider(e.id) || PEOPLE.includes(e.kind ?? '')) continue;
        const n = instances(m, e.id);
        if (n !== undefined ? n > 1 : !counted) continue;
        const dependents = new Set(m.in(e.id).filter((l) => !m.outsider(l.from) && !l.badge && !m.async(l)).map((l) => l.from));
        if (dependents.size >= min) hits.push({ on: { kind: 'node', id: e.id }, message: t(m.lang, '{name} runs once and {count} elements depend on it', { name: e.label, count: dependents.size }) });
      }
      return hits;
    },
  },
  {
    id: 'arch.service-cycle',
    pack,
    title: 'Services do not call each other in a circle',
    why: 'A cycle of synchronous calls deadlocks under load, retries amplify through it, and none of the services can be deployed alone.',
    severity: 'warn',
    category: 'reliability',
    appliesTo: generic,
    fix: 'Break the cycle: let one side publish an event instead of calling back, or move what both need into one service',
    check(m) {
      const graph = calls(m);
      // Tarjan's strongly connected components.
      let index = 0;
      const ix = new Map<string, number>();
      const low = new Map<string, number>();
      const stack: string[] = [];
      const on = new Set<string>();
      const sccs: string[][] = [];
      const visit = (v: string) => {
        ix.set(v, index);
        low.set(v, index++);
        stack.push(v);
        on.add(v);
        for (const l of graph.get(v) ?? []) {
          if (!ix.has(l.to)) {
            visit(l.to);
            low.set(v, Math.min(low.get(v)!, low.get(l.to)!));
          } else if (on.has(l.to)) low.set(v, Math.min(low.get(v)!, ix.get(l.to)!));
        }
        if (low.get(v) === ix.get(v)) {
          const c: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            on.delete(w);
            c.push(w);
          } while (w !== v);
          if (c.length > 1) sccs.push(c);
        }
      };
      for (const id of m.nodes.keys()) if (!ix.has(id)) visit(id);
      const order = [...m.nodes.keys()];
      return sccs.map((c) => {
        const members = c.sort((a, b) => order.indexOf(a) - order.indexOf(b));
        return { on: { kind: 'node' as const, id: members[0]! }, message: t(m.lang, '{names} call each other in a circle', { names: members.map((id) => m.name(id)).join(', ') }) };
      });
    },
  },
];
