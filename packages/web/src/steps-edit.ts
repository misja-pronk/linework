// Steps written without typing YAML: a step made from the selection, renamed, moved or deleted.
// Text → text like the builder edits, so each one is an ordinary edit in the editor (one undo step).
import { isMap, isSeq, parseDocument, YAMLSeq, type Document } from 'yaml';
import { printPreserving } from './yaml-print.ts';

type Path = (string | number)[];

/** The keys of a step written in full; any other key is a route with its caption. */
const KEYS = ['title', 'caption', 'show', 'focus', 'highlight', 'path', 'hide', 'note'];

/** Where the steps of the drawn diagram are written: inside the view, or at the top of the file. */
export const stepsPath = (view?: string): Path => (view ? ['views', view, 'steps'] : ['steps']);

/** Runs `change` on the list of steps and prints the document back; no text when it cannot be done. */
function edit(text: string, at: Path, change: (steps: YAMLSeq, doc: Document) => boolean, create = false): string | undefined {
  const doc = parseDocument(text);
  if (doc.errors.length || !isMap(doc.contents)) return undefined;
  let steps = doc.getIn(at, true);
  if (steps == null && create) {
    // A view from an included file is not written here: its steps cannot be either.
    if (at.length > 1 && !isMap(doc.getIn(at.slice(0, -1), true))) return undefined;
    steps = new YAMLSeq();
    doc.setIn(at, steps);
  }
  if (!isSeq(steps) || !change(steps, doc)) return undefined;
  if (!steps.items.length) doc.deleteIn(at);
  return printPreserving(text, doc);
}

function attempt<A extends unknown[]>(f: (...a: A) => string | undefined): (...a: A) => string | undefined {
  return (...a) => {
    try {
      return f(...a);
    } catch (e) {
      console.warn('step edit failed', e);
      return undefined;
    }
  };
}

/** A new step after step `after` (1-based; at the end without it): what is named in `focus` stands out. */
export const addStep = attempt((text: string, at: Path, step: { title: string; focus: string[] }, after?: number): string | undefined =>
  edit(
    text,
    at,
    (steps, doc) => {
      const item = doc.createNode({ title: step.title, ...(step.focus.length ? { focus: step.focus.length === 1 ? step.focus[0] : step.focus } : {}) });
      const list = isMap(item) ? item.get('focus', true) : undefined;
      if (isSeq(list)) list.flow = true;
      steps.items.splice(after == null ? steps.items.length : Math.min(steps.items.length, after), 0, item);
      return true;
    },
    true,
  ),
);

/** Names step `n` (1-based). A step written short ("a -> b: caption") becomes the long form with the same meaning. */
export const renameStep = attempt((text: string, at: Path, n: number, title: string): string | undefined =>
  edit(text, at, (steps, doc) => {
    const item = steps.get(n - 1, true);
    if (item === undefined) return false;
    const plain = steps.toJSON()[n - 1] as unknown;
    if (isMap(item) && item.items.every((p) => KEYS.includes(String((p.key as { value?: unknown }).value)))) {
      if (title) item.set('title', title);
      else item.delete('title');
      return item.items.length > 0;
    }
    const long: Record<string, unknown> = title ? { title } : {};
    if (typeof plain === 'string' || typeof plain === 'number') long[String(plain).includes('->') ? 'path' : 'caption'] = String(plain);
    else if (plain && typeof plain === 'object') {
      // One or more routes with a caption, next to ordinary keys.
      const o = plain as Record<string, unknown>;
      const routes = Object.keys(o).filter((k) => !KEYS.includes(k));
      const caption = o.caption ?? routes.map((k) => o[k]).find((v) => typeof v === 'string' && v);
      if (caption) long.caption = caption;
      for (const k of KEYS) if (k !== 'title' && k !== 'caption' && k in o) long[k] = o[k];
      const path = [...(Array.isArray(o.path) ? (o.path as string[]) : o.path ? [String(o.path)] : []), ...routes];
      if (path.length) long.path = path.length === 1 ? path[0] : path;
    } else return false;
    if (!Object.keys(long).length) return false;
    steps.set(n - 1, doc.createNode(long));
    return true;
  }),
);

/** Moves step `n` to place `to` (both 1-based). */
export const moveStep = attempt((text: string, at: Path, n: number, to: number): string | undefined =>
  edit(text, at, (steps) => {
    if (n === to || n < 1 || to < 1 || n > steps.items.length || to > steps.items.length) return false;
    const [item] = steps.items.splice(n - 1, 1);
    steps.items.splice(to - 1, 0, item);
    return true;
  }),
);

/** Removes step `n` (1-based); the last one takes `steps:` with it. */
export const deleteStep = attempt((text: string, at: Path, n: number): string | undefined =>
  edit(text, at, (steps) => {
    if (n < 1 || n > steps.items.length) return false;
    steps.items.splice(n - 1, 1);
    return true;
  }),
);
