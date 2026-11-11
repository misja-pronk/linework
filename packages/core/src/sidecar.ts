// The layout sidecar (<name>.layout.json, or the layout of a share link) read leniently: it is
// written by hand and by merges as often as by the editor, so an entry that cannot be read is left
// out and said, and the rest still pins the drawing. Never a NaN in a drawing from a bad position.
import type { EdgeOverride, LayoutNote, LayoutSidecar, Point, ViewPins } from './model.ts';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPoint = (v: unknown): v is Point => isObject(v) && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y);

function points(v: unknown, where: string, warnings: string[]): Record<string, Point> | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) return (warnings.push(`${where}: not a map of positions; ignored`), undefined);
  const out: Record<string, Point> = {};
  for (const [id, p] of Object.entries(v)) {
    if (isPoint(p)) out[id] = { x: p.x, y: p.y };
    else warnings.push(`${where}.${id}: not a position {x, y}; ignored`);
  }
  return out;
}

function edges(v: unknown, where: string, warnings: string[]): Record<string, EdgeOverride> | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) return (warnings.push(`${where}: not a map of lines; ignored`), undefined);
  const out: Record<string, EdgeOverride> = {};
  for (const [id, e] of Object.entries(v)) {
    if (!isObject(e) || !Array.isArray(e.via) || !e.via.every(isPoint)) {
      warnings.push(`${where}.${id}: needs "via", a list of bend points {x, y}; ignored`);
      continue;
    }
    out[id] = { via: e.via.map((p) => ({ x: p.x, y: p.y })), ...(typeof e.from === 'string' ? { from: e.from } : {}), ...(typeof e.to === 'string' ? { to: e.to } : {}) };
  }
  return out;
}

function pins(v: Record<string, unknown>, at: string, warnings: string[]): ViewPins {
  const out: ViewPins = {};
  const nodes = points(v.nodes, `${at}nodes`, warnings);
  const groups = points(v.groups, `${at}groups`, warnings);
  const lines = edges(v.edges, `${at}edges`, warnings);
  if (nodes) out.nodes = nodes;
  if (groups) out.groups = groups;
  if (lines) out.edges = lines;
  if (v.locked !== undefined) {
    if (Array.isArray(v.locked)) out.locked = v.locked.filter((s): s is string => typeof s === 'string');
    if (!Array.isArray(v.locked) || out.locked!.length < v.locked.length) warnings.push(`${at}locked: not a list of names; what is not a name is ignored`);
  }
  if (v.layout !== undefined) {
    if (isObject(v.layout)) {
      const note: LayoutNote = {};
      for (const k of ['variant', 'at', 'shape'] as const) if (typeof v.layout[k] === 'string') note[k] = v.layout[k];
      out.layout = note;
    } else warnings.push(`${at}layout: not an object; ignored`);
  }
  return out;
}

/** A sidecar from parsed JSON: what is not one gives none; an entry that cannot be read is dropped with a warning, the rest kept. */
export function parseSidecar(value: unknown): { sidecar?: LayoutSidecar; warnings: string[] } {
  if (!isObject(value)) return { warnings: ['not a layout: an object with nodes, groups, edges or views was expected; ignored'] };
  const warnings: string[] = [];
  const sidecar: LayoutSidecar = { version: 1, ...pins(value, '', warnings) };
  if (value.views !== undefined) {
    if (isObject(value.views)) {
      sidecar.views = {};
      for (const [name, v] of Object.entries(value.views)) {
        if (isObject(v)) sidecar.views[name] = pins(v, `views.${name}.`, warnings);
        else warnings.push(`views.${name}: not an object; ignored`);
      }
    } else warnings.push('views: not a map of views; ignored');
  }
  return { sidecar, warnings };
}
