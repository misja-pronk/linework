// Changing a diagram by YAML path: set, append, delete, rename. Small edits keep the rest of the file
// byte for byte (comments, order, hand edits), so an agent's change reads as a small diff. The MCP
// server writes them to disk, and the editors show them as a proposal; both check the input here first.
import { isMap, isSeq, parseDocument, YAMLSeq, type Document } from 'yaml';
import type { DiagramType } from './diagram-type.ts';
import type { LayoutSidecar } from './model.ts';
import { deleteEntryUnsafe, isEntryPath, renameEntryUnsafe } from './entry-edit.ts';
import { printPreserving } from './yaml-print.ts';

type Path = (string | number)[];

export type Operation =
  | { op: 'set'; path: Path; value: unknown }
  | { op: 'append'; path: Path; value: unknown }
  | { op: 'delete'; path: Path }
  | { op: 'rename'; path: Path; to: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPath = (v: unknown): v is Path => Array.isArray(v) && v.length > 0 && v.every((s) => (typeof s === 'string' && s !== '') || (Number.isInteger(s) && (s as number) >= 0));
const extra = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).filter((k) => !allowed.includes(k));

/** Operations as a caller sent them (JSON from a tool call or a socket), checked: the list, or why it does not fit. */
export function checkOperations(input: unknown): Operation[] | { error: string } {
  if (!Array.isArray(input) || !input.length) return { error: '"edits" must be a non-empty list.' };
  const operations: Operation[] = [];
  for (const [i, o] of input.entries()) {
    const at = `edits[${i}]`;
    if (!isObj(o)) return { error: `${at} is not an object.` };
    const unknown = extra(o, ['op', 'path', 'value', 'to']);
    if (unknown.length) return { error: `${at} has unknown field ${unknown.map((k) => `"${k}"`).join(', ')}.` };
    if (!isPath(o.path)) return { error: `${at}.path must be a non-empty list of keys (strings) and list indexes (whole numbers).` };
    if (o.op === 'set' || o.op === 'append') {
      if (!('value' in o) || o.value === undefined || o.value === null) return { error: `${at} (${o.op}) needs a "value".` };
      operations.push({ op: o.op, path: o.path, value: o.value });
    } else if (o.op === 'delete') operations.push({ op: 'delete', path: o.path });
    else if (o.op === 'rename') {
      if (typeof o.to !== 'string' || !o.to.trim()) return { error: `${at} (rename) needs "to", the new id.` };
      operations.push({ op: 'rename', path: o.path, to: o.to.trim() });
    } else return { error: `${at}.op must be one of set, append, delete, rename.` };
  }
  return operations;
}

export interface Applied {
  text: string;
  /** Ids renamed on the way, old → new, so pins can follow them. */
  renames: Map<string, string>;
}

const show = (p: Path) => JSON.stringify(p);

/**
 * A value as the file would have it written: the short line form "a -> b: label" is a one-key map in
 * YAML (a string would come out quoted), and a flat entry is one flow line where its siblings are.
 */
function nodeFor(doc: Document, parent: unknown, value: unknown) {
  const line = typeof value === 'string' ? /^([^:#\n]+?-+>[^:#\n]+?):\s+(.+)$/.exec(value) : null;
  if (line) return doc.createNode({ [line[1]!.trim()]: line[2]!.trim() });
  const flat = isObj(value) && Object.values(value).every((v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object')));
  const siblings = isMap(parent) ? parent.items.map((i) => i.value) : [];
  const flow = flat && (siblings.length === 0 || siblings.some((v) => isMap(v) && v.flow));
  return doc.createNode(value, { flow });
}

const tryEdit = (f: () => string | undefined) => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

/** Applies the operations in order; the first that cannot be done stops it, with the reason. */
export function applyOperations(text: string, type: DiagramType, ops: Operation[]): Applied | { error: string } {
  let out = text;
  const renames = new Map<string, string>();
  for (const [i, o] of ops.entries()) {
    const at = `edits[${i}] (${o.op} ${show(o.path)})`;
    if (o.op === 'rename') {
      if (!isEntryPath(o.path)) return { error: `${at}: rename works on an entry, e.g. ["nodes", "api"].` };
      const next = tryEdit(() => renameEntryUnsafe(out, type, o.path, o.to));
      if (next === undefined) return { error: `${at}: cannot rename to "${o.to}": the entry does not exist, the new id is taken, or it is not a valid id (letters, digits, - and _).` };
      const from = String(o.path.at(-1));
      // A chain of renames (a → b, then b → c) is one rename from the first id.
      const first = [...renames].find(([, to]) => to === from)?.[0];
      renames.set(first ?? from, o.to);
      out = next;
      continue;
    }
    const doc = parseDocument(out);
    if (doc.errors.length) return { error: `${at}: the YAML does not parse: ${doc.errors[0]!.message}` };
    if (o.op === 'delete') {
      if (!doc.hasIn(o.path)) return { error: `${at}: there is nothing at that path.` };
      // An entry goes with the lines and references to it, as a delete in the builder does.
      const next = isEntryPath(o.path) ? tryEdit(() => deleteEntryUnsafe(out, type, o.path)) : undefined;
      if (next !== undefined) {
        out = next;
        continue;
      }
      doc.deleteIn(o.path);
    } else if (o.op === 'set') {
      const parent = o.path.length > 1 ? doc.getIn(o.path.slice(0, -1), true) : doc.contents;
      const last = o.path.at(-1)!;
      if (parent !== undefined && parent !== null && typeof last === 'number' && !isSeq(parent)) return { error: `${at}: ${show(o.path.slice(0, -1))} is not a list.` };
      if (isSeq(parent) && typeof last === 'number' && last > parent.items.length) return { error: `${at}: the list has ${parent.items.length} items; use append to add one.` };
      if (isSeq(parent) && typeof last === 'string') return { error: `${at}: ${show(o.path.slice(0, -1))} is a list; address its items by number.` };
      doc.setIn(o.path, nodeFor(doc, parent, o.value));
    } else {
      const list = doc.getIn(o.path, true);
      if (list === undefined) doc.setIn(o.path, doc.createNode([nodeFor(doc, undefined, o.value)]));
      else if (isSeq(list)) (list as YAMLSeq).add(nodeFor(doc, list, o.value));
      else return { error: `${at}: ${isMap(list) ? 'that is a map; use set with a new key' : 'that is not a list'}.` };
    }
    out = printPreserving(out, doc);
  }
  return { text: out, renames };
}

/** Pins that follow renamed ids: what was pinned as the old id is pinned as the new one. */
export function renamePins<T extends { nodes?: Record<string, unknown>; groups?: Record<string, unknown>; locked?: string[] }>(pins: T | undefined, renames: Map<string, string>): T | undefined {
  if (!pins || !renames.size) return pins;
  const move = <V>(m: Record<string, V> | undefined) => (m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [renames.get(k) ?? k, v])) : m);
  return { ...pins, ...(pins.nodes ? { nodes: move(pins.nodes) } : {}), ...(pins.groups ? { groups: move(pins.groups) } : {}), ...(pins.locked ? { locked: pins.locked.map((k) => renames.get(k) ?? k) } : {}) };
}

/** The pins of the diagram and of each of its views, following renamed ids. */
export function renamePinsEverywhere(side: LayoutSidecar, renames: Map<string, string>): LayoutSidecar {
  const top = renamePins(side, renames)!;
  return side.views ? { ...top, views: Object.fromEntries(Object.entries(side.views).map(([k, v]) => [k, renamePins(v, renames)!])) } : top;
}
