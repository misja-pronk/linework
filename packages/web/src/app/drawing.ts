// The drawing of the text: rendered a moment after typing stops (longer for slow diagrams), with the
// pins of a drag on top while it lasts, and what the rest of the app reads from it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { viewPins, withViewPins, type Diagnostic, type EdgeOverride, type LayoutSidecar, type Point } from '@cartography/core';
import { useRender } from '../use-render.ts';
import { entryRanges } from '../ranges.ts';
import type { LayersOptions } from '../layers-control.tsx';

const NONE: Diagnostic[] = [];

/** Debounced value that passes straight through when `key` changes (another document). */
function useDebounced<T>(value: T, ms: number, key: unknown): T {
  const [state, setState] = useState({ value, key });
  if (state.key !== key) setState({ value, key });
  useEffect(() => {
    if (Object.is(state.value, value)) return;
    const t = setTimeout(() => setState({ value, key }), ms);
    return () => clearTimeout(t);
  }, [value, key, ms, state.value]);
  return state.key === key ? state.value : value;
}

export type Draft = { nodes?: Record<string, Point>; groups?: Record<string, Point>; edges?: Record<string, EdgeOverride> };

interface Props {
  text: string;
  theme: 'light' | 'dark';
  pins: LayoutSidecar | undefined;
  load: ((f: string) => string) | undefined;
  docKey: number;
  viewName: string | undefined;
  docFile: string | undefined;
  stepNo: number | undefined;
  focusAsked: unknown;
  lenses: LayersOptions | undefined;
}

export function useDrawing({ text, theme, pins, load, docKey, viewName, docFile, stepNo, focusAsked, lenses }: Props) {
  /** A node being dragged: its pin before it is committed to the history. */
  const [draft, setDraft] = useState<Draft>();
  const drawnView = useRef<string>(undefined);
  const sidecar = useMemo<LayoutSidecar | undefined>(() => {
    if (!draft) return pins;
    const v = viewPins(pins, drawnView.current);
    return withViewPins(pins, drawnView.current, { ...v, version: 1, nodes: { ...(v?.nodes ?? {}), ...draft.nodes }, groups: { ...(v?.groups ?? {}), ...draft.groups }, edges: { ...(v?.edges ?? {}), ...draft.edges } });
  }, [pins, draft]);
  // Slow (big) diagrams wait a little longer between keystrokes, so typing stays smooth.
  const [renderMs, setRenderMs] = useState(0);
  /** Counts layout resets: the drawing remembers where things were until one (use-render.ts). */
  const [fresh, setFresh] = useState(0);
  const rendered = useRender(useDebounced(text, Math.min(400, Math.max(40, renderMs * 1.5)), docKey), theme, sidecar, load, docKey, viewName, docFile, stepNo, fresh, focusAsked, lenses);
  useEffect(() => {
    if (rendered) setRenderMs(rendered.ms);
  }, [rendered]);
  const result = rendered?.result;
  const drawn = rendered?.drawn;
  drawnView.current = drawn?.view;
  const vpins = viewPins(pins, drawn?.view);
  /** How the drawing on screen was made and where things are before pins (stay.ts in the layout package). */
  const drawnLayout = drawn?.placed?.memory;
  // Positions go into the sidecar once asked for (carto render --stable wrote them), and when the
  // drawing was kept from an earlier one: the variant alone would not draw it again.
  const tracked = vpins?.layout?.at !== undefined;
  const locked = useMemo(() => new Set(vpins?.locked ?? []), [vpins?.locked]);
  const bent = useMemo(() => new Set(Object.keys(vpins?.edges ?? {})), [vpins?.edges]);
  const pinnedIds = useMemo(() => new Set([...Object.keys(vpins?.nodes ?? {}), ...Object.keys(vpins?.groups ?? {})]), [vpins?.nodes, vpins?.groups]);
  const type = result?.type ?? drawn?.type;
  const diagnostics = result?.diagnostics ?? NONE;
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const entries = useMemo(() => entryRanges(rendered?.text ?? '', result?.graph), [rendered?.text, result?.graph]);
  /** The drawing is of the text in the editor now (builder actions wait for that). */
  const current = rendered?.text === text;
  const pinCount = Object.keys(vpins?.nodes ?? {}).length + Object.keys(vpins?.groups ?? {}).length;
  return { draft, setDraft, sidecar, setFresh, rendered, result, drawn, vpins, drawnLayout, tracked, locked, bent, pinnedIds, type, diagnostics, errors, warnings, entries, current, pinCount };
}
export type Drawing = ReturnType<typeof useDrawing>;
