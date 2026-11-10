// The heavy half of the embed: the engine with Graphviz, loaded once per page when the first
// diagram comes near the viewport. The loader (element.ts) only knows these few functions.
import { includesOf, joinPath, parseSource, type LayoutSidecar } from '@cartography/core';
import { render, themes, type RenderResult } from '@cartography/engine';
import { bundledFont, type Theme } from '@cartography/theme';

export interface DrawRequest {
  text: string;
  /** The diagram's file name, so an include back to it reads as a cycle. */
  file?: string;
  view?: string;
  /** What the page looks like; used unless the diagram or `theme` says otherwise. */
  scheme: 'light' | 'dark';
  /** A theme name from the element's attribute: wins over the diagram's own. */
  theme?: string;
  sidecar?: LayoutSidecar;
  idPrefix: string;
  /** Text of a file next to the diagram (a path relative to it); rejects when it cannot be read. */
  read: (file: string) => Promise<string>;
  /** Bytes of a file next to the diagram (brand fonts, logos). */
  bytes: (file: string) => Promise<Uint8Array>;
  /** Official icons the page was built with, kind → SVG (carto embed and the docs plugins take them along). */
  icons?: Record<string, string>;
}

const dirOf = (file: string) => file.split('/').slice(0, -1).join('/');

/**
 * Renders with files that have to be fetched first. The engine reads files synchronously, so includes
 * are fetched up front, and whatever else a render asks for (theme files, contracts, fonts) is fetched
 * after it and the diagram drawn again; a file that cannot be read is reported by the engine as usual.
 */
export async function draw(req: DrawRequest): Promise<RenderResult> {
  const texts = new Map<string, string | null>();
  const assets = new Map<string, Uint8Array | null>();
  const fetchText = async (file: string) => void texts.set(file, await req.read(file).catch(() => null));
  const fetchBytes = async (file: string) => void assets.set(file, await req.bytes(file).catch(() => null));

  const follow = async (text: string, dir: string, depth: number): Promise<void> => {
    const data = parseSource(text).data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || depth > 8) return;
    await Promise.all(
      includesOf(data as Record<string, unknown>).map(async (rel) => {
        const file = joinPath(dir, rel);
        if (texts.has(file)) return;
        texts.set(file, null);
        await fetchText(file);
        const t = texts.get(file);
        if (t) await follow(t, dirOf(file), depth + 1);
      }),
    );
  };
  await follow(req.text, '', 0);

  for (let pass = 0; ; pass++) {
    const wantText = new Set<string>();
    const wantBytes = new Set<string>();
    const result = await render(req.text, {
      theme: req.scheme,
      themeOverride: req.theme && themes[req.theme] ? req.theme : undefined,
      sidecar: req.sidecar,
      view: req.view,
      file: req.file,
      fonts: 'none',
      interactive: true,
      hints: false,
      idPrefix: req.idPrefix,
      ...(req.icons ? { icons: req.icons } : {}),
      load: (file) => {
        const t = texts.get(file);
        if (typeof t === 'string') return t;
        if (t === undefined) wantText.add(file);
        throw new Error(`Cannot read ${file}`);
      },
      assets: (file) => {
        const b = assets.get(file);
        if (b === undefined) wantBytes.add(file);
        return b ?? undefined;
      },
    });
    if ((!wantText.size && !wantBytes.size) || pass >= 4) return result;
    await Promise.all([...[...wantText].map(fetchText), ...[...wantBytes].map(fetchBytes)]);
  }
}

export const themeNames = Object.keys(themes);
/** The bundled faces a theme sets its text in, as woff2 per weight (render has loaded them): what the page registers. Inter where a brand brings its own files. */
export const themeFonts = (theme: Theme | undefined) =>
  [theme?.font.sans ?? 'Inter', theme?.font.monoFace].flatMap((name) => {
    const f = bundledFont(name);
    return f ? [{ family: f.family, woff2: f.woff2 }] : [];
  });
