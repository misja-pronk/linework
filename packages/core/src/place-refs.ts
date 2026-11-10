// Places that name drawn things by id outside the entries themselves: presentation steps, the focus,
// views' rules, threats written apart (`on:`) and trust boundaries listed by id. A type declares the
// references inside its own entries (DiagramType.references); these are shared by every type, so one
// walker finds them for a builder delete or rename, and nothing is left naming what is gone.
//
//   steps:
//     - users -> edge -> web: A customer opens the shop   # a route: role 'route', the key of its map
//     - { title: Keys, path: api -> vault, note: { vault: Managed identity } }
//   focus: { on: [orders, tag:pii] }
//   views: { ops: { include: [api, db], exclude: legacy } }
//   threats: [{ on: "api -> db", stride: E }]
//   trust: [shop]
import type { Path } from './model.ts';

/** selector: an id, id.*, a group or a route in a list or field; route: a step that is a route; note: a step note's key. */
export type PlaceRole = 'selector' | 'route' | 'note' | 'threat' | 'trust';

export interface PlaceSite {
  /** The scalar holding the text; with `key`, the map that has `key` as one of its keys. */
  path: Path;
  key?: string;
  text: string;
  role: PlaceRole;
}

/** Keys of a step that are not a route (steps.ts). */
const STEP_KEYS = new Set(['title', 'caption', 'show', 'focus', 'highlight', 'path', 'hide', 'note']);
const SELECTOR_KEYS = ['show', 'focus', 'highlight', 'path', 'hide'];

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The ids a selector or route names, where each starts: "a -> b.*" names a at 0 and b at 5; tag:x and kind:x name none. */
export function namesIn(text: string): { id: string; start: number }[] {
  const out: { id: string; start: number }[] = [];
  for (const m of text.matchAll(/(?:tag|kind):[\w-]+|[A-Za-z0-9_](?:[A-Za-z0-9_.]|-(?!>))*/g)) {
    if (/^(tag|kind):/.test(m[0])) continue;
    out.push({ id: m[0].replace(/\.+$/, ''), start: m.index! });
  }
  return out;
}

/**
 * Every place-reference in a diagram. `owns(key)` says a key is the type's own (a journey's steps,
 * a git graph's steps): those are entries, not presentation, and are left to the type.
 */
export function placeSites(data: unknown, owns: (key: string) => boolean = () => false): PlaceSite[] {
  const out: PlaceSite[] = [];
  if (!isMap(data)) return out;
  const selectors = (v: unknown, path: Path) => {
    if (typeof v === 'string') out.push({ path, text: v, role: 'selector' });
    else if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'string' && out.push({ path: [...path, i], text: x, role: 'selector' }));
  };
  const focus = (v: unknown, path: Path) => (isMap(v) ? selectors(v.on, [...path, 'on']) : selectors(v, path));
  const steps = (items: unknown, base: Path) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, i) => {
      const at = [...base, i];
      if (typeof item === 'string') {
        if (item.includes('->')) out.push({ path: at, text: item, role: 'route' });
        return;
      }
      if (!isMap(item)) return;
      for (const k of SELECTOR_KEYS) if (item[k] != null) (k === 'focus' ? focus(item[k], [...at, k]) : selectors(item[k], [...at, k]));
      for (const k of Object.keys(item)) if (!STEP_KEYS.has(k)) out.push({ path: at, key: k, text: k, role: 'route' });
      if (isMap(item.note)) for (const k of Object.keys(item.note)) out.push({ path: [...at, 'note'], key: k, text: k, role: 'note' });
    });
  };
  if (!owns('focus') && data.focus != null) focus(data.focus, ['focus']);
  if (!owns('steps')) steps(data.steps, ['steps']);
  if (isMap(data.views))
    for (const [name, raw] of Object.entries(data.views)) {
      if (!isMap(raw)) continue;
      const at: Path = ['views', name];
      for (const k of ['include', 'exclude', 'expand']) selectors(raw[k], [...at, k]);
      if (raw.focus != null) focus(raw.focus, [...at, 'focus']);
      if (raw.kind !== 'dynamic') steps(raw.steps, [...at, 'steps']);
    }
  if (Array.isArray(data.threats))
    data.threats.forEach((t, i) => isMap(t) && typeof t.on === 'string' && out.push({ path: ['threats', i, 'on'], text: t.on, role: 'threat' }));
  if (Array.isArray(data.trust)) data.trust.forEach((t, i) => typeof t === 'string' && out.push({ path: ['trust', i], text: t, role: 'trust' }));
  return out;
}

/** The place-references that name `id`, with where in their text it starts. */
export function placeRefsTo(data: unknown, id: string, owns?: (key: string) => boolean): (PlaceSite & { start: number })[] {
  return placeSites(data, owns).flatMap((s) => namesIn(s.text).filter((n) => n.id === id).map((n) => ({ ...s, start: n.start })));
}
