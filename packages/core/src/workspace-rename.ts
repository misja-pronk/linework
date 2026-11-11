// Rename everywhere: an element's id (and, if asked, its label) changed in every file of the workspace
// that names it. Only the characters of the ids change: comments, quotes, order and layout of each file
// stay as they were. The plan is made first (a preview of every file), applied after.
//
// What changes, in each file that has the element in scope (it defines it or includes a file that does):
//   - the key that defines it (the last part of the id: a rename never moves an element);
//   - every `ref:`, `of:`, `instances:`, view `of:`, view rule, step and relation that names it or a
//     part of it ("online" → "digital" makes "online.api" "digital.api");
//   - an entry that is the element by having the same id (a node `ledger:`, an access resource
//     `ledger`) gets the new key, with whatever the type says refers to it (lines, `in:`, assignments);
//   - in the pins (`.layout.json`) and the review notes (`.notes.json`), what is drawn under the old id.
// A node with its own key and `ref: online` keeps its key: only the ref changes.
import { isMap, isScalar, type Document, type Node, type Pair } from 'yaml';
import { parseSource } from './source.ts';
import { idPattern, type Reference } from './diagram-type.ts';
import { sitesOf, type WorkspaceIndex } from './workspace.ts';
import { parseNotes, printNotes, type NoteAnchor } from './notes.ts';
import type { Path } from './model.ts';

export interface RenameFile {
  file: string;
  before: string;
  after: string;
  /** How many places changed. */
  count: number;
  /** A drawn id as it is after the rename (pins and notes follow it). */
  node(id: string): string;
}

export interface RenamePlan {
  from: string;
  to: string;
  label?: { from?: string; to: string };
  files: RenameFile[];
  /** Files that name nothing by the old id in their text but draw it: their pins and notes still follow. */
  drawnIn: RenameFile[];
  /** Why it cannot be done; nothing in `files` then. */
  problem?: string;
}

export interface RenameOptions {
  /** A new label too. */
  label?: string;
  /** Every place a type's YAML names an entry (DiagramType.references), for entries with the element's id. */
  references?(type: string, data: unknown): Reference[] | undefined;
}

interface Edit {
  from: number;
  to: number;
  text: string;
}

const isPlainMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The id with `from` (or a part of it) renamed: online.api → digital.api; anything else stays. */
export const renamedId = (id: string, from: string, to: string) => (id === from || id.startsWith(from + '.') || id.startsWith(from + '@') ? to + id.slice(from.length) : id);

/** The plan for renaming element `from` to `to` (a full id, or only its last part). */
export function planRename(ix: WorkspaceIndex, from: string, toAsked: string, o: RenameOptions = {}): RenamePlan {
  const defs = ix.elements.get(from);
  const parent = from.includes('.') ? from.slice(0, from.lastIndexOf('.')) : undefined;
  const to = toAsked.includes('.') || !parent ? toAsked.trim() : `${parent}.${toAsked.trim()}`;
  const plan: RenamePlan = { from, to, files: [], drawnIn: [] };
  const no = (problem: string) => ({ ...plan, problem });
  if (!defs?.length) return no(`There is no element "${from}" in the workspace`);
  const toParent = to.includes('.') ? to.slice(0, to.lastIndexOf('.')) : undefined;
  if (toParent !== parent) return no(`A rename keeps an element where it is: write ${parent ? `${parent}.<new name>` : 'a name without dots'}`);
  const name = to.split('.').at(-1)!;
  if (!new RegExp(idPattern).test(name)) return no(`"${name}" is not an id: letters, digits, - and _ only`);
  if (to === from && o.label == null) return no('That is its id already');
  if (to !== from && ix.elements.has(to)) return no(`There is an element "${to}" already (${ix.elements.get(to)![0]!.file})`);
  const label = o.label?.trim() ? o.label.trim() : undefined;
  if (label) plan.label = { from: defs[0]!.label, to: label };

  const homes = new Set(defs.map((d) => d.file));
  for (const f of ix.files.values()) {
    if (f.error || !(ix.scope.get(f.file) ?? []).some((x) => homes.has(x))) continue;
    const r = renameInFile(f.file, f.text, from, to, homes.has(f.file), label ? { from: plan.label!.from, to: label } : undefined, o.references);
    if (typeof r === 'string') return no(`${f.file}: ${r}`);
    if (r && r.after !== f.text) plan.files.push(r);
    else if (r) plan.drawnIn.push(r);
  }
  return plan;
}

function renameInFile(file: string, text: string, from: string, to: string, home: boolean, label: { from?: string; to: string } | undefined, references: RenameOptions['references']): RenameFile | string | undefined {
  const src = parseSource(text);
  if (!isPlainMap(src.data)) return undefined;
  const data = src.data;
  const doc = src.doc;
  const edits: Edit[] = [];
  const add = (e: Edit) => {
    if (!edits.some((x) => x.from < e.to && e.from < x.to)) edits.push(e);
  };
  /** In a scalar: the `old` at `start` of its value becomes `next`, when the source spells the value as it is. */
  const at = (node: Node | null | undefined, start: number, old: string, next: string) => {
    if (!isScalar(node) || !node.range) return;
    const raw = text.slice(node.range[0], node.range[1]);
    const value = String(node.value);
    const off = raw === value ? 0 : (raw.startsWith('"') || raw.startsWith("'")) && raw.slice(1, 1 + value.length) === value ? 1 : -1;
    if (off < 0 || value.slice(start, start + old.length) !== old) return;
    add({ from: node.range[0] + off + start, to: node.range[0] + off + start + old.length, text: next });
  };
  const keyOf = (path: Path): Node | undefined => {
    const holder = doc.getIn(path.slice(0, -1), true) as Node | undefined;
    if (!isMap(holder)) return undefined;
    return holder.items.find((p) => isScalar(p.key) && String(p.key.value) === String(path.at(-1)))?.key as Node | undefined;
  };

  // Entries that hold the old id as their own key while naming the element by ref:/of: are their own thing.
  const own = new Set<string>();
  const sameId: { coll: string; id: string }[] = [];
  for (const [coll, v] of Object.entries(data)) {
    if (!isPlainMap(v) || ['elements', 'views', 'include', 'relations'].includes(coll)) continue;
    const e = v[from];
    if (!(from in v)) continue;
    if (isPlainMap(e) && (e.ref != null || e.of != null)) own.add(from);
    else if (!from.includes('.')) sameId.push({ coll, id: from });
  }

  // 1. The definition.
  if (home) {
    const walk = (map: unknown, prefix: string | undefined, base: Path) => {
      if (!isPlainMap(map)) return;
      for (const [k, raw] of Object.entries(map)) {
        const id = prefix ? `${prefix}.${k}` : k;
        const path = [...base, k];
        if (id === from) {
          if (to !== from) at(keyOf(path), 0, k, to.split('.').at(-1)!);
          if (label) setLabel(doc, text, path, raw, label.to, add);
        } else if (from.startsWith(id + '.')) walk(isPlainMap(raw) ? raw.elements : undefined, id, [...path, 'elements']);
      }
    };
    walk(data.elements, undefined, ['elements']);
  }

  // 2. Every place that names it.
  if (to !== from) {
    const token = new RegExp(`(^|[^A-Za-z0-9_.-])${esc(from)}(?=$|[^A-Za-z0-9_-])`, 'g');
    for (const s of sitesOf(data)) {
      const node = (s.key ? (doc.getIn(s.path, true) as Node | undefined) : undefined) as Node | undefined;
      const scalar = s.key ? (isMap(node) && node.items.length === 1 ? (node.items[0]!.key as Node) : undefined) : (doc.getIn(s.path, true) as Node | undefined);
      if (!isScalar(scalar)) continue;
      const value = String(scalar.value);
      if (s.form === 'id') {
        if (renamedId(value, from, to) !== value && !(own.has(from) && value === from && (s.how === 'edge' || s.how === 'selector'))) at(scalar, 0, from, to);
        continue;
      }
      if (/^(tag|kind):/.test(value.trim())) continue;
      for (const m of value.matchAll(token)) {
        const start = m.index! + m[1]!.length;
        // A bare id in a line or a rule of a diagram that has an entry of that name with its own ref: is that entry.
        const whole = value.slice(start).match(/^[A-Za-z0-9_.-]+/)![0];
        if (whole === from && own.has(from) && (s.how === 'edge' || s.how === 'selector')) continue;
        at(scalar, start, from, to);
      }
    }
  }

  // 3. Entries that are the element by their id, and what the type says refers to them.
  const renames = new Map<string, string>();
  for (const { coll, id } of sameId) {
    const k = keyOf([coll, id]);
    if (to !== from) {
      // Ids of a diagram are one name space: a principal "digital" and a resource "digital" would be one.
      const taken = Object.entries(data).find(([c, v]) => !['elements', 'views'].includes(c) && isPlainMap(v) && to in v);
      if (taken) return `${taken[0]} has an entry "${to}" already`;
      at(k, 0, from, to);
      renames.set(id, to);
      for (const r of references?.(String(data.type), data) ?? []) {
        if (r.collection !== coll || r.id !== from) continue;
        const n = doc.getIn(r.path, true) as Node | undefined;
        const scalar = r.key ? (isMap(n) && n.items.length === 1 ? (n.items[0]!.key as Node) : undefined) : n;
        at(scalar, r.start, from, to);
      }
    }
    if (label?.from) {
      const entry = (data[coll] as Record<string, unknown>)[id];
      if (isPlainMap(entry) && entry.label === label.from) setLabel(doc, text, [coll, id], entry, label.to, add);
    }
  }
  // Nodes that name it by ref: and say its label again.
  if (label?.from)
    for (const coll of ['nodes', 'groups']) {
      const m = data[coll];
      if (isPlainMap(m)) for (const [k, e] of Object.entries(m)) if (isPlainMap(e) && e.ref === from && e.label === label.from) setLabel(doc, text, [coll, k], e, label.to, add);
    }

  let after = text;
  for (const e of [...edits].sort((a, b) => b.from - a.from)) after = after.slice(0, e.from) + e.text + after.slice(e.to);
  const node = (id: string) => (own.has(from) && id === from ? id : (renames.get(id) ?? renamedId(id, from, to)));
  return { file, before: text, after, count: edits.length, node };
}

/** A scalar as YAML can take it plain, else quoted. */
const scalarText = (s: string) => (/^[\p{L}\p{N}][^:#{}[\],&*!|>'"%@`]*$/u.test(s) && !/\s$/.test(s) && !/^(true|false|null|yes|no|~|-?\d[\d._]*)$/i.test(s) ? s : JSON.stringify(s));

/** Writes `label:` of the entry at `path`: replaced where it is, or added as its first field. */
function setLabel(doc: Document, text: string, path: Path, raw: unknown, label: string, add: (e: Edit) => void) {
  const node = doc.getIn(path, true) as Node | undefined;
  if (isMap(node)) {
    const pair = node.items.find((p) => isScalar(p.key) && p.key.value === 'label') as Pair<Node, Node> | undefined;
    if (pair && isScalar(pair.value) && pair.value.range) return add({ from: pair.value.range[0], to: pair.value.range[1], text: scalarText(label) });
    const first = node.items[0] as Pair<Node, Node> | undefined;
    if (!first || !isScalar(first.key) || !first.key.range) return;
    const start = first.key.range[0];
    if (node.flow) return add({ from: start, to: start, text: `label: ${scalarText(label)}, ` });
    const indent = start - (text.lastIndexOf('\n', start - 1) + 1);
    return add({ from: start, to: start, text: `label: ${scalarText(label)}\n${' '.repeat(indent)}` });
  }
  // `id:` alone or `id: kind`: written out as a map.
  const key = (() => {
    const holder = doc.getIn(path.slice(0, -1), true) as Node | undefined;
    return isMap(holder) ? (holder.items.find((p) => isScalar(p.key) && String(p.key.value) === String(path.at(-1))) as Pair<Node, Node> | undefined) : undefined;
  })();
  if (!key || !isScalar(key.key) || !key.key.range) return;
  const kind = typeof raw === 'string' ? `kind: ${scalarText(raw)}, ` : '';
  const end = isScalar(key.value) && key.value.range ? key.value.range[1] : key.key.range[1] + 1;
  add({ from: key.key.range[1], to: end, text: `: { ${kind}label: ${scalarText(label)} }` });
}

/**
 * Pins (`<name>.layout.json`) after a rename: what was pinned under an old id is pinned under the new
 * one, in every view. Undefined when nothing changes (or the file cannot be read: it stays as it is).
 */
export function renameSidecar(json: string, node: (id: string) => string): string | undefined {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isPlainMap(v)) return undefined;
  let changed = false;
  const keys = (m: unknown) => {
    if (!isPlainMap(m)) return m;
    return Object.fromEntries(
      Object.entries(m).map(([k, x]) => {
        const n = node(k);
        if (n !== k) changed = true;
        return [n, x];
      }),
    );
  };
  const pins = (p: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...p };
    if (p.nodes) out.nodes = keys(p.nodes);
    if (p.groups) out.groups = keys(p.groups);
    if (Array.isArray(p.locked))
      out.locked = p.locked.map((k) => {
        const n = typeof k === 'string' ? node(k) : k;
        if (n !== k) changed = true;
        return n;
      });
    if (isPlainMap(p.edges))
      out.edges = Object.fromEntries(
        Object.entries(p.edges).map(([k, e]) => {
          if (!isPlainMap(e)) return [k, e];
          const next = { ...e };
          for (const end of ['from', 'to']) {
            if (typeof e[end] !== 'string') continue;
            const n = node(e[end] as string);
            if (n !== e[end]) ((changed = true), (next[end] = n));
          }
          return [k, next];
        }),
      );
    return out;
  };
  const out = pins(v);
  if (isPlainMap(v.views)) out.views = Object.fromEntries(Object.entries(v.views).map(([k, p]) => [k, isPlainMap(p) ? pins(p) : p]));
  return changed ? JSON.stringify(out, null, 2) + '\n' : undefined;
}

/** Review notes (`<name>.notes.json`) after a rename: threads on an old id hang on the new one. Undefined when nothing changes. */
export function renameNotesFile(json: string, node: (id: string) => string): string | undefined {
  const { notes, problems } = parseNotes(json);
  if (problems.length) return undefined;
  let changed = false;
  const move = (a: NoteAnchor): NoteAnchor => {
    if (a.kind === 'node' || a.kind === 'group') return node(a.id) === a.id ? a : ((changed = true), { ...a, id: node(a.id) });
    if (a.kind === 'edge' && (node(a.from) !== a.from || node(a.to) !== a.to)) return (changed = true), { ...a, from: node(a.from), to: node(a.to) };
    return a;
  };
  const threads = notes.threads.map((t) => ({ ...t, anchor: move(t.anchor) }));
  return changed ? printNotes({ ...notes, threads }) : undefined;
}

export interface DiffLine {
  kind: ' ' | '-' | '+';
  text: string;
  /** Line number in the file before (for ' ' and '-') or after (for '+'). */
  line: number;
}

/** The changed lines of a file with a little context, in hunks: what the preview shows. */
export function lineDiff(before: string, after: string, context = 1): DiffLine[][] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) (endA--, endB--);
  // The middle, line by line (a rename changes lines in place; a label may add one).
  const lcs: number[][] = Array.from({ length: endA - start + 1 }, () => new Array(endB - start + 1).fill(0));
  for (let i = endA - 1; i >= start; i--) for (let j = endB - 1; j >= start; j--) lcs[i - start]![j - start] = a[i] === b[j] ? lcs[i - start + 1]![j - start + 1]! + 1 : Math.max(lcs[i - start + 1]![j - start]!, lcs[i - start]![j - start + 1]!);
  const all: DiffLine[] = [];
  for (let i = 0; i < start; i++) all.push({ kind: ' ', text: a[i]!, line: i + 1 });
  let i = start;
  let j = start;
  while (i < endA || j < endB) {
    if (i < endA && j < endB && a[i] === b[j]) (all.push({ kind: ' ', text: a[i]!, line: i + 1 }), i++, j++);
    // Removed lines before the added ones, as a diff reads.
    else if (i < endA && (j >= endB || lcs[i - start + 1]![j - start]! >= lcs[i - start]![j - start + 1]!)) (all.push({ kind: '-', text: a[i]!, line: i + 1 }), i++);
    else (all.push({ kind: '+', text: b[j]!, line: j + 1 }), j++);
  }
  for (let k = endA; k < a.length; k++) all.push({ kind: ' ', text: a[k]!, line: k + 1 });
  const hunks: DiffLine[][] = [];
  let cur: DiffLine[] | undefined;
  let lastChange = -Infinity;
  for (const [n, l] of all.entries()) {
    if (l.kind === ' ') continue;
    if (!cur || n - lastChange > context * 2 + 1) {
      cur = [];
      hunks.push(cur);
      for (let k = Math.max(0, n - context, lastChange + context + 1); k < n; k++) cur.push(all[k]!);
    } else for (let k = lastChange + 1; k < n; k++) cur.push(all[k]!);
    cur.push(l);
    lastChange = n;
    const next = all.slice(n + 1).findIndex((x) => x.kind !== ' ');
    if (next < 0 || next > context * 2) for (let k = n + 1; k <= Math.min(all.length - 1, n + context); k++) cur.push(all[k]!);
  }
  return hunks;
}
