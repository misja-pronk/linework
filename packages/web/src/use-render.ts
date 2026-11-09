// Renders on every change, newest wins: a slow render never overwrites a newer one.
import { useEffect, useRef, useState } from 'react';
import { render, type RenderResult } from '@cartography/engine';
import type { LayoutSidecar } from '@cartography/core';

export interface Rendered {
  result: RenderResult;
  /** The newest render that drew something: kept while the text has errors, so the drawing does not vanish mid-edit. */
  drawn?: RenderResult;
  ms: number;
  text: string;
  /** The document this render belongs to. */
  docKey: number;
}

/** `view` picks one of the diagram's views; `file` is its name, so includes back to it read as a cycle. */
export function useRender(text: string, theme: 'light' | 'dark', sidecar: LayoutSidecar | undefined, load: ((f: string) => string) | undefined, docKey: number, view?: string, file?: string) {
  const [out, setOut] = useState<Rendered>();
  const seq = useRef(0);
  const doc = useRef(docKey);
  useEffect(() => {
    const n = ++seq.current;
    const t = performance.now();
    render(text, { theme, sidecar, load, view, file, fonts: 'none', interactive: true, idPrefix: 'live' })
      .then((result) => {
        if (n !== seq.current) return;
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
  }, [text, theme, sidecar, load, docKey, view, file]);
  return out;
}
