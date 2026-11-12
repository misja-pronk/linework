// Moving through one diagram without changing it: its views (V), a focus on part of it (F), its steps
// ([ ], S) and presenting them (P), and links to other views and diagrams.
import { useEffect, useState } from 'react';
import type { Link } from '@cartography/core';
import { t } from '../i18n/index.ts';
import { linkTarget } from '../links.ts';
import { exampleLoader, starters, type Starter } from '../library.ts';
import { hopsBy, nextDirection, type Focus } from '../focus-chip.tsx';
import { addStep, stepsPath } from '../steps-edit.ts';
import { folderLoader, readSidecar, type Workspace } from '../files.ts';
import { setField } from '../builder.ts';
import type { PresentDoc } from '../present.tsx';
import type { Selection } from '../preview.tsx';
import type { Doc } from './document.ts';
import type { Drawing } from './drawing.ts';
import type { Notify } from './toasts.tsx';

export type FocusAsk = { on: string[]; hops: number | 'all'; direction: Focus['direction'] } | null;

/** What is looked at, per document: the view picked, the step shown, a focus set here; and presenting. */
export function useNavigationState(docId: string) {
  // Views: the one asked for (per document) and the one drawn (a diagram of only views draws its first).
  // Pins live per view in the sidecar; everything below works on the drawn view's pins.
  const [picked, setPicked] = useState<{ doc: string; name?: string }>();
  const viewName = picked?.doc === docId ? picked.name : undefined;
  // Steps: the one looked at while editing (per document and view), and presenting full screen.
  const [stepAt, setStepAt] = useState<{ doc: string; view?: string; n: number }>();
  const stepNo = stepAt && stepAt.doc === docId && stepAt.view === viewName ? stepAt.n : undefined;
  const [presenting, setPresenting] = useState(false);
  // A focus set here (F) on top of what the YAML says, per document and view: null shows everything although the YAML has one.
  const [lens, setLens] = useState<{ doc: string; view?: string; focus: FocusAsk }>();
  const focusAsked = lens && lens.doc === docId && lens.view === viewName ? lens.focus : undefined;
  /** A step just made from the selection: the strip asks for its name. */
  const [naming, setNaming] = useState<number>();
  return { docId, picked, setPicked, viewName, setStepAt, stepNo, presenting, setPresenting, setLens, focusAsked, naming, setNaming };
}
export type NavigationState = ReturnType<typeof useNavigationState>;

interface Props {
  state: NavigationState;
  drawing: Drawing;
  text: string;
  textNow(): string;
  ws: Workspace | undefined;
  doc: Doc;
  here: string | undefined;
  selection: Selection[];
  notify: Notify;
  /** A text edit as one undo step. */
  apply(next: string | undefined): void;
  ready(): boolean;
  undo(): void;
  nodeName(id: string): string;
  openInFolder(w: Workspace, path: string): Promise<boolean>;
  pick(s: Starter): Promise<void>;
  dropModal(): void;
}

export function useNavigation(p: Props) {
  const { state: s, drawing, text, textNow, ws, doc, here, selection, notify } = p;
  const { drawn, result, rendered, type } = drawing;
  const { docId, viewName, setPicked, focusAsked, setLens, setStepAt } = s;

  // ------------------------------------------------------------ links

  /** Follows a link: a URL in a new tab, another view here, or another diagram (and view) next to this one. */
  const follow = (link: Link) => {
    const to = linkTarget(link, here);
    if (to.kind === 'url') return void window.open(to.url, '_blank', 'noopener');
    if (to.kind === 'none') return notify(to.why, { tone: 'error' });
    if (to.kind === 'view') return setPicked({ doc: docId, name: to.view });
    if (ws && doc.path) {
      if (!ws.files.has(to.path)) return notify(t('There is no {path} in {folder}', { path: to.path, folder: ws.name }), { tone: 'error' });
      setPicked({ doc: to.path, name: to.view });
      return void p.openInFolder(ws, to.path);
    }
    const st = starters.find((x) => x.id === `example:${to.path}`);
    if (!st) return notify(t('There is no example {path}', { path: to.path }), { tone: 'error' });
    setPicked({ doc: st.id, name: to.view });
    void p.pick(st);
  };

  // ------------------------------------------------------------ views

  /** The views to pick from, in the picker's order: as written first where there is such a drawing. */
  const viewList = (): (string | undefined)[] => (drawn?.views?.length ? [...(drawn.onlyViews ? [] : [undefined]), ...drawn.views.map((v) => v.name)] : []);
  const viewTitle = (name?: string) => (name === undefined ? t('as written') : (drawn?.views?.find((v) => v.name === name)?.title ?? name));
  const showView = (name: string | undefined) => {
    setPicked({ doc: docId, name });
    notify(t('View: {view}', { view: viewTitle(name) }));
  };
  /**
   * V: the next view of the diagram; the YAML stays as it is. Views the type draws itself (data products
   * overview and detailed per domain or product) go round without "as written", which is one of them: the one in `view:`.
   */
  /** Only views the type draws itself (no model `views:`, nothing included): as written is one of them. */
  const ownViews = !!type?.views && !!drawn?.views?.length && !drawn.onlyViews && !/^(views|include):/m.test(textNow());
  /** The view drawn: one picked, else for a type with views of its own the one in its `view:` (or its first). */
  const viewNow = () => viewName ?? (ownViews ? (drawn!.asWritten ?? drawn!.views![0]!).name : undefined);
  const nextView = () => {
    const list = ownViews ? viewList().slice(1) : viewList();
    if (list.length < 2) return notify(t('This diagram has one view'));
    const now = viewNow();
    showView(list[(list.indexOf(now) + 1) % list.length]);
  };
  /** A view the type draws itself (data products overview or detailed) written as the diagram's `view:`. */
  const ownView = !!viewName && !!type?.views && !!(type.schema as { properties?: Record<string, unknown> }).properties?.view && drawn?.view === viewName;
  const keepView = () => {
    if (!type || !viewName) return;
    p.apply(setField(textNow(), type, [], 'view', viewName));
    setPicked(undefined);
  };

  // ------------------------------------------------------------ focus

  /** A focus is drawn, or one of the YAML is switched off: there is a way back. */
  const focusOn = focusAsked !== undefined || !!drawn?.focus?.written;
  const setFocus = (focus: FocusAsk | undefined) => setLens(focus === undefined ? undefined : { doc: docId, view: viewName, focus });
  /** Esc: out of a focus set here; a focus the YAML has is switched off, and on again. */
  const leaveFocus = () => setFocus(focusAsked !== undefined ? undefined : drawn?.focus?.written ? null : undefined);
  /** F: the drawing cut down to the selection and what is around it. In a focus, that walks on to a neighbour. */
  const focusOnSelection = () => {
    const g = drawn?.graph;
    if (!g) return;
    if (!selection.length) return focusOn ? leaveFocus() : notify(t('Select what to focus on, then press F'));
    const ends = (id: string) => g.edges.filter((e) => e.id === id).flatMap((e) => [e.from.node, e.to.node]);
    const on = [...new Set(selection.flatMap((x) => (x.kind === 'edge' ? ends(x.id) : [x.id])))];
    if (!on.length) return;
    const now = drawn?.focus;
    setFocus({ on, hops: !now ? 1 : now.hops === Infinity ? 'all' : now.hops, direction: now?.direction ?? 'both' });
  };
  const refocus = (change: (now: Focus) => Partial<Pick<Focus, 'hops' | 'direction'>>) => {
    const now = drawn?.focus;
    if (!now) return notify(t('No focus yet: select something and press F'));
    const next = { hops: now.hops, direction: now.direction, ...change(now) };
    setFocus({ on: now.on, hops: next.hops === Infinity ? 'all' : next.hops, direction: next.direction });
  };
  const focusHops = (by: 1 | -1) => refocus((now) => ({ hops: hopsBy(now.hops, by) }));
  const focusDirection = () => refocus((now) => ({ direction: nextDirection(now.direction) }));
  // A drawing that is one shape (a sequence, a roadmap) has nothing to walk from: say so and stay on the whole.
  useEffect(() => {
    if (!focusAsked || !result?.svg || result.focus || rendered?.text !== text) return;
    const why = result.diagnostics.find((d) => d.message.startsWith('Focus'));
    setLens(undefined);
    notify(why ? why.message.replace(/^Focus: /, '') : t('Nothing to focus on there'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per drawing: the answer to the focus asked
  }, [result]);

  // ------------------------------------------------------------ steps and presenting

  const stepList = drawn?.steps ?? [];
  /** Steps somebody wrote: PowerPoint and PDF get a slide or page for each. */
  const written = stepList.length > 0 && !drawn?.stepsImplied;
  const pickStep = (n: number | undefined) => setStepAt(n ? { doc: docId, view: viewName, n } : undefined);
  /** [ and ]: through the steps, and past the last one back to the whole drawing. */
  const stepBy = (dir: 1 | -1) => {
    if (!stepList.length) return notify(t('No steps yet: select what a step is about and press S'));
    pickStep(((drawn?.step ?? 0) + dir + stepList.length + 1) % (stepList.length + 1) || undefined);
  };
  /** A step edit as one undo step; without text the YAML could not take it. */
  const editSteps = (next: string | undefined, show?: number) => {
    if (next == null) return notify(drawn?.view ? t('The steps of {view} are not written in this file, or its YAML has problems: change them there', { view: drawn.view }) : t('That change did not work on these steps: make it in the YAML'), { tone: 'error' });
    p.apply(next);
    if (show) pickStep(show);
  };
  /** S: a new step after the one shown, with the selection as its focus. */
  const addStepFromSelection = () => {
    const g = drawn?.graph;
    if (!p.ready() || !g) return;
    if (drawn?.stepsImplied) return notify(g.steps?.length ? t('This view is told by its numbered lines already') : t('A sequence diagram is told message by message already'));
    const edgeOf = (id: string) => g.edges.find((e) => e.id === id);
    const focus = selection.flatMap((x) => (x.kind !== 'edge' ? [x.id] : edgeOf(x.id) ? [`${edgeOf(x.id)!.from.node} -> ${edgeOf(x.id)!.to.node}`] : []));
    const names = selection.map((x) => (x.kind === 'node' ? p.nodeName(x.id) : x.kind === 'group' ? (g.groups.find((y) => y.id === x.id)?.label ?? x.id) : edgeOf(x.id) ? `${p.nodeName(edgeOf(x.id)!.from.node)} to ${p.nodeName(edgeOf(x.id)!.to.node)}` : x.id));
    const n = (drawn?.step ?? stepList.length) + 1;
    const next = addStep(textNow(), stepsPath(drawn?.view), { title: names.length === 1 ? names[0]! : names.length === 2 ? names.join(' and ') : `Step ${n}`, focus }, drawn?.step);
    editSteps(next, n);
    if (next) {
      s.setNaming(n);
      notify(t('Step {n} added: {what}', { n, what: names.length === 1 ? names[0]! : names.length === 2 ? t('{a} and {b}', { a: names[0]!, b: names[1]! }) : t('{count} elements stand out', { count: names.length }) }), { action: { label: t('Undo'), run: p.undo } });
    }
  };
  const present = () => {
    if (!drawn?.svg) return notify(t('Nothing to present yet: fix the problems in the YAML first'), { tone: 'error' });
    p.dropModal();
    s.setPresenting(true);
  };
  /** Another diagram for a link followed while presenting: from the open folder, or the bundled examples. */
  const presentOther = (path: string): PresentDoc | undefined => {
    const file = path.split('/').pop();
    if (ws && doc.path) {
      const hit = ws.files.get(path);
      return hit && { text: hit.text, path, file, sidecar: readSidecar(ws, path), load: folderLoader(ws, path) };
    }
    const st = starters.find((x) => x.id === `example:${path}`);
    return st && { text: st.text, path, file, load: exampleLoader(st.id) };
  };

  return { follow, viewList, viewTitle, showView, viewNow, nextView, ownView, keepView, focusOn, leaveFocus, focusOnSelection, focusHops, focusDirection, stepList, written, pickStep, stepBy, editSteps, addStepFromSelection, present, presentOther };
}
export type Navigation = ReturnType<typeof useNavigation>;
