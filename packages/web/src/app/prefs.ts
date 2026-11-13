// What people set once and the editor keeps between visits: the theme, the way of working, the pane
// sizes and folds, the first-visit hint, SVG for Office. Each is remembered in the store as it changes.
import { useEffect, useMemo, useState } from 'react';
import type { View } from '../start.tsx';
import { store } from '../store.ts';

export type ThemePref = 'system' | 'light' | 'dark';

/** How many visits show the first-visit hint before it has done its job (as the sketch hint does sessions). */
export const HINT_VISITS = 3;
/** This visit's number, counted once when the editor loads. */
const VISIT = (store.get<number>('visits') ?? 0) + 1;
store.set('visits', VISIT);

function useSystemDark() {
  const q = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(q.matches);
  useEffect(() => {
    const on = () => setDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  return dark;
}

/** The window's width, for sharing it out between the panes (pane-layout.ts). */
export function useWindowWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function usePrefs() {
  const [safeSvg, setSafeSvg] = useState(() => store.get<boolean>('svg-safe') ?? false);
  const toggleSafeSvg = () =>
    setSafeSvg((on) => {
      store.set('svg-safe', !on);
      return !on;
    });
  const [pref, setPref] = useState<ThemePref>(store.get('theme') ?? 'system');
  const systemDark = useSystemDark();
  const theme: 'light' | 'dark' = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  /** Building visually (drawing and shapes) or writing YAML (editor and drawing side by side). */
  // A first visit shows the builder: the friendliest way in.
  const [view, setViewState] = useState<View>(() => store.get<View>('view') ?? (store.get('started') ? 'code' : 'visual'));
  const setView = (v: View) => {
    setViewState(v);
    store.set('view', v);
  };
  /** The first-visit hint, in the first few visits only, until it is dismissed once. */
  const [hint, setHint] = useState(() => !store.get('hinted') && VISIT <= HINT_VISITS);
  const dismissHint = () => {
    setHint(false);
    store.set('hinted', true);
  };
  /** The hint has done its job once something is built. */
  const acted = () => hint && dismissHint();
  /** Something else done (a view, a step, presenting, an export): the hint goes for this visit. */
  const hideHint = () => setHint(false);
  const [split, setSplit] = useState(() => Math.min(0.7, Math.max(0.2, Number(store.get('split')) || 0.4)));
  /** The file list and the YAML as people left them: open, or folded to a rail (pane-layout.ts). */
  const [filesPref, setFilesPrefState] = useState<'list' | 'rail'>(() => (store.get('files') === 'rail' ? 'rail' : 'list'));
  const setFilesPref = (v: 'list' | 'rail') => (setFilesPrefState(v), store.set('files', v));
  /** The builder's outline as people left it (pane-layout.ts): unset, it folds in a narrow window. */
  const [outlinePref, setOutlinePrefState] = useState<'open' | 'rail' | undefined>(() => store.get<'open' | 'rail'>('outline') ?? undefined);
  const setOutlinePref = (v: 'open' | 'rail') => (setOutlinePrefState(v), store.set('outline', v));
  // The YAML stays out of sight until it is opened: folded to its rail unless people left it open.
  const [yamlFolded, setYamlFoldedState] = useState(() => store.get<boolean>('yaml-folded') !== false);
  const setYamlFolded = (v: boolean) => (setYamlFoldedState(v), store.set('yaml-folded', v), setForceYaml(false));
  /** The YAML opened from its rail although there is no room: it stays open until folded again. */
  const [forceYaml, setForceYaml] = useState(false);
  const windowWidth = useWindowWidth();
  /** The YAML tab: the YAML beside the drawing, open even when the window is narrow (asked for on purpose). */
  const showYaml = () => (setView('code'), setYamlFolded(false), setForceYaml(true));
  /** The Drawing tab: the YAML folds to its rail (the builder's shapes stay where they are). */
  const showDrawing = () => view === 'code' && setYamlFolded(true);
  /** A way of working asked for (⌘\\, a command, the start dialog's YAML): the YAML way shows the YAML. */
  const openView = (v: View) => (v === 'code' ? showYaml() : setView(v));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => store.set('theme', pref), [pref]);
  useEffect(() => store.set('split', split), [split]);

  return { safeSvg, toggleSafeSvg, pref, setPref, theme, view, setView, hint, dismissHint, acted, hideHint, split, setSplit, filesPref, setFilesPref, outlinePref, setOutlinePref, yamlFolded, setYamlFolded, forceYaml, setForceYaml, showYaml, showDrawing, openView, windowWidth };
}
export type Prefs = ReturnType<typeof usePrefs>;
