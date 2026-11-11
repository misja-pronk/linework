// Drawing a document for the preview, in the extension host: the engine as the CLI calls it, with the
// files next to the diagram, its sidecar, and the font faces sent once instead of with every drawing.
import fs from 'node:fs';
import path from 'node:path';
import { parseSidecar, viewPins, withViewPins, type Box, type LayoutSidecar } from '@cartography/core';
import { render, type RenderOptions, type RenderResult } from '@cartography/engine';
import { sidecarName } from './detect.ts';

export interface DrawAsk {
  text: string;
  /** The file on disk; without it (an unsaved document) nothing next to it can be read. */
  file?: string;
  view?: string;
  step?: number;
  /** An element id (or selector) to draw the neighbourhood of; null: everything, whatever the diagram says. */
  focus?: string | null;
  /** VS Code's colour scheme: the diagram's own theme wins over it. */
  scheme: 'light' | 'dark';
  /** A theme that wins over the diagram's (the setting), or undefined. */
  themeOverride?: string;
  stepCaption?: boolean;
}

/** What the webview gets: plain data. */
export interface Picture {
  svg: string;
  width: number;
  height: number;
  origin: { x: number; y: number };
  /** Pin = box + shift. */
  shift: { x: number; y: number };
  nodes: Record<string, Box>;
  groups: Record<string, Box>;
  views?: { name: string; title?: string }[];
  view?: string;
  steps?: { title?: string; caption?: string }[];
  step?: number;
  focus?: { names: string[]; written: boolean };
  /** Key of the font faces this drawing needs; the faces themselves come with `fontCss` when it changes. */
  fonts: string;
  /** The canvas colour, for the area around the drawing. */
  canvas?: string;
  title?: string;
}

export function readSidecar(file: string | undefined): LayoutSidecar | undefined {
  if (!file) return undefined;
  try {
    // What cannot be read of it is left out; the rest still pins the drawing.
    return parseSidecar(JSON.parse(fs.readFileSync(sidecarName(file), 'utf8'))).sidecar;
  } catch {
    return undefined;
  }
}

/** Writes the sidecar the way the CLI and the editor do; with nothing left in it the file goes. */
export function writeSidecar(file: string, sidecar: LayoutSidecar | undefined): void {
  const p = sidecarName(file);
  if (sidecar) fs.writeFileSync(p, JSON.stringify(sidecar, null, 2) + '\n');
  else fs.rmSync(p, { force: true });
}

/** Text and bytes of files next to the diagram, as the CLI reads them. */
export function filesNear(file: string | undefined): Pick<RenderOptions, 'load' | 'assets' | 'file'> {
  if (!file) return {};
  const dir = path.dirname(file);
  return {
    file: path.basename(file),
    load: (rel) => fs.readFileSync(path.resolve(dir, rel), 'utf8'),
    assets: (rel) => {
      const p = path.resolve(dir, rel);
      return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : undefined;
    },
  };
}

export function renderOptions(ask: DrawAsk, extra: RenderOptions = {}): RenderOptions {
  return {
    ...filesNear(ask.file),
    theme: ask.scheme,
    themeOverride: ask.themeOverride || undefined,
    sidecar: readSidecar(ask.file),
    view: ask.view,
    step: ask.step,
    stepCaption: ask.stepCaption,
    ...(ask.focus !== undefined ? { focus: ask.focus } : {}),
    ...extra,
  };
}

const FACES = /<style>(@font-face[\s\S]*?)<\/style>/;

/** The SVG without its font faces, and the faces apart. */
export function splitFonts(svg: string): { svg: string; css: string } {
  const m = FACES.exec(svg);
  return m ? { svg: svg.replace(m[0], ''), css: m[1]! } : { svg, css: '' };
}

const boxes = (m: Map<string, Box> | undefined) => Object.fromEntries([...(m ?? [])].map(([id, b]) => [id, { x: b.x, y: b.y, width: b.width, height: b.height }]));

export function pictureOf(r: RenderResult, svg: string): Picture {
  return {
    svg,
    width: r.width ?? 0,
    height: r.height ?? 0,
    origin: r.origin ?? { x: 0, y: 0 },
    shift: r.placed?.shift ?? { x: 0, y: 0 },
    nodes: boxes(r.placed?.nodes),
    groups: boxes(r.placed?.groups),
    ...(r.views ? { views: r.views } : {}),
    ...(r.view ? { view: r.view } : {}),
    ...(r.steps ? { steps: r.steps.map((s) => ({ title: s.title, caption: s.caption })) } : {}),
    ...(r.step ? { step: r.step } : {}),
    ...(r.focus ? { focus: { names: r.focus.names, written: r.focus.written } } : {}),
    fonts: r.theme?.name ?? '',
    canvas: r.theme?.canvas,
    title: r.graph?.title,
  };
}

export interface Drawn {
  result: RenderResult;
  picture?: Picture;
  fontCss: string;
}

/** Draws for the preview: interactive marks on, links kept inert, fonts apart. */
export async function draw(ask: DrawAsk): Promise<Drawn> {
  const result = await render(ask.text, renderOptions(ask, { fonts: 'embed', interactive: true, hints: false, idPrefix: 'carto' }));
  if (!result.svg) return { result, fontCss: '' };
  const { svg, css } = splitFonts(result.svg);
  return { result, picture: { ...pictureOf(result, svg), fonts: css ? `${result.theme?.name ?? ''}:${css.length}` : '' }, fontCss: css };
}

/**
 * Every problem of the file, as `carto validate` finds them: the drawing asked for and each of its
 * views (what a view says about itself is only known when it is drawn).
 */
export async function allDiagnostics(ask: DrawAsk, first: RenderResult): Promise<RenderResult['diagnostics']> {
  const plain = { ...ask, step: undefined };
  const again = (view: string | undefined) => render(ask.text, renderOptions({ ...plain, view }, { fonts: 'none' })).catch(() => undefined);
  // The diagram as written too, when the drawing was of a view.
  const others: (string | undefined)[] = [...(ask.view ? [undefined] : []), ...(first.views ?? []).map((v) => v.name).filter((v) => v !== first.view)];
  const rest = await Promise.all(others.map(again));
  return [first, ...rest].flatMap((r) => r?.diagnostics ?? []);
}

/** The sidecar with one node pinned at a point (pin space), or its pin gone; a lock without its pin goes too. */
export function pinned(sidecar: LayoutSidecar | undefined, view: string | undefined, id: string, at: { x: number; y: number } | undefined): LayoutSidecar | undefined {
  const mine = viewPins(sidecar, view);
  const nodes = { ...(mine?.nodes ?? {}) };
  if (at) nodes[id] = at;
  else delete nodes[id];
  const locked = mine?.locked?.filter((l) => l in nodes || !!mine.groups?.[l]);
  // Without a view `mine` is the whole sidecar: the named views' pins go along unchanged.
  return withViewPins(sidecar, view, { ...mine, version: 1, nodes, locked });
}
