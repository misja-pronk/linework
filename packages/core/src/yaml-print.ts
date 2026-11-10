// Prints a changed YAML document back into its original text, touching only the entries that changed.
// Builder edits work on the `yaml` Document; printing that whole would reindent the file, merge blank
// lines and refold block text. Here the old and new trees are compared, and only differing map
// entries or list items are replaced (at their own indentation); everything else keeps its bytes.
import { Document, isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq, type Node, type Pair } from 'yaml';

const FORMAT = { lineWidth: 0, flowCollectionPadding: true } as const;

interface Splice {
  from: number;
  to: number;
  text: string;
  /** Push order: of two inserts at one spot, the later one goes in first so it ends up last. */
  n?: number;
}

const json = (n: unknown) => JSON.stringify(n && typeof (n as { toJSON?: unknown }).toJSON === 'function' ? (n as { toJSON(): unknown }).toJSON() : n);
const keyOf = (p: Pair) => String(isScalar(p.key) ? p.key.value : p.key);
const isBlockMap = (n: unknown): n is YAMLMap => isMap(n) && !n.flow;
const isBlockSeq = (n: unknown): n is YAMLSeq => isSeq(n) && !n.flow;

/** The new document as text, with as much of `original` kept as possible. */
export function printPreserving(original: string, doc: Document): string {
  // A document YAML could not read cannot be written either: say why, not "cannot be stringified".
  if (doc.errors.length) {
    const many = doc.errors.some((e) => /multiple documents/i.test(e.message));
    throw new Error(many ? 'This file holds more than one YAML document (a line with ---): a diagram is one document, so split it into files' : `The YAML has a problem to fix first: ${doc.errors[0]!.message.split('\n')[0]}`);
  }
  style = flowStyle(original);
  const old = parseDocument(original);
  const indentUnit = detectIndent(original);
  if (old.errors.length || !isBlockMap(old.contents) || !isMap(doc.contents)) return doc.toString({ ...FORMAT, indent: indentUnit });
  const splices: Splice[] = [];
  const ok = diffMap(original, old.contents, doc.contents as YAMLMap, 0, indentUnit, splices, true);
  if (!ok) return doc.toString({ ...FORMAT, indent: indentUnit });
  splices.forEach((s, i) => (s.n = i));
  let out = original;
  for (const s of splices.sort((a, b) => b.from - a.from || b.to - a.to || b.n! - a.n!)) out = out.slice(0, s.from) + s.text + out.slice(s.to);
  // Safety net: the text must mean exactly what the edited document means, or we print it plainly.
  const check = parseDocument(out);
  if (check.errors.length || JSON.stringify(check.toJS()) !== JSON.stringify(doc.toJS())) return doc.toString({ ...FORMAT, indent: indentUnit });
  return out;
}

/** Whether the file pads flow lists and maps ("[ a ]" or "[a]"), counted separately. */
let style = { list: false, map: true };
function flowStyle(text: string) {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    list: count(/\[ \S/g) > count(/\[[^\s\]]/g),
    map: count(/\{ \S/g) >= count(/\{[^\s}]/g),
  };
}

/** Applies the file's padding to freshly printed text (printed with padding on both). */
function restyle(s: string): string {
  let out = s;
  if (!style.list) out = out.replace(/\[ (?=\S)/g, '[').replace(/(?<=\S) \]/g, ']');
  if (!style.map) out = out.replace(/\{ (?=\S)/g, '{').replace(/(?<=\S) \}/g, '}');
  return out;
}

function detectIndent(text: string): number {
  const m = /^\S[^\n]*:\s*\n( +)\S/m.exec(text);
  return m ? Math.min(8, Math.max(2, m[1]!.length)) : 2;
}

/** Start of the line holding `pos`. */
const lineStart = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;

/** End of the last non-blank line of a node (before its newline), so trailing blank lines stay. */
function contentEnd(text: string, from: number, to: number): number {
  let end = to;
  while (end > from && /\s/.test(text[end - 1]!)) end--;
  const nl = text.indexOf('\n', end);
  return nl < 0 ? text.length : nl;
}

/** Text span of a block map entry: its whole lines. */
function pairSpan(text: string, p: Pair): [number, number] | undefined {
  const k = (p.key as Node | null)?.range;
  if (!k) return undefined;
  const v = (p.value as Node | null)?.range;
  return [lineStart(text, k[0]), contentEnd(text, k[0], v ? v[1] : k[1])];
}

/** Text span of a list item: its whole lines, with the comment lines above it that are its own. */
function itemSpan(text: string, item: Node): [number, number] | undefined {
  const r = item.range;
  if (!r) return undefined;
  let from = lineStart(text, dashBefore(text, r[0]));
  // The comment goes where the item goes: removed with it, and printed once when the item is printed again.
  let left = item.commentBefore ? item.commentBefore.split('\n').length : 0;
  for (let at = from; left > 0 && at > 0; ) {
    const start = lineStart(text, at - 1);
    const line = text.slice(start, at - 1).trim();
    if (line.startsWith('#')) {
      from = start;
      left--;
    } else if (line) break;
    at = start;
  }
  return [from, contentEnd(text, r[0], r[1])];
}

/** The "-" of a list item: its value can start lines later ("- # note\n  from: a", "- &anchor"). */
function dashBefore(text: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i--) {
    const c = text[i]!;
    if (c === '-' && (i === 0 || /\s/.test(text[i - 1]!))) return i;
    if (c === '#') continue;
    if (!/[\s&*!\w-]/.test(c) && c !== '#') break;
  }
  return pos;
}

/** One entry printed on its own, indented to `column`. */
function printPair(pair: Pair, column: number, indent: number): string {
  const tmp = new Document();
  const map = new YAMLMap();
  map.items.push(pair);
  tmp.contents = map;
  return reindent(tmp.toString({ ...FORMAT, indent }), column);
}

function printItem(item: unknown, column: number, indent: number): string {
  const tmp = new Document();
  const seq = new YAMLSeq();
  seq.items.push(item);
  tmp.contents = seq;
  return reindent(tmp.toString({ ...FORMAT, indent }), column);
}

function reindent(s: string, column: number): string {
  const pad = ' '.repeat(column);
  return restyle(s)
    .replace(/\n$/, '')
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

const columnOf = (text: string, pos: number) => pos - lineStart(text, pos);

/** Splices that turn old block map `a` into `b`; false when it cannot be done in place. */
function diffMap(text: string, a: YAMLMap, b: YAMLMap, column: number, indent: number, out: Splice[], root = false): boolean {
  const oldPairs = a.items as Pair[];
  const newPairs = b.items as Pair[];
  if (oldPairs.length) column = columnOf(text, (oldPairs[0]!.key as Node).range![0]);
  const oldBy = new Map(oldPairs.map((p) => [keyOf(p), p]));
  const newKeys = new Set(newPairs.map(keyOf));

  // A pair whose key changed in place (a rename) is replaced where it stands.
  const renamed = new Map<Pair, Pair>();
  newPairs.forEach((p, i) => {
    const o = oldPairs[i];
    if (!oldBy.has(keyOf(p)) && o && !newKeys.has(keyOf(o))) renamed.set(p, o);
  });
  const renamedOld = new Set(renamed.values());

  for (const o of oldPairs) {
    if (newKeys.has(keyOf(o)) || renamedOld.has(o)) continue;
    const span = pairSpan(text, o);
    if (!span) return false;
    // Remove the whole lines, with the newline after them.
    out.push({ from: span[0], to: Math.min(text.length, span[1] + 1), text: '' });
  }

  const lastEnd = oldPairs.length ? pairSpan(text, oldPairs[oldPairs.length - 1]!)?.[1] : undefined;
  for (const [j, p] of newPairs.entries()) {
    const o = oldBy.get(keyOf(p)) ?? renamed.get(p);
    if (!o) {
      // Added: right after the entry before it (a duplicate lands next to its original), else at the end.
      let before: Pair | undefined;
      for (let k = j - 1; k >= 0 && !before; k--) before = oldBy.get(keyOf(newPairs[k]!)) ?? renamed.get(newPairs[k]!);
      const at = (before ? pairSpan(text, before)?.[1] : undefined) ?? lastEnd ?? (root ? text.length : undefined);
      if (at == null) return false;
      // A new top-level section gets a blank line before it, like the others.
      const gap = root && (isMap(p.value) || isSeq(p.value)) ? '\n\n' : '\n';
      if (at === text.length) out.push({ from: at, to: at, text: (text.endsWith('\n') ? gap.slice(1) : gap) + printPair(p, column, indent) + '\n' });
      else out.push({ from: at, to: at, text: gap + printPair(p, column, indent) });
      continue;
    }
    if (keyOf(o) === keyOf(p) && json(o.value) === json(p.value)) continue;
    const ov = o.value;
    const nv = p.value;
    // An emptied list or map is written as [] or {}, never as an empty value.
    if (isSeq(nv) && !nv.items.length) nv.flow = true;
    if (isMap(nv) && !nv.items.length) nv.flow = true;
    if (keyOf(o) === keyOf(p) && isBlockMap(ov) && isBlockMap(nv) && ov.items.length) {
      if (!diffMap(text, ov, nv, column + indent, indent, out)) return false;
      continue;
    }
    if (keyOf(o) === keyOf(p) && isBlockSeq(ov) && isBlockSeq(nv) && ov.items.length) {
      if (!diffSeq(text, ov, nv, column + indent, indent, out)) return false;
      continue;
    }
    const span = pairSpan(text, o);
    if (!span) return false;
    const comment = (ov as Node | null)?.comment;
    if (comment && nv && !(nv as Node).comment && !isBlockMap(nv) && !isBlockSeq(nv)) (nv as Node).comment = comment;
    out.push({ from: span[0], to: span[1], text: printPair(p, columnOf(text, (o.key as Node).range![0]), indent) });
  }
  return true;
}

/** Splices for a block list: items matched by content, in order (longest common run). */
function diffSeq(text: string, a: YAMLSeq, b: YAMLSeq, column: number, indent: number, out: Splice[]): boolean {
  const oi = a.items as Node[];
  const ni = b.items as Node[];
  const firstDash = dashBefore(text, oi[0]!.range![0]);
  column = columnOf(text, firstDash);
  const oj = oi.map(json);
  const nj = ni.map(json);
  // Same length: compare item by item, so an edited item is replaced in place.
  if (oi.length === ni.length) {
    for (let i = 0; i < oi.length; i++) {
      if (oj[i] === nj[i]) continue;
      const span = itemSpan(text, oi[i]!);
      if (!span) return false;
      // An item changed where it stands keeps the comment above it; one that moved here brings its own.
      const kept = oi[i]!.commentBefore;
      if (kept && ni[i] && typeof ni[i] === 'object' && !ni[i]!.commentBefore && !oj.includes(nj[i]!)) ni[i]!.commentBefore = kept;
      // The blank line above a commented item is still in the text: it is not printed again.
      out.push({ from: span[0], to: span[1], text: printItem(ni[i], column, indent).replace(/^\n+/, '') });
    }
    return true;
  }
  // Otherwise match by content (LCS), remove the rest and insert the new ones after their neighbour.
  const n = oi.length;
  const m = ni.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = oj[i] === nj[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  let i = 0;
  let j = 0;
  let prevEnd = lineStart(text, firstDash) - 1;
  const inserts: { at: number; items: Node[] }[] = [];
  while (i < n || j < m) {
    if (i < n && j < m && oj[i] === nj[j]) {
      prevEnd = itemSpan(text, oi[i]!)![1];
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      const last = inserts.at(-1);
      if (last && last.at === prevEnd) last.items.push(ni[j]!);
      else inserts.push({ at: prevEnd, items: [ni[j]!] });
      j++;
    } else {
      const span = itemSpan(text, oi[i]!);
      if (!span) return false;
      out.push({ from: span[0], to: Math.min(text.length, span[1] + 1), text: '' });
      i++;
    }
  }
  for (const ins of inserts) {
    const body = ins.items.map((it) => printItem(it, column, indent)).join('\n');
    // Before the first item: at its line start, with the newline after.
    out.push(ins.at < lineStart(text, firstDash) ? { from: ins.at + 1, to: ins.at + 1, text: body + '\n' } : { from: ins.at, to: ins.at, text: '\n' + body });
  }
  return true;
}
