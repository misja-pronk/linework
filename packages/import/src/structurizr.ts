// Structurizr DSL → one `type: c4` file: the model (people, software systems, containers, components,
// relationships) and its views (systemLandscape, systemContext, container, component, dynamic,
// deployment). Styles, themes, properties and perspectives are left out: the C4 look is built in.
// Identifiers become the keys of nested elements, so `webapp` inside `bank` is `bank.webapp`.
import { Document, isScalar, isSeq, visit } from 'yaml';
import { Ids, slug, Warnings } from './text.ts';
import type { Imported } from './index.ts';

type Tok = string | { q: string };
interface Line {
  toks: Tok[];
  no: number;
}
interface El {
  path: string;
  kind: string;
  label: string;
  description?: string;
  technology?: string;
  tags: string[];
  url?: string;
  external?: boolean;
  /** Written inside the enterprise block. */
  inside?: boolean;
  children: El[];
}
interface DepNode {
  key: string;
  label: string;
  technology?: string;
  description?: string;
  count?: number;
  infra?: boolean;
  instances: string[];
  nodes: DepNode[];
}

const str = (t: Tok | undefined) => (t == null ? undefined : typeof t === 'string' ? t : t.q);
const word = (t: Tok | undefined) => (typeof t === 'string' ? t : undefined);

/** Lines of tokens: words, "quoted strings", braces and arrows; comments out. */
function lex(text: string): Line[] {
  const out: Line[] = [];
  const src = text.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  for (const [i, raw] of src.split('\n').entries()) {
    const toks: Tok[] = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\{|\}|->|=)|((?:\/\/|#).*$)|([^\s{}"=]+)/g;
    for (let m = re.exec(raw); m; m = re.exec(raw)) {
      if (m[3] != null) break;
      if (m[1] != null) toks.push({ q: m[1].replace(/\\"/g, '"') });
      else if (m[2]) toks.push(m[2]);
      else if (m[4]) toks.push(m[4]);
    }
    // "a { b }" on one line: split at the braces so each statement is a line of its own.
    let cur: Tok[] = [];
    for (const t of toks) {
      if (t === '{') (cur.push(t), out.push({ toks: cur, no: i + 1 }), (cur = []));
      else if (t === '}') (cur.length && out.push({ toks: cur, no: i + 1 }), out.push({ toks: ['}'], no: i + 1 }), (cur = []));
      else cur.push(t);
    }
    if (cur.length) out.push({ toks: cur, no: i + 1 });
  }
  return out;
}

export function importStructurizr(text: string, fallbackTitle = 'Imported workspace'): Imported {
  const warn = new Warnings();
  const lines = lex(text);
  let pos = 0;
  const opens = (l: Line) => l.toks.at(-1) === '{';
  /** Skips a block whose opening line was just read. */
  const skip = () => {
    for (let depth = 1; pos < lines.length && depth > 0; pos++) {
      if (lines[pos]!.toks[0] === '}') depth--;
      else if (opens(lines[pos]!)) depth++;
    }
  };

  let title = fallbackTitle;
  const top: El[] = [];
  const byId = new Map<string, El>();
  const keys = new Map<string, Ids>();
  const rels: { from: string; to: string; label?: string; technology?: string; async?: boolean; no: number }[] = [];
  const envs = new Map<string, DepNode[]>();
  const depIds = new Ids();
  const views: Record<string, Record<string, unknown>> = {};
  const viewIds = new Ids();
  let enterprise: string | undefined;

  const element = (kind: string, args: Tok[], parent: El | undefined, ident: string | undefined, inEnterprise: boolean): El => {
    // person/softwareSystem "name" "description" "tags"; container/component "name" "description" "technology" "tags".
    const [name, description, ...more] = args.map(str);
    const inner = kind === 'container' || kind === 'component';
    const tech = inner ? more[0] : undefined;
    const tags = (inner ? more[1] : more[0])?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];
    const siblings = keys.get(parent?.path ?? '') ?? new Ids();
    keys.set(parent?.path ?? '', siblings);
    const key = siblings.get(ident ?? name ?? kind, slug(ident ?? name ?? kind).toLowerCase());
    const el: El = { path: parent ? `${parent.path}.${key}` : key, kind, label: name ?? key, ...(description ? { description } : {}), ...(tech ? { technology: tech } : {}), tags, children: [] };
    if (inEnterprise) el.inside = true;
    if (tags.some((t) => /external|existing/i.test(t))) el.external = true;
    (parent ? parent.children : top).push(el);
    if (ident) byId.set(ident, el);
    return el;
  };

  const relation = (from: string | undefined, toks: Tok[], no: number) => {
    const at = toks.indexOf('->');
    const to = word(toks[at + 1]);
    const [label, technology, tags] = toks.slice(at + 2).map(str);
    if (!from || !to) return warn.add(`Line ${no}: a relationship needs both ends`);
    rels.push({ from, to, ...(label ? { label } : {}), ...(technology ? { technology } : {}), ...(tags && /async/i.test(tags) ? { async: true } : {}), no });
  };

  const KINDS: Record<string, string> = { person: 'person', softwareSystem: 'softwareSystem', softwaresystem: 'softwareSystem', container: 'container', component: 'component' };

  // The model: elements nest by braces; `this` and a bare `->` refer to the element whose block it is.
  const model = (parent: El | undefined, inEnterprise: boolean) => {
    while (pos < lines.length) {
      const l = lines[pos++]!;
      const t = l.toks;
      if (t[0] === '}') return;
      const ident = t[1] === '=' ? word(t[0]) : undefined;
      const rest = ident ? t.slice(2) : t;
      const head = word(rest[0]) ?? '';
      if (KINDS[head]) {
        const args = rest.slice(1).filter((x) => x !== '{');
        const el = element(KINDS[head]!, args, parent, ident, inEnterprise);
        if (opens(l)) model(el, inEnterprise);
      } else if (head === 'enterprise') {
        enterprise = str(rest[1]) ?? 'Enterprise';
        if (opens(l)) model(parent, true);
      } else if (head === 'group') {
        if (opens(l)) model(parent, inEnterprise);
      } else if (head === 'deploymentEnvironment') {
        const env = str(rest[1]) ?? 'Default';
        const list: DepNode[] = [];
        envs.set(env, list);
        if (opens(l)) deployment(list);
      } else if (rest.includes('->')) {
        const self = rest[0] === '->' || word(rest[0]) === 'this';
        relation(self ? parent && `@${parent.path}` : word(rest[0]), rest, l.no);
      } else if (parent && (head === 'description' || head === 'technology' || head === 'url')) {
        const v = str(rest[1]);
        if (v) parent[head === 'url' ? 'url' : head] = v;
      } else if (parent && head === 'tags') {
        parent.tags.push(...rest.slice(1).map(str).flatMap((x) => x!.split(',')).map((x) => x.trim()));
        if (parent.tags.some((x) => /external|existing/i.test(x))) parent.external = true;
      } else if (head === '!identifiers' || head === '!impliedRelationships' || head === '!docs' || head === '!adrs') continue;
      else if (opens(l)) skip();
      else if (head && !['properties', 'perspectives'].includes(head)) warn.add(`Line ${l.no}: "${head}" is not imported`);
    }
  };

  const deployment = (list: DepNode[]) => {
    while (pos < lines.length) {
      const l = lines[pos++]!;
      const t = l.toks;
      if (t[0] === '}') return;
      const rest = t[1] === '=' ? t.slice(2) : t;
      const head = word(rest[0]) ?? '';
      const args = rest.slice(1).filter((x) => x !== '{').map(str);
      if (head === 'deploymentNode' || head === 'infrastructureNode') {
        const [name, description, technology, , n] = args;
        const node: DepNode = {
          key: depIds.get(`${name}\0${l.no}`, slug(name ?? head).toLowerCase()),
          label: name ?? head,
          ...(technology ? { technology } : {}),
          ...(description ? { description } : {}),
          ...(n && Number(n) > 1 ? { count: Number(n) } : {}),
          ...(head === 'infrastructureNode' ? { infra: true } : {}),
          instances: [],
          nodes: [],
        };
        list.push(node);
        if (opens(l)) deployment(node.nodes);
        // Instances inside belong to this node: move them up from the nested list.
        for (const x of node.nodes.filter((c) => c.key.startsWith('\0'))) node.instances.push(...x.instances);
        node.nodes = node.nodes.filter((c) => !c.key.startsWith('\0'));
      } else if (head === 'containerInstance' || head === 'softwareSystemInstance') {
        const id = word(rest[1]);
        if (id) list.push({ key: '\0', label: '', instances: [id], nodes: [] });
        if (opens(l)) skip();
      } else if (opens(l)) skip();
    }
  };

  const viewBlock = (key: string, view: Record<string, unknown>) => {
    const steps: string[] = [];
    while (pos < lines.length) {
      const l = lines[pos++]!;
      const t = l.toks;
      if (t[0] === '}') break;
      const head = word(t[0]) ?? '';
      if (head === 'title' || head === 'description') view[head === 'title' ? 'title' : 'subtitle'] = str(t[1]);
      else if (t.includes('->') && view.kind === 'dynamic') steps.push(JSON.stringify(t.map(str)) + `\0${l.no}`);
      else if (head === 'autoLayout' || head === 'autolayout') {
        if (word(t[1]) === 'tb' || word(t[1]) === 'bt') view.direction = 'down';
        else if (word(t[1]) === 'lr' || word(t[1]) === 'rl') view.direction = 'right';
      } else if (opens(l)) continue; // parallel blocks in dynamic views: their steps are read in order
    }
    if (steps.length) view.steps = steps;
    views[key] = view;
  };

  const viewsSection = () => {
    while (pos < lines.length) {
      const l = lines[pos++]!;
      const t = l.toks;
      if (t[0] === '}') return;
      const head = word(t[0]) ?? '';
      const args = t.slice(1).filter((x) => x !== '{');
      const named = (fallback: string, at: number) => viewIds.get(str(args[at]) ?? fallback, slug(str(args[at]) ?? fallback));
      if (head === 'systemLandscape') viewBlock(named('landscape', 0), { kind: 'landscape', ...(enterprise ? { enterprise } : {}) });
      else if (head === 'systemContext') viewBlock(named(`context-${word(args[0])}`, 1), { kind: 'context', of: word(args[0]) });
      else if (head === 'container') viewBlock(named(`containers-${word(args[0])}`, 1), { kind: 'container', of: word(args[0]) });
      else if (head === 'component') viewBlock(named(`components-${word(args[0])}`, 1), { kind: 'component', of: word(args[0]) });
      else if (head === 'dynamic') viewBlock(named(`dynamic-${word(args[0]) === '*' ? 'all' : word(args[0])}`, 1), { kind: 'dynamic', ...(word(args[0]) !== '*' ? { of: word(args[0]) } : {}), ...(str(args[2]) ? { title: str(args[2]) } : {}) });
      else if (head === 'deployment') viewBlock(named(`deployment-${slug(str(args[1]) ?? 'all').toLowerCase()}`, 2), { kind: 'deployment', environment: str(args[1]), of: word(args[0]) });
      else if (opens(l)) {
        if (!['styles', 'theme', 'themes', 'branding', 'terminology', 'properties'].includes(head)) warn.add(`Line ${l.no}: "${head}" views are not imported`);
        skip();
      }
    }
  };

  while (pos < lines.length) {
    const l = lines[pos++]!;
    const head = word(l.toks[0]) ?? '';
    if (head === 'workspace') {
      title = str(l.toks[1]) ?? title;
      if (str(l.toks[1]) === undefined && word(l.toks[1]) === 'extends') warn.add('workspace extends: only this file is imported');
    } else if (head === 'model' && opens(l)) model(undefined, false);
    else if (head === 'views' && opens(l)) viewsSection();
    else if (opens(l) && head !== 'workspace') skip();
  }

  // Identifiers → element paths; `@path` is already one (the element whose block it was).
  // Outside the enterprise, or tagged so: external (greyed systems, people outside the boundary).
  if (enterprise) for (const el of top) if (!el.inside) el.external = true;
  const pathOf = (id: string) => (id.startsWith('@') ? id.slice(1) : byId.get(id)?.path);
  const out: Record<string, unknown> = { type: 'c4', title };
  if (!top.length) return { yaml: '', warnings: [...warn.list, 'No model elements found'] };

  const KIND: Record<string, string> = { person: 'person', softwareSystem: 'software-system', container: 'container', component: 'component' };
  const variant = (el: El) => {
    if (el.kind !== 'container') return KIND[el.kind]!;
    const words = `${el.tags.join(' ')} ${el.technology ?? ''} ${el.label}`.toLowerCase();
    if (/database|\bdb\b|postgres|mysql|oracle|sql|mongo|schema/.test(words)) return 'database';
    if (/queue|topic|kafka|rabbit|bus|sqs|stream/.test(words)) return 'queue';
    if (/mobile|ios|android/.test(words)) return 'mobile-app';
    if (/web ?browser|single-page|spa|web app|frontend|react|angular|vue/.test(words)) return 'web-app';
    return 'container';
  };
  const elementMap = (list: El[]): Record<string, unknown> =>
    Object.fromEntries(
      list.map((el) => [
        el.path.split('.').at(-1)!,
        {
          kind: variant(el),
          label: el.label,
          ...(el.technology ? { technology: el.technology } : {}),
          ...(el.description ? { description: el.description } : {}),
          ...(el.external ? { external: true } : {}),
          ...(el.url ? { links: [el.url] } : {}),
          ...(el.children.length ? { elements: elementMap(el.children) } : {}),
        },
      ]),
    );
  out.elements = elementMap(top);
  const relationItem = (from: string, to: string, label?: string, technology?: string, async?: boolean) => {
    const props = { ...(label ? { label } : {}), ...(technology ? { technology } : {}), ...(async ? { style: 'async' } : {}) };
    const arrow = `${from} -> ${to}`;
    return Object.keys(props).length === 0 ? arrow : Object.keys(props).length === 1 && label ? { [arrow]: label } : { [arrow]: props };
  };
  const relations: unknown[] = [];
  for (const r of rels) {
    const [from, to] = [pathOf(r.from), pathOf(r.to)];
    if (!from || !to) warn.add(`Line ${r.no}: unknown element "${!from ? r.from : r.to}"`);
    else relations.push(relationItem(from, to, r.label, r.technology, r.async));
  }
  if (relations.length) out.relations = relations;

  const finished: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(views)) {
    const view: Record<string, unknown> = { ...v };
    if (typeof view.of === 'string') {
      const p = pathOf(view.of);
      if (!p) (warn.add(`View "${key}": unknown element "${view.of}"`), delete view.of);
      else view.of = p;
    }
    if (view.kind === 'dynamic')
      view.steps = ((view.steps as string[]) ?? []).flatMap((s) => {
        const [json, no] = s.split('\0') as [string, string];
        const t = JSON.parse(json) as string[];
        const at = t.indexOf('->');
        const [from, to] = [pathOf(t[at - 1] ?? ''), pathOf(t[at + 1] ?? '')];
        if (!from || !to) return (warn.add(`Line ${no}: unknown element in a dynamic step`), []);
        return [relationItem(from, to, t[at + 2], t[at + 3])];
      });
    if (view.kind === 'deployment') {
      const env = envs.get(String(view.environment));
      delete view.environment;
      delete view.of;
      if (!env) {
        warn.add(`View "${key}": no deploymentEnvironment "${v.environment}"`);
        continue;
      }
      const tree = (list: DepNode[]): Record<string, unknown> =>
        Object.fromEntries(
          list.filter((n) => !n.key.startsWith('\0')).map((n) => [
            n.key,
            {
              ...(n.infra ? { kind: 'infrastructure' } : {}),
              label: n.label,
              ...(n.technology ? { technology: n.technology } : {}),
              ...(n.count ? { count: n.count } : {}),
              ...(n.instances.length ? { instances: n.instances.map((i) => pathOf(i) ?? (warn.add(`Unknown instance "${i}"`), i)) } : {}),
              ...(n.nodes.length ? { nodes: tree(n.nodes) } : {}),
            },
          ]),
        );
      view.title ??= `${title} — ${v.environment}`;
      view.nodes = tree(env);
    }
    finished[key] = view;
  }
  if (Object.keys(finished).length) out.views = finished;
  else warn.add('No views found: add views: to draw the model');

  // Leaf maps on one line, as people write them by hand.
  const doc = new Document(out);
  // A relation with only a label stays "a -> b: label".
  const arrow = (k: unknown) => isScalar(k) && String(k.value).includes('->');
  visit(doc, { Map: (_, node) => void (!(node.items.length === 1 && arrow(node.items[0]!.key)) && node.items.every((p) => isScalar(p.value) || (isSeq(p.value) && p.value.items.every(isScalar))) && (node.flow = true)) });
  (doc.contents as { flow?: boolean }).flow = false;
  return { yaml: doc.toString({ lineWidth: 0, flowCollectionPadding: true }), warnings: warn.list };
}

export const isStructurizr = (text: string) => /^\s*workspace\b/m.test(text.replace(/^\s*(\/\/|#).*$/gm, ''));
