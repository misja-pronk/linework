// Renders on every change, newest wins: a slow render never overwrites a newer one. The drawing is
// made in a worker (render-client.ts): one that takes long says so, and can be stopped.
import { useEffect, useRef, useState } from 'react';
import type { RenderResult } from '@cartography/engine';
import { Cancelled, draw } from './render-client.ts';
import { viewPins, type LayoutMemory, type LayoutSidecar, type Point } from '@cartography/core';
import { useBrand } from './brand.ts';
import { useIconOptions } from './icon-packs.ts';
import { registerThemeFonts } from './fonts.ts';
import { store } from './store.ts';
import { t } from './i18n/index.ts';
import type { LayersOptions } from './layers-control.tsx';

export interface Rendered {
  result: RenderResult;
  /** The newest render that drew something: kept while the text has errors, so the drawing does not vanish mid-edit. */
  drawn?: RenderResult;
  ms: number;
  text: string;
  /** The document this render belongs to. */
  docKey: number;
}

/** A drawing that is taking a while: since when, of which view; stop() gives it up. */
export interface Busy {
  since: number;
  view?: string;
  stop(): void;
}

/** How long a drawing takes before the editor says it is still at it. */
const BUSY_AFTER_MS = 600;

/**
 * `view` picks one of the diagram's views; `file` is its name, so includes back to it read as a cycle;
 * `step` draws one of its steps. `fresh` counts the times the layout was reset: a new number draws
 * the view from scratch. `focus` cuts the drawing down to a neighbourhood, as `focus:` in the YAML
 * would (null: everything, whatever the YAML says); its caller keeps it the same object between renders.
 */
export function useRender(text: string, theme: 'light' | 'dark', sidecar: LayoutSidecar | undefined, load: ((f: string) => string) | undefined, docKey: number, view?: string, file?: string, step?: number, fresh = 0, focus?: unknown, layers?: LayersOptions & { stage?: string }) {
  const [out, setOut] = useState<Rendered>();
  const [busy, setBusy] = useState<Busy>();
  const seq = useRef(0);
  const doc = useRef(docKey);
  // Where everything was in the last drawing of each view of this document: the next drawing stays
  // close to it, so an edit does not make the picture jump. Null: forgotten on purpose (reset).
  const memory = useRef({ doc: docKey, fresh, views: new Map<string, LayoutMemory | null>() });
  // The editor's theme picker and icon folder (brand.ts) apply to the live drawing too.
  const { theme: themeOverride } = useBrand();
  const icons = useIconOptions();
  /** Whether this document has drawn something since it opened. */
  const hasDrawn = useRef<number>(-1);
  // The nodes pinned in the last drawing of each view, and where each stood before its pin moved it
  // (its centre in the remembered drawing). A pin taken away (⌘Z after a drag, Unpin) puts the node
  // back there: the remembered drawing has it where the pin held it, and would keep it there.
  const pinned = useRef(new Map<string, Set<string>>());
  const before = useRef(new Map<string, Point>());
  // The drawings of the texts drawn lately (with their pins): one drawn again (⌘Z, ⌘⇧Z) starts from
  // how it was drawn then, so an undo gives the picture back as it was, not a rearranged one.
  const seen = useRef(new Map<string, LayoutMemory>());
  /** What the drawing on screen was drawn from: asked for again (a view given up on, Stop), it is not drawn again. */
  const done = useRef<unknown[]>(undefined);
  useEffect(() => {
    const n = ++seq.current;
    const asked = [text, theme, themeOverride, icons, sidecar, load, docKey, view, file, step, fresh, focus, layers];
    if (done.current?.length === asked.length && asked.every((x, i) => Object.is(x, done.current![i]))) return setBusy(undefined);
    const t0 = performance.now();
    const m = memory.current;
    if (m.doc !== docKey) {
      m.doc = docKey;
      m.views.clear();
      pinned.current.clear();
      before.current.clear();
      seen.current.clear();
    }
    // A neighbourhood is a drawing of its own: it does not start from where things stood in the whole.
    // So is a drawing of only some layers (a faded one keeps the whole drawing's places).
    // A canvas's whole drawing (view '') is not its first view (no view): each remembers its own.
    const slot = view === '' ? '\0whole' : (view ?? '');
    const lens = (focus === undefined ? '' : `\n${JSON.stringify((focus as { on?: unknown } | null)?.on ?? null)}`) + (layers?.layers?.length && layers.layerMode !== 'dim' ? `\n@${layers.layers.join('+')}` : '');
    if (m.fresh !== fresh) {
      m.fresh = fresh;
      m.views.set(slot + lens, null);
      // Laid out afresh on purpose: no text drawn before comes back as it was drawn then.
      seen.current.clear();
    }
    const key = slot + lens;
    const exact = `${key}\n${step ?? ''}\n${JSON.stringify(viewPins(sidecar, view) ?? null)}\n${text}`;
    const previous = seen.current.get(exact) ?? unpinned(m.views.get(key), key, new Set(Object.keys(viewPins(sidecar, view)?.nodes ?? {})), pinned.current, before.current);
    // Nothing remembered yet (a file just opened): the note in its sidecar says where things were.
    const job = draw(text, { theme, themeOverride, ...icons, sidecar, load, view, file, step, fonts: 'none', interactive: true, idPrefix: 'live', previous, ...(focus !== undefined ? { focus } : {}), ...layers });
    let again: ReturnType<typeof draw> | undefined;
    const since = Date.now();
    const busyNow: Busy = { since, view, stop: () => (job.cancel(true), again?.cancel(true), setBusy(undefined)) };
    // Still saying a drawing is under way (a view picked while the last one lays out): it is this one now.
    setBusy((b) => (b ? busyNow : b));
    const slow = setTimeout(() => setBusy(busyNow), BUSY_AFTER_MS);
    job.result
      .then(async (result) => {
        // The page needs the theme's faces before the drawing shows (Transit and Drafting bring their own).
        await registerThemeFonts(result.theme);
        if (n !== seq.current) return;
        if (result.placed?.memory && m.doc === docKey) {
          for (const key of new Set([slot, result.view ?? slot])) m.views.set(key + lens, result.placed.memory);
          const s = seen.current;
          s.delete(exact);
          s.set(exact, result.placed.memory);
          if (s.size > 40) s.delete(s.keys().next().value!);
        }
        // Another document starts without the old drawing behind it.
        const same = doc.current === docKey;
        doc.current = docKey;
        // The last text that drew, kept per file: a document that opens with errors (after a reload, on a
        // phone) still shows its last good drawing, greyed, instead of nothing.
        if (result.svg) {
          hasDrawn.current = docKey;
          store.set('lastGood', { file: file ?? '', text });
        }
        let fallback: RenderResult | undefined;
        const good = !result.svg && hasDrawn.current !== docKey ? store.get<{ file: string; text: string }>('lastGood') : undefined;
        if (good && file && good.file === file && good.text !== text) {
          again = draw(good.text, { theme, themeOverride, ...icons, sidecar, load, view, file, fonts: 'none', interactive: true, idPrefix: 'live' });
          fallback = await again.result.catch(() => undefined);
          if (n !== seq.current) return;
          if (!fallback?.svg) fallback = undefined;
        }
        done.current = asked;
        setOut((prev) => ({ result, drawn: result.svg ? result : same && prev?.drawn ? prev.drawn : fallback, ms: Math.round(performance.now() - t0), text, docKey }));
      })
      .catch((e: unknown) => {
        // Given up on: a newer drawing, or stopped on purpose.
        if (e instanceof Cancelled) return;
        console.error('render failed', e);
        if (n === seq.current)
          setOut((prev) => ({
            result: { diagnostics: [{ severity: 'error', message: t('Render failed: {error}', { error: e instanceof Error ? e.message : String(e) }) }] },
            drawn: prev?.drawn,
            ms: 0,
            text,
            docKey,
          }));
      })
      .finally(() => {
        clearTimeout(slow);
        if (n === seq.current) setBusy(undefined);
      });
    return () => {
      clearTimeout(slow);
      job.cancel();
      again?.cancel();
    };
  }, [text, theme, themeOverride, icons, sidecar, load, docKey, view, file, step, fresh, focus, layers]);
  return { rendered: out, busy };
}

/**
 * The remembered drawing to start from, with the nodes whose pin has just gone back where they stood
 * before it (or, not known, left out: placed afresh beside their neighbours). Notes the nodes newly
 * pinned, and where they stood, for when their pin goes.
 */
function unpinned(memory: LayoutMemory | null | undefined, key: string, now: Set<string>, pinned: Map<string, Set<string>>, before: Map<string, Point>): LayoutMemory | null | undefined {
  const was = pinned.get(key) ?? new Set<string>();
  pinned.set(key, now);
  for (const id of now) if (!was.has(id) && memory?.nodes?.has(id)) before.set(`${key}\n${id}`, memory.nodes.get(id)!);
  const gone = [...was].filter((id) => !now.has(id));
  if (!gone.length || !memory?.nodes) return memory;
  const nodes = new Map(memory.nodes);
  for (const id of gone) {
    const at = before.get(`${key}\n${id}`);
    before.delete(`${key}\n${id}`);
    if (at) nodes.set(id, at);
    else nodes.delete(id);
  }
  return { ...memory, nodes };
}
