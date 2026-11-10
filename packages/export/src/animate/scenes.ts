// The scenes of an animation: one drawing told as beats (its steps, its layers one after the other, or
// a walk along a route), each drawn on a 16:9 frame in the same place, with the beat's title and
// caption as a lower third under the drawing. Only what shows and what stands out changes from beat
// to beat, so the frames in between are a blend of two pictures (timeline.ts).
import { fadeState, finalState, selectorsOf, type Faded, type Graph, type Placed, type Point, type StepState } from '@cartography/core';
import { drawSvg, wrap, type StepView } from '@cartography/render';
import { themeTextFonts, withTextFonts, type Theme } from '@cartography/theme';

/** One beat of the story: how the drawing looks, and what is said under it. */
export interface Beat {
  state: StepState;
  title?: string;
  caption?: string;
}

/** A drawing to animate: laid out once; the beats only change emphasis. */
export interface Animated {
  graph: Graph;
  placed: Placed;
  theme: Theme;
  beats: Beat[];
  /** Official icons (BYO packs), as render() returns them. */
  images?: { nodes?: Map<string, string>; groups?: Map<string, string> };
}

/** The frame scenes are drawn on, in SVG units; the pixel size only scales it. */
export const FRAME = { width: 1280, height: 720 };

const EMPTY = (): StepState => ({ nodes: {}, groups: {}, edges: {}, notes: [] });

/** Beats from a diagram's steps (written or implied), faded where a dim layer is drawn. */
export function stepBeats(steps: StepState[], faded?: Faded): Beat[] {
  return steps.map((s) => ({ state: faded ? fadeState(s, faded) : s, ...(s.title ? { title: s.title } : {}), ...(s.caption ? { caption: s.caption } : {}) }));
}

/**
 * Walking the layers: the drawing as the story leaves it, then each layer in turn standing out with
 * the rest faded in place (never laid out anew, so nothing moves between beats).
 */
export function layerBeats(steps: StepState[] | undefined, layers: { name: string; title?: string; caption?: string; faded: Faded }[], whole?: string): Beat[] {
  const end = steps?.length ? (finalState(steps) ?? EMPTY()) : EMPTY();
  return [{ state: end, title: whole ?? 'The whole drawing' }, ...layers.map((l) => ({ state: fadeState(end, l.faded), title: l.title ?? l.name, ...(l.caption ? { caption: l.caption } : {}) }))];
}

/**
 * Walking a route "a -> b -> c": a beat per hop, its line and ends in focus, where the walk has been
 * at full strength and the rest standing back. Undefined when the route names nothing drawn.
 */
export function walkBeats(graph: Graph, route: string, report: (message: string) => void = () => {}): Beat[] | undefined {
  const { pick } = selectorsOf(graph);
  const stops = route.split('->').map((s) => s.trim()).filter(Boolean);
  if (stops.length < 2) return report(`--walk takes a route of two stops or more, like "customer -> web -> api"`), undefined;
  const name = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    const s = n?.shape;
    return s && (s.kind === 'card' || s.kind === 'flow') ? s.label || id : s?.kind === 'table' ? s.title : (graph.groups.find((g) => g.id === id)?.label ?? id);
  };
  const seen = { nodes: new Set<string>(), groups: new Set<string>(), edges: new Set<string>() };
  const beats: Beat[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const hop = pick(`${stops[i]} -> ${stops[i + 1]}`, true, report);
    if (!hop.edges.length) continue;
    const state = EMPTY();
    const lit = new Set([...hop.nodes, ...hop.groups]);
    for (const n of graph.nodes) {
      if (lit.has(n.id)) state.nodes[n.id] = 'focus';
      else if (!seen.nodes.has(n.id)) state.nodes[n.id] = 'dim';
    }
    // A group stays at full strength when the walk is or was inside it.
    const groups = new Map(graph.groups.map((g) => [g.id, g.parent]));
    const within = new Set<string>();
    for (const id of [...lit, ...seen.nodes, ...seen.groups]) for (let g = graph.nodes.find((n) => n.id === id)?.parent ?? groups.get(id); g && !within.has(g); g = groups.get(g)) within.add(g);
    for (const g of graph.groups) if (!lit.has(g.id) && !within.has(g.id) && !seen.groups.has(g.id)) state.groups[g.id] = 'dim';
    for (const e of graph.edges) {
      if (hop.edges.includes(e.id)) state.edges[e.id] = 'focus';
      else if (!seen.edges.has(e.id)) state.edges[e.id] = 'dim';
    }
    beats.push({ state, title: `${name(stops[i]!)} → ${name(stops[i + 1]!)}` });
    for (const id of hop.nodes) seen.nodes.add(id);
    for (const id of hop.groups) seen.groups.add(id);
    for (const id of hop.edges) seen.edges.add(id);
  }
  return beats.length ? beats : undefined;
}

export interface SceneOptions {
  /** Embed the theme's fonts: for a browser; resvg reads font files and does without. */
  fonts?: 'embed' | 'none';
  /** The lower third with title, caption and "3 / 7"; off draws the drawing alone, larger. */
  captions?: boolean;
}

/** One beat, drawn on the frame; `lines` are where the beat's lines run, in frame units, for drawing them on. */
export interface Scene {
  svg: string;
  /** The same beat with these lines not drawn yet (what the transition reveals along their path). */
  without?: (edges: string[]) => string;
  /** The path of a line in frame units, as drawn. */
  path: (edge: string) => Point[];
  /** Where the words of the lower third start, in frame units (under its rule); none without one. */
  words?: number;
}

const LT = { padX: 56, rule: 22, title: 22, text: 18, row: 28, bottom: 30, marker: 120 };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The lines a beat says in the lower third: its title, then the caption wrapped to the room there is. */
function saying(b: Beat): { text: string; title: boolean }[] {
  const room = FRAME.width - 2 * LT.padX - LT.marker;
  return [...(b.title ? [{ text: b.title, title: true }] : []), ...(b.caption ? wrap(b.caption, LT.text, 400, room).map((text) => ({ text, title: false })) : [])];
}

/** The drawing's scenes: every beat on the frame, the drawing the same size and in the same place in all of them. */
export function scenes(a: Animated, opts: SceneOptions = {}): Scene[] {
  const { graph, placed, theme, beats } = a;
  return withTextFonts(themeTextFonts(theme), () => {
    const said = opts.captions === false ? [] : beats.map(saying);
    const rows = Math.max(0, ...said.map((s) => s.length));
    // As high as the longest caption of all beats, so the drawing never moves.
    const band = rows ? LT.rule + 18 + rows * LT.row + LT.bottom : beats.length > 1 && opts.captions !== false ? 44 : 0;
    const states = beats.map((b) => b.state);
    const draw = (i: number, state: StepState) => {
      const view: StepView = { index: i, states: states.map((s, j) => (j === i ? state : s)), caption: false };
      return drawSvg(graph, placed, theme, { fonts: opts.fonts ?? 'none', ...(a.images ? { images: a.images } : {}), stepView: view });
    };
    const first = draw(0, states[0]!);
    const box = { x: 40, y: 28, width: FRAME.width - 80, height: FRAME.height - band - 28 - (band ? 4 : 28) };
    // Never blown up beyond twice its size: a small drawing stays a drawing, not a poster.
    const k = Math.min(box.width / first.width, box.height / first.height, 2);
    const w = first.width * k;
    const h = first.height * k;
    const dx = box.x + (box.width - w) / 2;
    const dy = box.y + (box.height - h) / 2;
    const accent = theme.accent ?? theme.tones.blue.fg;
    const lower = (i: number) => {
      if (!band) return '';
      const top = FRAME.height - band;
      let out = `<rect x="${LT.padX}" y="${top + LT.rule}" width="${FRAME.width - 2 * LT.padX}" height="1" fill="${theme.border}"/><rect x="${LT.padX}" y="${top + LT.rule - 1}" width="48" height="3" rx="1.5" fill="${accent}"/>`;
      let cy = top + LT.rule + 18 + LT.row / 2;
      const base = (size: number) => r1(cy + size * 0.36);
      if (beats.length > 1) {
        const marker = `${i + 1} / ${beats.length}`;
        out += `<text x="${FRAME.width - LT.padX}" y="${base(15)}" font-size="15" font-weight="500" fill="${theme.textFaint}" text-anchor="end"${theme.font.mono ? ` font-family="${esc(theme.font.mono)}"` : ''}>${esc(marker)}</text>`;
        // A dot per beat under the marker: where the story is, at a glance.
        const dots = beats.length <= 24 ? beats.map((_, j) => `<circle cx="${r1(FRAME.width - LT.padX - (beats.length - 1 - j) * 12 - 3)}" cy="${r1(cy + 20)}" r="3" fill="${j === i ? accent : theme.border}"/>`).join('') : '';
        out += dots;
      }
      for (const l of said[i] ?? []) {
        out += l.title
          ? `<text x="${LT.padX}" y="${base(LT.title)}" font-size="${LT.title}" font-weight="600" fill="${theme.text}">${esc(l.text)}</text>`
          : `<text x="${LT.padX}" y="${base(LT.text)}" font-size="${LT.text}" font-weight="400" fill="${beats[i]!.title ? theme.textMuted : theme.text}">${esc(l.text)}</text>`;
        cy += LT.row;
      }
      return out;
    };
    const frame = (i: number, drawing: { svg: string; width: number; height: number }) => {
      const inner = drawing.svg.replace(/^<svg\b([^>]*)>/, (_m, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} x="${r1(dx)}" y="${r1(dy)}" width="${r1(w)}" height="${r1(h)}">`);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.width}" height="${FRAME.height}" viewBox="0 0 ${FRAME.width} ${FRAME.height}" font-family="${esc(theme.font.family)}" text-rendering="geometricPrecision"><rect width="${FRAME.width}" height="${FRAME.height}" fill="${theme.canvas}"/>${inner}${lower(i)}</svg>`;
    };
    const s = w / first.width;
    return beats.map((b, i) => {
      const drawn = i ? draw(i, b.state) : first;
      const at = (p: Point): Point => ({ x: dx + s * (drawn.origin.x + p.x), y: dy + s * (drawn.origin.y + p.y) });
      return {
        svg: frame(i, drawn),
        without: (edges: string[]) => withTextFonts(themeTextFonts(theme), () => frame(i, draw(i, { ...b.state, edges: { ...b.state.edges, ...Object.fromEntries(edges.map((e) => [e, 'hidden' as const])) } }))),
        path: (edge: string) => (placed.edges.get(edge)?.points ?? []).map(at),
        ...(band ? { words: FRAME.height - band + LT.rule + 3 } : {}),
      };
    });
  });
}

/** Lines a beat draws that the beat before it did not: these are drawn along their path when asked. */
export function newLines(before: Beat | undefined, after: Beat, graph: Graph): string[] {
  if (!before) return [];
  const hidden = (b: Beat, e: Graph['edges'][number]) => b.state.edges[e.id] === 'hidden' || b.state.nodes[e.from.node] === 'hidden' || b.state.nodes[e.to.node] === 'hidden' || b.state.groups[e.from.node] === 'hidden' || b.state.groups[e.to.node] === 'hidden';
  return graph.edges.filter((e) => hidden(before, e) && !hidden(after, e)).map((e) => e.id);
}

