// Class diagrams and mind maps from Mermaid (classDiagram, mindmap) and PlantUML (class, @startmindmap),
// and the YAML both types are written in. D2's class shapes come in through classYaml too (d2.ts).
//
//   Mermaid classDiagram   class A, class A~T~, class A { … }, A : +member, <<interface>>, namespace,
//                          relations with "multiplicities" and : labels, direction       → class
//   Mermaid mindmap        indented topics, shapes ([ ], ( ), (( )), {{ }}), ::icon      → mindmap
//   PlantUML class         class, abstract (class), interface, enum, record, <<stereotype>>,
//                          { members }, package/namespace { }, relations with -up- etc.  → class
//   PlantUML mindmap       * / ** / +++ / --- with left side, :multi-line;              → mindmap
import { Ids, scalar, slug, type Warnings } from './text.ts';

// ---------------------------------------------------------------- class model and YAML

export type UmlKind = 'class' | 'interface' | 'abstract' | 'enum' | 'record';

export interface UmlClass {
  source: string;
  label?: string;
  kind: UmlKind;
  stereotypes: string[];
  generic?: string;
  package?: string;
  /** Members as Cartography writes them: "+name: Type", "+total(): Money". */
  members: string[];
  values: string[];
}

export interface UmlModel {
  title: string;
  direction?: 'down' | 'right';
  packages: { id: string; label: string; parent?: string }[];
  classes: UmlClass[];
  /** "A *-- B", with multiplicities in quotes, and a label. */
  relations: { line: string; label?: string }[];
}

/** A member as a list item: plain when YAML reads it back the same, quoted otherwise. */
const memberItem = (m: string) => (/^[+\-~]?[A-Za-z_]\w*(: [\w<>., ]+)?$/.test(m) && !/: .*: /.test(m) ? m : JSON.stringify(m));

export function classYaml(m: UmlModel, ids: Ids): string {
  const lines = ['type: class', `title: ${scalar(m.title)}`];
  if (m.direction === 'right') lines.push('direction: right');
  lines.push('');
  if (m.packages.length) {
    lines.push('packages:');
    for (const p of m.packages) lines.push(p.parent ? `  ${p.id}: { label: ${scalar(p.label)}, parent: ${p.parent} }` : `  ${p.id}: ${scalar(p.label)}`);
    lines.push('');
  }
  lines.push('classes:');
  for (const c of m.classes) {
    const id = ids.get(c.source);
    const props: string[] = [];
    if (c.kind !== 'class') props.push(`kind: ${c.kind}`);
    if (c.label && c.label !== id) props.push(`label: ${scalar(c.label)}`);
    if (c.generic) props.push(`generic: ${scalar(c.generic)}`);
    if (c.stereotypes.length) props.push(`stereotype: ${c.stereotypes.length === 1 ? scalar(c.stereotypes[0]!) : `[${c.stereotypes.map(scalar).join(', ')}]`}`);
    if (c.package) props.push(`package: ${c.package}`);
    if (!props.length && !c.members.length && !c.values.length) {
      lines.push(`  ${id}: null`);
      continue;
    }
    if (props.length === 1 && props[0] === `kind: ${c.kind}` && !c.members.length && !c.values.length) {
      lines.push(`  ${id}: ${c.kind}`);
      continue;
    }
    lines.push(`  ${id}:`, ...props.map((p) => `    ${p}`));
    if (c.values.length) lines.push(`    values: [${c.values.map(scalar).join(', ')}]`);
    if (c.members.length) lines.push('    members:', ...c.members.map((x) => `      - ${memberItem(x)}`));
  }
  if (m.relations.length) {
    lines.push('', 'relations:');
    for (const r of m.relations) lines.push(r.label ? `  - ${r.line}: ${scalar(r.label)}` : `  - ${JSON.stringify(r.line)}`);
  }
  return lines.join('\n') + '\n';
}

/** "+String owner", "-List~int~ ids$", "+deposit(amount) bool", "+area()* double" → "+owner: String", "+{static} ids: List<int>". */
export function memberFrom(raw: string, typeFirst = true): string | undefined {
  let s = raw.trim().replace(/~([^~]+)~/g, '<$1>');
  if (!s) return undefined;
  let vis = '';
  if (/^[+\-#~]/.test(s)) (vis = s[0]!), (s = s.slice(1).trim());
  let mods = '';
  for (;;) {
    const m = /^\{(static|abstract|classifier)\}\s*/i.exec(s);
    if (!m) break;
    mods += `{${m[1]!.toLowerCase() === 'classifier' ? 'static' : m[1]!.toLowerCase()}} `;
    s = s.slice(m[0].length);
  }
  const open = s.indexOf('(');
  if (open > 0) {
    const close = s.lastIndexOf(')');
    const name = s.slice(0, open).trim().split(/\s+/).pop()!;
    // "void foo()" (PlantUML, Java style): the type before the name.
    const before = s.slice(0, open).trim().split(/\s+/).slice(0, -1).join(' ');
    const params = s.slice(open + 1, close < 0 ? undefined : close).trim();
    let rest = close < 0 ? '' : s.slice(close + 1).trim();
    const flags = /^([$*]+)/.exec(rest)?.[1] ?? '';
    rest = rest.slice(flags.length).replace(/^:\s*/, '').trim();
    if (flags.includes('$')) mods += '{static} ';
    if (flags.includes('*')) mods += '{abstract} ';
    const type = rest || before;
    return `${vis}${mods}${name}(${params})${type ? `: ${type}` : ''}`;
  }
  const flags = /([$*]+)$/.exec(s)?.[1] ?? '';
  s = s.slice(0, s.length - flags.length).trim();
  if (flags.includes('$')) mods += '{static} ';
  if (flags.includes('*')) mods += '{abstract} ';
  const colon = s.indexOf(':');
  if (colon > 0) return `${vis}${mods}${s.slice(0, colon).trim()}: ${s.slice(colon + 1).trim()}`;
  const words = s.split(/\s+/);
  if (words.length >= 2) {
    const [type, name] = typeFirst ? [words.slice(0, -1).join(' '), words.at(-1)!] : [words.slice(1).join(' '), words[0]!];
    return `${vis}${mods}${name}: ${type}`;
  }
  return `${vis}${mods}${s}`;
}

const ARROW = /^(<\||\*|o|<)?(-+|\.+)(\|>|\*|o|>)?$/;

/** A relation's arrow as the class type writes it: at least two dashes or dots, direction words and colours out. */
export function arrowFrom(raw: string): string | undefined {
  const s = raw.replace(/\[[^\]]*\]/g, '').replace(/(up|down|left|right|u|d|l|r)(?=[-.])/gi, (w, _d, i: number) => (i > 0 ? '' : w));
  const m = ARROW.exec(s.replace(/-(up|down|left|right)-/gi, '--'));
  if (!m) return undefined;
  const body = m[2]!.startsWith('.') ? '..' : '--';
  return `${m[1] ?? ''}${body}${m[3] ?? ''}`;
}

const REL = /^("[^"]+"|[\w.$-]+)\s*(?:"([^"]*)"\s*)?((?:<\||\*|o|<)?(?:-+|\.+)(?:\[[^\]]*\])?(?:-+|\.+)?(?:(?:up|down|left|right)(?:-+|\.+))?(?:\|>|\*|o|>)?)\s*(?:"([^"]*)"\s*)?("[^"]+"|[\w.$-]+)\s*(?::\s*(.*))?$/i;

/** One relation line of either language, or undefined. */
export function relationFrom(line: string): { a: string; b: string; arrow: string; aMult?: string; bMult?: string; label?: string } | undefined {
  const m = REL.exec(line.trim());
  if (!m) return undefined;
  const arrow = arrowFrom(m[3]!);
  if (!arrow) return undefined;
  const label = m[6]?.replace(/^[<>]\s*|\s*[<>]$/g, '').trim();
  return { a: unq(m[1]!), b: unq(m[5]!), arrow, ...(m[2] !== undefined ? { aMult: m[2] } : {}), ...(m[4] !== undefined ? { bMult: m[4] } : {}), ...(label ? { label } : {}) };
}

const unq = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

const KIND: Record<string, UmlKind> = { class: 'class', interface: 'interface', abstract: 'abstract', 'abstract class': 'abstract', enum: 'enum', enumeration: 'enum', record: 'record', struct: 'record', annotation: 'interface', entity: 'class', protocol: 'interface' };

/** Fills a class model from either language's lines; `mermaid` switches the few things they write differently. */
function readClasses(body: string[], title: string, warn: Warnings, mermaid: boolean): string {
  const ids = new Ids();
  const classes = new Map<string, UmlClass>();
  const packages: UmlModel['packages'] = [];
  const relations: UmlModel['relations'] = [];
  let direction: UmlModel['direction'];
  const pkgStack: (string | undefined)[] = [];
  const pkgNow = () => pkgStack.findLast((p) => p !== undefined);
  const get = (name: string) => {
    const source = unq(name).replace(/~.*~$/, '').replace(/<.*>$/, '');
    let c = classes.get(source);
    if (!c) {
      c = { source, kind: 'class', stereotypes: [], members: [], values: [], ...(pkgNow() ? { package: pkgNow() } : {}) };
      classes.set(source, c);
      ids.get(source, slug(source));
    }
    return c;
  };
  const stereotype = (c: UmlClass, s: string) => {
    const k = s.trim().toLowerCase();
    if (KIND[k] && KIND[k] !== 'class') c.kind = KIND[k]!;
    else if (k) c.stereotypes.push(s.trim());
  };
  let open: UmlClass | undefined;
  let depth = 0;
  for (const raw of body) {
    const s = raw.trim();
    if (!s || s.startsWith('%%') || s.startsWith("'")) continue;
    if (open) {
      if (s === '}') {
        open = undefined;
        continue;
      }
      if (/^(--|\.\.|==|__)(.*?)(--|\.\.|==|__)?$/.test(s)) continue;
      const st = /^<<\s*(.+?)\s*>>$/.exec(s);
      if (st) {
        stereotype(open, st[1]!);
        continue;
      }
      if (open.kind === 'enum' && !s.includes('(')) {
        for (const v of s.split(/[,\s]+/).filter(Boolean)) if (/^[\w-]+$/.test(v)) open.values.push(v);
        continue;
      }
      const m = memberFrom(s, mermaid || !/:/.test(s));
      if (m) open.members.push(m);
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^direction\s+(LR|RL|TB|TD|BT)$/i.exec(s))) direction = /LR|RL/i.test(m[1]!) ? 'right' : 'down';
    else if ((m = /^(?:package|namespace|folder|frame)\s+("[^"]+"|[\w.:-]+)(?:\s+as\s+([\w-]+))?.*?\{\s*$/i.exec(s))) {
      const label = unq(m[1]!);
      const id = slug(m[2] ?? label).toLowerCase();
      if (!packages.some((p) => p.id === id)) packages.push({ id, label, ...(pkgNow() ? { parent: pkgNow() } : {}) });
      pkgStack.push(id);
      depth++;
    } else if (s === '}' && depth) {
      pkgStack.pop();
      depth--;
    } else if ((m = /^(abstract\s+class|abstract|class|interface|enum|record|annotation|entity|protocol|struct)\s+("[^"]+"|[\w.$-]+)(~[^~]+~|<(?!<)[^>]+>)?(?:\s*\[\s*"?([^"\]]*)"?\s*\])?(?:\s+as\s+([\w.-]+))?\s*((?:<<[^>]+>>\s*)*)(?:extends\s+([\w.,\s]+?))?\s*(?:implements\s+([\w.,\s]+?))?\s*(\{\s*\}?)?\s*$/i.exec(s))) {
      // PlantUML "class "Long name" as N": N is the id, the quoted name its label.
      const name = m[5] ?? m[2]!;
      const c = get(name);
      if (m[5]) c.label = unq(m[2]!);
      if (m[4]) c.label = m[4];
      const k = KIND[m[1]!.toLowerCase().replace(/\s+/g, ' ')];
      if (k) c.kind = k;
      if (m[3]) c.generic = m[3].slice(1, -1);
      for (const st of m[6]?.matchAll(/<<\s*([^>]+?)\s*>>/g) ?? []) stereotype(c, st[1]!);
      for (const p of m[7]?.split(',').map((x) => x.trim()).filter(Boolean) ?? []) relations.push({ line: `${ids.get(c.source)} --|> ${ids.get(get(p).source)}` });
      for (const p of m[8]?.split(',').map((x) => x.trim()).filter(Boolean) ?? []) relations.push({ line: `${ids.get(c.source)} ..|> ${ids.get(get(p).source)}` });
      if (m[9] && !m[9].includes('}')) open = c;
    } else if ((m = /^<<\s*(.+?)\s*>>\s*([\w.$-]+)$/.exec(s))) stereotype(get(m[2]!), m[1]!);
    else if ((m = /^([\w.$-]+)\s*:\s*(.+)$/.exec(s)) && !/(--|\.\.)/.test(m[1]!)) {
      // Mermaid "Name : +member" (one member per line).
      const c = get(m[1]!);
      const st = /^<<\s*(.+?)\s*>>$/.exec(m[2]!.trim());
      if (st) stereotype(c, st[1]!);
      else {
        const x = memberFrom(m[2]!, mermaid);
        if (x) c.members.push(x);
      }
    } else if (/^(note|click|link|callback|style|classDef|cssClass|skinparam|hide|show|remove|together)\b/i.test(s) || /:::/.test(s)) warn.onceFor('notes', 'Notes, links, styles and hide/show lines are left out: the theme draws each kind its own way');
    else {
      const r = relationFrom(s);
      if (r) {
        const a = ids.get(get(r.a).source);
        const b = ids.get(get(r.b).source);
        const q = (x?: string) => (x !== undefined ? ` "${x.replace(/"/g, "'")}"` : '');
        relations.push({ line: `${a}${q(r.aMult)} ${r.arrow}${q(r.bMult)} ${b}`, ...(r.label ? { label: r.label } : {}) });
      } else warn.onceFor(`line:${s}`, `Not read: ${s.length > 60 ? `${s.slice(0, 57)}…` : s}`);
    }
  }
  if (!classes.size) {
    warn.add('No classes found');
    return '';
  }
  return classYaml({ title, ...(direction ? { direction } : {}), packages, classes: [...classes.values()], relations }, ids);
}

export const importMermaidClass = (body: string[], title: string, warn: Warnings) => readClasses(body, title, warn, true);
export const importPlantUmlClass = (body: string[], title: string, warn: Warnings) => readClasses(body, title, warn, false);

// ---------------------------------------------------------------- mind maps

export interface MindNode {
  text: string;
  side?: 'left' | 'right';
  children: MindNode[];
}

export function mindmapYaml(title: string, root: MindNode): string {
  const lines = ['type: mindmap', `title: ${scalar(title)}`, '', `center: ${scalar(root.text)}`];
  if (!root.children.length) return lines.join('\n') + '\n';
  lines.push('topics:');
  const used = new Set<string>();
  const item = (n: MindNode, indent: string): string[] => {
    if (!n.children.length) return [`${indent}- ${scalar(n.text)}`];
    return [`${indent}- ${scalar(n.text)}:`, ...n.children.flatMap((c) => item(c, `${indent}    `))];
  };
  for (const b of root.children) {
    let key = b.text;
    for (let i = 2; used.has(key); i++) key = `${b.text} (${i})`;
    used.add(key);
    const k = scalar(key);
    if (key !== b.text) {
      lines.push(`  ${k}:`, `    label: ${scalar(b.text)}`);
      if (b.side) lines.push(`    side: ${b.side}`);
      if (b.children.length) lines.push('    topics:', ...b.children.flatMap((c) => item(c, '      ')));
    } else if (b.side) {
      lines.push(`  ${k}:`, `    side: ${b.side}`);
      if (b.children.length) lines.push('    topics:', ...b.children.flatMap((c) => item(c, '      ')));
    } else if (!b.children.length) lines.push(`  ${k}: null`);
    else lines.push(`  ${k}:`, ...b.children.flatMap((c) => item(c, '    ')));
  }
  return lines.join('\n') + '\n';
}

/** A Mermaid mindmap node's words: its shape brackets and id out. */
function mermaidTopic(s: string): string {
  const m = /^[\w-]*\s*(\(\(|\)\)|\(|\[|\{\{|\))(.*?)(\)\)|\(\(|\)|\]|\}\}|\()\s*$/.exec(s);
  const t = m ? m[2]! : s;
  return t.replace(/^["`]|["`]$/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/\*\*|__/g, '').trim();
}

export function importMermaidMindmap(body: string[], title: string | undefined, warn: Warnings): string {
  const stack: { indent: number; node: MindNode }[] = [];
  let root: MindNode | undefined;
  for (const raw of body) {
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const s = raw.trim();
    if (/^::icon\(/.test(s) || /^:::/.test(s)) {
      warn.onceFor('icon', 'Mermaid ::icon() and ::: classes are left out: name an icon: on a topic instead');
      continue;
    }
    const node: MindNode = { text: mermaidTopic(s.replace(/:::.*$/, '').trim()), children: [] };
    if (!node.text) continue;
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    if (!root) root = node;
    else if (!stack.length) {
      warn.onceFor('roots', 'A mind map has one centre: topics written at its level are hung under it');
      root.children.push(node);
      stack.push({ indent: -1, node: root });
    } else stack.at(-1)!.node.children.push(node);
    stack.push({ indent, node });
  }
  if (!root) {
    warn.add('The mind map is empty');
    return '';
  }
  return mindmapYaml(title ?? root.text, root);
}

/** PlantUML @startmindmap: * and + to the right, - to the left, the depth in how many of them; "left side" turns the rest. */
export function importPlantUmlMindmap(raw: string[], title: string, warn: Warnings): string {
  const stack: MindNode[] = [];
  let root: MindNode | undefined;
  let left = false;
  for (let i = 0; i < raw.length; i++) {
    let s = raw[i]!.trim();
    if (!s || s.startsWith("'")) continue;
    if (/^left side$/i.test(s)) {
      left = true;
      continue;
    }
    if (/^right side$/i.test(s)) {
      left = false;
      continue;
    }
    if (/^(title|caption|header|footer|legend|skinparam|<style>|!theme|top to bottom direction|left to right direction)\b/i.test(s)) {
      if (/^title\s+/i.test(s)) title = s.replace(/^title\s+/i, '').trim();
      else warn.onceFor('style', 'Styles, captions and legends are left out: the theme draws the map');
      if (/^<style>/i.test(s)) while (i < raw.length && !/<\/style>/i.test(raw[i]!)) i++;
      continue;
    }
    const m = /^([*+-]+)(?:\[[^\]]*\])?(_)?\s*(.*)$/.exec(s);
    if (!m) continue;
    let text = m[3]!;
    // A topic over several lines: ":first line … last line;".
    if (text.startsWith(':')) {
      const parts = [text.slice(1)];
      while (!parts.at(-1)!.trimEnd().endsWith(';') && i + 1 < raw.length) parts.push(raw[++i]!.trim());
      text = parts.join(' ').replace(/;\s*$/, '');
    }
    text = text.replace(/<&[\w-]+>/g, '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\*\*|\/\/|__|~~/g, '').trim();
    if (/<&|<img/.test(m[3]!)) warn.onceFor('icon', 'OpenIconic icons and images are left out: name an icon: on a topic instead');
    const depth = m[1]!.length;
    const node: MindNode = { text, children: [] };
    if (depth === 1 || !root) {
      if (!root) root = node;
      else root.children.push(node);
      stack.length = 1;
      stack[0] = root;
      continue;
    }
    if (depth === 2) node.side = m[1]![0] === '-' || left ? 'left' : 'right';
    const parent = stack[Math.min(depth - 2, stack.length - 1)]!;
    parent.children.push(node);
    stack.length = depth - 1;
    stack[depth - 1] = node;
  }
  if (!root) return '';
  // Sides only matter where both are used.
  if (!root.children.some((c) => c.side === 'left')) for (const c of root.children) delete c.side;
  return mindmapYaml(title, root);
}
