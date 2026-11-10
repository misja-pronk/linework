// Changes the review makes to a diagram's YAML: a finding set aside with its reason, written where
// the finding is (on the element or line, when its entry is a map that takes review:), or else in the
// file's own review: ignore list with on:.
import { parseDocument, isMap, isSeq, YAMLMap, YAMLSeq } from 'yaml';
import { printPreserving, type Path } from '@cartography/core';
import type { Finding } from './types.ts';

/** The entry of an element or line, when it is written as a map: nodes.web, groups.vnet, edges.3's value. */
function entryPath(doc: ReturnType<typeof parseDocument>, f: Finding): Path | undefined {
  if (f.on.kind === 'diagram') return undefined;
  const p = f.path;
  if ((p[0] === 'nodes' || p[0] === 'groups') && p.length === 2 && isMap(doc.getIn(p, true))) return p;
  if (p[0] === 'edges' && p.length === 2) {
    const item = doc.getIn(p, true);
    if (!isMap(item)) return undefined;
    if ((item as YAMLMap).has('from')) return p;
    const pairs = (item as YAMLMap).items;
    if (pairs.length === 1 && isMap(pairs[0]!.value)) return [...p, String((pairs[0]!.key as { value?: unknown })?.value ?? pairs[0]!.key)];
  }
  return undefined;
}

/**
 * The YAML with a finding set aside, and why. `inline`: the type takes review: on its elements (the
 * node-and-edge types); else, and for the diagram as a whole, it goes in the top-level review: list.
 */
export function ignoreFinding(text: string, f: Finding, reason: string, inline = true): string {
  const doc = parseDocument(text);
  if (doc.errors.length || !isMap(doc.contents)) return text;
  const item = reason.trim() ? { rule: f.rule.id, reason: reason.trim() } : f.rule.id;
  const at = inline ? entryPath(doc, f) : undefined;
  if (at) {
    const list = doc.getIn([...at, 'review', 'ignore'], true);
    if (isSeq(list)) (list as YAMLSeq).add(doc.createNode(item));
    else doc.setIn([...at, 'review'], doc.createNode({ ignore: [item] }));
  } else {
    if (doc.get('review') === 'off') return text;
    const on = f.on.kind === 'diagram' ? undefined : f.ends ? `${f.ends.from} -> ${f.ends.to}` : f.on.id;
    const entry = { rule: f.rule.id, ...(on ? { on } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) };
    const list = doc.getIn(['review', 'ignore'], true);
    if (isSeq(list)) (list as YAMLSeq).add(doc.createNode(entry));
    else if (isMap(doc.get('review', true))) doc.setIn(['review', 'ignore'], doc.createNode([entry]));
    else doc.set('review', doc.createNode({ ignore: [entry] }));
  }
  return printPreserving(text, doc);
}
