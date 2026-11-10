// "Trace a request" in the editor (docs/trace.md): two elements selected, or one and "until it ends",
// or the drawing's steps → the request as a sequence diagram, previewed with its other routes, then
// opened as a new document or added to the model as a dynamic view. A traced sequence leads back:
// "Show … in the source" for each participant, and the source lists the traces made of it.
import { useMemo, useState, type ReactNode } from 'react';
import { parseDocument } from 'yaml';
import { joinPath, parseSource, type WorkspaceIndex } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { dynamicView, traceableGraph, traceAsk, viewName, type TraceAsk, type Traceable, type TraceMeta } from '@cartography/trace';
import { Palette, type Command } from '../palette.tsx';
import { Icon } from '../icon.tsx';
import { printPreserving } from '../yaml-print.ts';
import type { Workspace } from '../files.ts';
import type { Place } from '../workspace/use-workspace.ts';
import { TraceDialog } from './trace-dialog.tsx';
import './trace.css';

type Sel = { kind: 'node' | 'group' | 'edge'; id: string };

export interface TraceHost {
  ws?: Workspace;
  /** The open document: its path in the folder, or its name. */
  file: string;
  inFolder: boolean;
  text: string;
  drawn?: RenderResult;
  /** The drawing is of the text in the editor. */
  current: boolean;
  selection: Sel[];
  theme: 'light' | 'dark';
  index: WorkspaceIndex;
  /** Opens text as a new document, not saved yet (⌘S writes it into the folder at `path`). */
  openNew(text: string, name: string, path?: string): void;
  /** Replaces the open document's text, one undo step, and shows a view of it. */
  replace(text: string, view?: string): void;
  go(p: Place): void;
  notify(message: string, o?: { tone?: 'error' }): void;
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const dirOf = (file: string) => file.split('/').slice(0, -1).join('/');
const baseName = (file: string) => file.split('/').pop()!;

/** Where a traced sequence came from, and its participants that point back. */
function tracedFrom(text: string): { file: string; view?: string; refs: { id: string; label: string; ref: string }[] } | undefined {
  const data = parseSource(text).data;
  if (!isMap(data) || data.type !== 'sequence' || !isMap(data.traced) || typeof data.traced.file !== 'string') return undefined;
  const refs = Object.entries(isMap(data.participants) ? data.participants : {}).flatMap(([id, p]) =>
    isMap(p) && typeof p.ref === 'string' ? [{ id, label: typeof p.label === 'string' ? p.label : id, ref: p.ref }] : [],
  );
  return { file: data.traced.file, ...(typeof data.traced.view === 'string' ? { view: data.traced.view } : {}), refs };
}

export function useTrace(h: TraceHost) {
  const [asking, setAsking] = useState<TraceAsk>();
  const [choosing, setChoosing] = useState<string>();
  const graph = h.current ? h.drawn?.graph : undefined;
  const t: Traceable | undefined = useMemo(() => (graph ? traceableGraph(graph, h.text, h.drawn?.view) : undefined), [graph, h.text, h.drawn?.view]);
  const traced = useMemo(() => tracedFrom(h.text), [h.text]);
  const name = (id: string) => t?.graph.elements.get(id)?.label ?? id;
  // Elements that can start or end a request: what is drawn, the lines' ends included.
  const ends = (h.selection.filter((s) => s.kind !== 'edge' && t?.graph.elements.has(s.id)) ?? []).map((s) => s.id);

  const start = (ask: TraceAsk) => {
    if (!t) return h.notify('Wait for the drawing, then trace', { tone: 'error' });
    const r = traceAsk(t, ask);
    if (r.error) return h.notify(r.error, { tone: 'error' });
    setAsking(ask);
  };

  /** The traced file as the new sequence names it: next to it, by its name. */
  const target = (r: { mode: TraceMeta['mode']; from?: string; to?: string }) => {
    const stem = viewName({ mode: r.mode, from: r.from, to: r.to });
    const dir = h.inFolder ? dirOf(h.file) : '';
    let path = joinPath(dir, `${stem}.yaml`);
    for (let i = 2; h.ws?.files.has(path); i++) path = joinPath(dir, `${stem}-${i}.yaml`);
    return { path, name: baseName(path) };
  };

  const traces = useMemo(() => {
    if (!h.ws || !h.inFolder) return [];
    return [...h.ws.files].flatMap(([p, f]) => {
      if (!/^type:\s*sequence\s*$/m.test(f.text) || !f.text.includes('traced:')) return [];
      const from = tracedFrom(f.text);
      return from && joinPath(dirOf(p), from.file) === h.file ? [p] : [];
    });
  }, [h.ws, h.inFolder, h.file]);

  /** Back to the element a participant stands for, in the drawing it was traced from. */
  const showInSource = (ref: string) => {
    if (!traced) return;
    const file = h.inFolder ? joinPath(dirOf(h.file), traced.file) : traced.file;
    if (!h.ws?.files.has(file)) return h.notify(`${file} is not open here: open its folder to go there`, { tone: 'error' });
    // A trace of a whole model: the view of that file that draws the element, if one does.
    const shown = traced.view ?? [...h.index.shows].find(([k, m]) => k.startsWith(`${file}#`) && m.has(ref))?.[0].split('#')[1];
    h.go({ file, ...(shown ? { view: shown } : {}), node: ref });
  };

  const commands: Command[] = [
    ...(ends.length === 2
      ? [
          { id: 'trace-ab', group: 'Trace', label: `Trace a request from ${name(ends[0]!)} to ${name(ends[1]!)}`, hint: 'as a sequence diagram, routes to pick from', icon: 'arrow-left-right', shortcut: '⇧Q', run: () => start({ from: ends[0], to: ends[1] }) },
          { id: 'trace-ba', group: 'Trace', label: `Trace a request from ${name(ends[1]!)} to ${name(ends[0]!)}`, icon: 'arrow-left-right', run: () => start({ from: ends[1], to: ends[0] }) },
        ]
      : ends.length === 1
        ? [
            { id: 'trace-until', group: 'Trace', label: `Trace a request from ${name(ends[0]!)} until it ends`, hint: 'every call followed to a store, an external system or a person', icon: 'arrow-left-right', shortcut: '⇧Q', run: () => start({ from: ends[0] }) },
            { id: 'trace-to', group: 'Trace', label: `Trace a request from ${name(ends[0]!)} to…`, hint: 'pick where it ends', icon: 'arrow-left-right', run: () => setChoosing(ends[0]) },
          ]
        : []),
    ...(t?.steps?.length ? [{ id: 'trace-steps', group: 'Trace', label: t.graph.steps ? 'Trace this dynamic view as a sequence diagram' : 'Trace the steps as a sequence diagram', hint: 'their routes in order, with replies', icon: 'arrow-left-right', run: () => start({ steps: true }) }] : []),
    ...(traced
      ? [
          ...traced.refs.map((p) => ({ id: `trace-src:${p.id}`, group: 'Traced from', label: `Show ${p.label} in ${baseName(traced.file)}`, hint: p.ref, icon: 'map-pin', run: () => showInSource(p.ref) })),
        ]
      : []),
    ...traces.map((p) => ({ id: `trace-of:${p}`, group: 'Traces of this diagram', label: `Open ${p}`, icon: 'arrow-left-right', run: () => h.go({ file: p }) })),
  ];

  /** Context menu: what the commands offer for what was right-clicked. */
  const menuItems = (close: () => void): ReactNode =>
    ends.length && t ? (
      <>
        {ends.length === 2 ? (
          <button role="menuitem" onClick={() => (close(), start({ from: ends[0], to: ends[1] }))}>
            <Icon name="arrow-left-right" /> Trace a request from {name(ends[0]!)} to {name(ends[1]!)}
          </button>
        ) : (
          <>
            <button role="menuitem" onClick={() => (close(), start({ from: ends[0] }))}>
              <Icon name="arrow-left-right" /> Trace a request from {name(ends[0]!)} until it ends
            </button>
            <button role="menuitem" onClick={() => (close(), setChoosing(ends[0]))}>
              <Icon name="arrow-left-right" /> Trace a request from {name(ends[0]!)} to…
            </button>
          </>
        )}
      </>
    ) : null;

  const addView = (d: NonNullable<ReturnType<typeof dynamicView>>) => {
    const doc = parseDocument(h.text);
    let n = d.name;
    for (let i = 2; doc.hasIn(['views', n]); i++) n = `${d.name}-${i}`;
    if (!doc.has('views')) doc.set('views', doc.createNode({}));
    doc.setIn(['views', n], doc.createNode(d.value));
    h.replace(printPreserving(h.text, doc), n);
    setAsking(undefined);
    h.notify(`Added the dynamic view ${n}: ⌘Z takes it out again`);
  };

  const dialog: ReactNode = (
    <>
      {choosing && t && (
        <Palette
          placeholder={`Trace from ${name(choosing)} to…`}
          onClose={() => setChoosing(undefined)}
          commands={[...t.graph.elements.values()]
            .filter((e) => e.id !== choosing)
            .map((e) => ({ id: `to:${e.id}`, group: `From ${name(choosing)} to`, label: e.label, hint: e.id, icon: 'arrow-left-right', run: () => start({ from: choosing, to: e.id }) }))}
        />
      )}
      {asking && t && (
        <TraceDialog
          traceable={t}
          ask={asking}
          theme={h.theme}
          meta={(r, n) => {
            const { path } = target(r);
            const rel = h.inFolder ? relative(dirOf(path), h.file) : baseName(h.file);
            return { file: rel, ...(h.drawn?.view ? { view: h.drawn.view } : {}), mode: r.mode, from: r.from, to: r.to, pick: { n: n + 1, of: r.options.length } };
          }}
          onOpen={(yaml, r) => {
            const { path, name: file } = target(r);
            setAsking(undefined);
            h.openNew(yaml, file, h.inFolder ? path : undefined);
          }}
          onAddView={t.graph.model ? addView : undefined}
          onClose={() => setAsking(undefined)}
        />
      )}
    </>
  );

  /** ⇧Q: trace from the selection (two elements: between them; one: until it ends). */
  const onKey = (e: KeyboardEvent, mod: boolean, typing: boolean): boolean => {
    if (typing || mod || e.altKey || !e.shiftKey || e.key.toLowerCase() !== 'q' || asking || choosing) return false;
    if (!ends.length) return h.notify('Select one element to trace from, or two to trace between (⇧-click the second)'), true;
    start(ends.length === 2 ? { from: ends[0], to: ends[1] } : { from: ends[0] });
    return true;
  };

  return { commands, menuItems, dialog, onKey, open: !!asking || !!choosing };
}

/** `to` as seen from the folder `from`: "../model.yaml". */
function relative(from: string, to: string): string {
  const a = from ? from.split('/') : [];
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
