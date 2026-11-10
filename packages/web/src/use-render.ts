// Renders on every change, newest wins: a slow render never overwrites a newer one.
import { useEffect, useRef, useState } from 'react';
import { render, type RenderResult } from '@cartography/engine';
import type { LayoutMemory, LayoutSidecar } from '@cartography/core';
import { useBrand } from './brand.ts';
import { registerThemeFonts } from './fonts.ts';

export interface Rendered {
  result: RenderResult;
  /** The newest render that drew something: kept while the text has errors, so the drawing does not vanish mid-edit. */
  drawn?: RenderResult;
  ms: number;
  text: string;
  /** The document this render belongs to. */
  docKey: number;
}

/**
 * `view` picks one of the diagram's views; `file` is its name, so includes back to it read as a cycle;
 * `step` draws one of its steps. `fresh` counts the times the layout was reset: a new number draws
 * the view from scratch. `focus` cuts the drawing down to a neighbourhood, as `focus:` in the YAML
 * would (null: everything, whatever the YAML says); its caller keeps it the same object between renders.
 */
export function useRender(text: string, theme: 'light' | 'dark', sidecar: LayoutSidecar | undefined, load: ((f: string) => string) | undefined, docKey: number, view?: string, file?: string, step?: number, fresh = 0, focus?: unknown) {
  const [out, setOut] = useState<Rendered>();
  const seq = useRef(0);
  const doc = useRef(docKey);
  // Where everything was in the last drawing of each view of this document: the next drawing stays
  // close to it, so an edit does not make the picture jump. Null: forgotten on purpose (reset).
  const memory = useRef({ doc: docKey, fresh, views: new Map<string, LayoutMemory | null>() });
  // The editor's theme picker and icon folder (brand.ts) apply to the live drawing too.
  const { theme: themeOverride, icons } = useBrand();
  useEffect(() => {
    const n = ++seq.current;
    const t = performance.now();
    const m = memory.current;
    if (m.doc !== docKey) {
      m.doc = docKey;
      m.views.clear();
    }
    // A neighbourhood is a drawing of its own: it does not start from where things stood in the whole.
    const lens = focus === undefined ? '' : `\n${JSON.stringify((focus as { on?: unknown } | null)?.on ?? null)}`;
    if (m.fresh !== fresh) {
      m.fresh = fresh;
      m.views.set((view ?? '') + lens, null);
    }
    // Nothing remembered yet (a file just opened): the note in its sidecar says where things were.
    render(text, { theme, themeOverride, icons, sidecar, load, view, file, step, fonts: 'none', interactive: true, idPrefix: 'live', previous: m.views.get((view ?? '') + lens), ...(focus !== undefined ? { focus } : {}) })
      .then(async (result) => {
        // The page needs the theme's faces before the drawing shows (Transit and Drafting bring their own).
        await registerThemeFonts(result.theme);
        if (n !== seq.current) return;
        if (result.placed?.memory && m.doc === docKey) for (const key of new Set([view ?? '', result.view ?? ''])) m.views.set(key + lens, result.placed.memory);
        // Another document starts without the old drawing behind it.
        const same = doc.current === docKey;
        doc.current = docKey;
        setOut((prev) => ({ result, drawn: result.svg ? result : same ? prev?.drawn : undefined, ms: Math.round(performance.now() - t), text, docKey }));
      })
      .catch((e: unknown) => {
        console.error('render failed', e);
        if (n === seq.current)
          setOut((prev) => ({
            result: { diagnostics: [{ severity: 'error', message: `Render failed: ${e instanceof Error ? e.message : String(e)}` }] },
            drawn: prev?.drawn,
            ms: 0,
            text,
            docKey,
          }));
      });
  }, [text, theme, themeOverride, icons, sidecar, load, docKey, view, file, step, fresh, focus]);
  return out;
}
