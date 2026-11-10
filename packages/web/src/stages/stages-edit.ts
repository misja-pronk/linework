// Stages written without typing YAML: what is added or deleted while a stage is picked is recorded in
// that stage's add: or remove: list. Text → text like the builder edits: one undo step each.
import { isMap, isScalar, isSeq, parseDocument, YAMLSeq } from 'yaml';
import { printPreserving } from '../yaml-print.ts';

type Key = 'add' | 'remove';

/** Runs `change` on the list `key` of stage `k` (0-based) and prints the document back; no text when it cannot be done. */
function edit(text: string, k: number, key: Key, change: (list: YAMLSeq) => boolean): string | undefined {
  try {
    const doc = parseDocument(text);
    if (doc.errors.length || !isMap(doc.contents)) return undefined;
    const stage = doc.getIn(['stages', k], true);
    if (!isMap(stage)) return undefined;
    let list: unknown = stage.get(key, true);
    if (list == null) {
      const seq = new YAMLSeq();
      seq.flow = true;
      stage.set(key, seq);
      list = seq;
    } else if (isScalar(list)) {
      const seq = new YAMLSeq();
      seq.flow = true;
      seq.items.push(list);
      stage.set(key, seq);
      list = seq;
    }
    if (!isSeq(list) || !change(list)) return undefined;
    if (!list.items.length) stage.delete(key);
    return printPreserving(text, doc);
  } catch (e) {
    console.warn('stage edit failed', e);
    return undefined;
  }
}

const values = (list: YAMLSeq) => list.items.map((x) => String(isScalar(x) ? x.value : x));

/** `selector` (an id or "a -> b") in stage k's add: or remove: list; the text unchanged when it is there already. */
export function recordIn(text: string, k: number, key: Key, selector: string): string | undefined {
  return (
    edit(text, k, key, (list) => {
      if (values(list).includes(selector)) return false;
      list.items.push(selector);
      return true;
    }) ?? (listed(text, k, key, selector) ? text : undefined)
  );
}

/** `selector` taken out of stage k's list. */
export function dropFrom(text: string, k: number, key: Key, selector: string): string | undefined {
  return edit(text, k, key, (list) => {
    const i = values(list).indexOf(selector);
    if (i < 0) return false;
    list.items.splice(i, 1);
    return true;
  });
}

/** Whether stage k lists `selector` under `key`. */
export function listed(text: string, k: number, key: Key, selector: string): boolean {
  try {
    const v = (parseDocument(text).toJS() as { stages?: Record<string, unknown>[] })?.stages?.[k]?.[key];
    return (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]).includes(selector);
  } catch {
    return false;
  }
}

/**
 * Stage lists without what is gone: an id under add:, remove:, change: or replace: that no entry of
 * the file has any more (it was deleted) is taken out, so deleting an element never leaves a stage
 * naming nothing. A line "a -> b" goes when either end is gone. The text as it was when nothing is.
 */
export function tidyStages(text: string): string {
  if (!/^stages:/m.test(text)) return text;
  try {
    const doc = parseDocument(text);
    if (doc.errors.length || !isMap(doc.contents)) return text;
    const data = doc.toJS() as Record<string, unknown>;
    if (!Array.isArray(data.stages)) return text;
    const ids = new Set<string>();
    for (const [k, v] of Object.entries(data)) if (k !== 'stages' && v && typeof v === 'object' && !Array.isArray(v)) for (const id of Object.keys(v)) ids.add(id);
    // Without a map of entries (a type that writes its elements otherwise), nothing is known to be gone.
    if (!ids.size) return text;
    const gone = (sel: string) => {
      if (/^(tag|kind):|\*/.test(sel)) return false;
      const ends = sel.split('->').map((s) => s.trim().split('.')[0]!);
      return ends.some((e) => e && !ids.has(e));
    };
    let changed = false;
    for (const [k, st] of (data.stages as Record<string, unknown>[]).entries()) {
      if (!st || typeof st !== 'object') continue;
      const stage = doc.getIn(['stages', k], true);
      if (!isMap(stage)) continue;
      for (const key of ['add', 'remove'] as const) {
        const list = stage.get(key, true);
        if (isSeq(list)) {
          const before = list.items.length;
          list.items = list.items.filter((x) => !gone(String(isScalar(x) ? x.value : x)));
          if (list.items.length !== before) changed = true;
          if (!list.items.length) stage.delete(key);
        } else if (isScalar(list) && gone(String(list.value))) {
          stage.delete(key);
          changed = true;
        }
      }
      for (const key of ['change', 'replace'] as const) {
        const m = stage.get(key, true);
        if (!isMap(m)) continue;
        const before = m.items.length;
        m.items = m.items.filter((p) => {
          const id = String(isScalar(p.key) ? p.key.value : p.key);
          const to = key === 'replace' && isScalar(p.value) ? String(p.value.value) : undefined;
          return !gone(id) && !(to && gone(to));
        });
        if (m.items.length !== before) changed = true;
        if (!m.items.length) stage.delete(key);
      }
    }
    return changed ? printPreserving(text, doc) : text;
  } catch {
    return text;
  }
}
