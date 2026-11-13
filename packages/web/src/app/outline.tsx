// The builder's left panel: the drawing's outline (its groups and what is in them, as a tree that
// selects what it names) or the type's shapes to browse and drag, on two tabs. Adding is the A popup.
import './outline.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Graph, GraphNode, PaletteItem, Tone } from '@cartography/core';
import type { Selection } from '../preview.tsx';
import { AddMenu } from '../add-menu.tsx';
import { Icon } from '../icon.tsx';
import { t } from '../i18n/index.ts';
import { store } from '../store.ts';
import { iconOf, label } from './names.ts';

interface Row {
  key: string;
  /** What it selects; none for the lines' heading. */
  sel?: Selection;
  depth: number;
  label: string;
  icon: string;
  tone?: Tone;
  /** It has rows under it, shown or folded. */
  parent: boolean;
  up?: string;
}

const keyOf = (s: Selection) => `${s.kind}:${s.id}`;

/** A shape that is the whole drawing (a sequence, a matrix, a roadmap) by what it is, not by its id. */
function wholeName(n: GraphNode): string | undefined {
  const k = n.shape.kind;
  return k === 'sequence' ? t('The sequence') : k === 'matrix' ? t('The table') : k === 'roadmap' ? t('The roadmap') : k === 'gitflow' ? t('The branches') : k === 'journey' ? t('The journey') : undefined;
}
const LINES = 'lines';

/** The tree as rows: groups in their parents (groups first, then the elements), the lines last under a heading of their own. */
function outlineRows(g: Graph, nodeName: (id: string) => string): Row[] {
  const groups = new Set(g.groups.map((x) => x.id));
  const under = (parent: string | undefined) => (parent && groups.has(parent) ? parent : undefined);
  const rows: Row[] = [];
  const walk = (parent: string | undefined, depth: number, up: string | undefined) => {
    for (const x of g.groups.filter((x) => under(x.parent) === parent)) {
      const key = keyOf({ kind: 'group', id: x.id });
      const parentOf = g.groups.some((y) => y.parent === x.id) || g.nodes.some((n) => n.parent === x.id && !n.folded);
      rows.push({ key, sel: { kind: 'group', id: x.id }, depth, label: x.label || x.id, icon: x.icon ?? 'square-dashed', tone: x.tone, parent: parentOf, ...(up ? { up } : {}) });
      walk(x.id, depth + 1, key);
    }
    for (const n of g.nodes.filter((n) => !n.folded && under(n.parent) === parent)) {
      const tone = n.shape.kind === 'card' ? n.shape.tone : undefined;
      rows.push({ key: keyOf({ kind: 'node', id: n.id }), sel: { kind: 'node', id: n.id }, depth, label: wholeName(n) ?? label(n), icon: iconOf(n) ?? 'box', ...(tone ? { tone } : {}), parent: false, ...(up ? { up } : {}) });
    }
  };
  walk(undefined, 0, undefined);
  if (g.edges.length) {
    rows.push({ key: LINES, depth: 0, label: t('Lines ({count})', { count: g.edges.length }), icon: 'route', parent: true });
    for (const e of g.edges) {
      const name = `${nodeName(e.from.node)} → ${nodeName(e.to.node)}${e.label ? `: ${e.label}` : ''}`;
      rows.push({ key: keyOf({ kind: 'edge', id: e.id }), sel: { kind: 'edge', id: e.id }, depth: 1, label: name, icon: 'arrow-right', parent: false, up: LINES });
    }
  }
  return rows;
}

interface OutlineProps {
  graph: Graph | undefined;
  selection: Selection[];
  select(s: Selection): void;
  toggle(s: Selection): void;
  nodeName(id: string): string;
  /** Opens the name editor over it in the drawing. */
  rename(s: Selection): void;
  focusDrawing(): void;
  /** The drawing's keys for what is selected (delete, duplicate, copy, paste): prevented when they acted. */
  onKey(e: React.KeyboardEvent): void;
}

/** The drawing as a tree: click or arrow to select, Enter (or Esc) back to the drawing, F2 or a double-click names it. */
export function Outline(p: OutlineProps) {
  // The names come from the same graph: it changing is what changes them.
  const nodeName = useRef(p.nodeName);
  nodeName.current = p.nodeName;
  const rows = useMemo(() => (p.graph ? outlineRows(p.graph, (id) => nodeName.current(id)) : []), [p.graph]);
  /** Folded rows; the lines start folded, they are many and drawn plainly enough. */
  const [folded, setFolded] = useState<Set<string>>(() => new Set([LINES]));
  const [active, setActive] = useState<string>();
  const tree = useRef<HTMLDivElement>(null);
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const hiddenBy = (r: Row): boolean => !!r.up && (folded.has(r.up) || hiddenBy(byKey.get(r.up)!));
  const shown = rows.filter((r) => !hiddenBy(r));
  const chosen = new Set(p.selection.map(keyOf));
  const focusKey = active && shown.some((r) => r.key === active) ? active : shown[0]?.key;
  /** A key handed to the drawing changed it from here: the keyboard stays in the tree, on what is selected next. */
  const keep = useRef(false);
  const inTree = () => !!tree.current?.contains(document.activeElement);

  // Selected elsewhere (the drawing, the YAML): its row is unfolded to and brought into view.
  const one = p.selection.length === 1 ? keyOf(p.selection[0]!) : undefined;
  useEffect(() => {
    const r = one ? byKey.get(one) : undefined;
    if (!r) return;
    setActive(r.key);
    const ups: string[] = [];
    for (let u = r.up; u; u = byKey.get(u)?.up) ups.push(u);
    setFolded((f) => (ups.some((u) => f.has(u)) ? new Set([...f].filter((k) => !ups.includes(k))) : f));
    requestAnimationFrame(() => {
      const el = tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(r.key)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
      if (keep.current || inTree()) el?.focus({ preventScroll: true });
      keep.current = false;
    });
  }, [one]); // eslint-disable-line react-hooks/exhaustive-deps -- on the selection changing only, not on every new drawing

  // Deleted from here: its row has gone, the focus goes to the row in its place.
  useEffect(() => {
    if (!keep.current) return;
    requestAnimationFrame(() => {
      if (!inTree()) tree.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
      keep.current = false;
    });
  }, [rows]);

  const fold = (key: string, on: boolean) => setFolded((f) => (f.has(key) === on ? f : on ? new Set([...f, key]) : new Set([...f].filter((k) => k !== key))));
  const go = (key: string | undefined, choose = true) => {
    if (!key) return;
    setActive(key);
    const r = byKey.get(key);
    if (choose && r?.sel) p.select(r.sel);
    tree.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    // From the row that has the keyboard, which need not be the one selected.
    const from = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key ?? focusKey;
    const i = shown.findIndex((r) => r.key === from);
    const r = shown[i];
    if (!r) return;
    if (e.key === 'ArrowDown') go(shown[i + 1]?.key);
    else if (e.key === 'ArrowUp') go(shown[i - 1]?.key);
    else if (e.key === 'Home') go(shown[0]?.key);
    else if (e.key === 'End') go(shown.at(-1)?.key);
    else if (e.key === 'ArrowRight' && r.parent) {
      if (folded.has(r.key)) fold(r.key, false);
      else go(shown[i + 1]?.key);
    } else if (e.key === 'ArrowLeft') {
      if (r.parent && !folded.has(r.key)) fold(r.key, true);
      else go(r.up);
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (r.sel) p.select(r.sel);
      else fold(r.key, !folded.has(r.key));
      if (e.key === 'Enter' && r.sel) p.focusDrawing();
    } else if (e.key === 'F2' && r.sel && r.sel.kind !== 'edge') p.rename(r.sel);
    else if (e.key === 'Escape') p.focusDrawing();
    else {
      p.onKey(e);
      if (!e.defaultPrevented) return;
      keep.current = true;
      return e.stopPropagation();
    }
    e.preventDefault();
    e.stopPropagation();
  };

  if (!rows.length) return <p className="outline-empty">{t('Nothing drawn yet: press A to add a shape.')}</p>;
  return (
    <div className="outline" role="tree" aria-label={t('Outline')} ref={tree} onKeyDown={onKey}>
      {shown.map((r) => (
        <div
          key={r.key}
          data-key={r.key}
          role="treeitem"
          aria-level={r.depth + 1}
          aria-expanded={r.parent ? !folded.has(r.key) : undefined}
          aria-selected={chosen.has(r.key)}
          tabIndex={r.key === focusKey ? 0 : -1}
          className={!r.sel ? 'outline-row heading' : r.sel.kind === 'group' ? 'outline-row group' : 'outline-row'}
          style={{ ['--depth' as string]: r.depth }}
          onClick={(e) => {
            setActive(r.key);
            if (!r.sel) return fold(r.key, !folded.has(r.key));
            if (e.shiftKey || e.metaKey || e.ctrlKey) p.toggle(r.sel);
            else p.select(r.sel);
          }}
          onDoubleClick={() => r.sel && r.sel.kind !== 'edge' && p.rename(r.sel)}
          title={r.label}
        >
          {r.parent ? (
            <button
              className="outline-fold"
              tabIndex={-1}
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation();
                fold(r.key, !folded.has(r.key));
              }}
            >
              <Icon name="chevron-down" size={12} />
            </button>
          ) : (
            <span className="outline-fold" />
          )}
          <span className={r.tone ? `outline-icon tone-${r.tone}` : 'outline-icon'}>
            <Icon name={r.icon} size={14} />
          </span>
          <span className="outline-label">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

type Tab = 'outline' | 'shapes';
/** The left panel opens on the shapes next time (the YAML rail's Shapes button). */
export const openOnShapes = () => store.set('left-tab', 'shapes' satisfies Tab);

/** The left panel of the builder: the outline by default, the shapes on their tab (remembered). */
export function LeftPanel(p: OutlineProps & { items: PaletteItem[]; onAdd(item: PaletteItem): void; folded: boolean; setFolded(on: boolean): void }) {
  const [tab, setTabState] = useState<Tab>(() => store.get<Tab>('left-tab') ?? 'outline');
  const setTab = (v: Tab) => {
    setTabState(v);
    store.set('left-tab', v);
  };
  // Folded: a strip at the left edge with the panel's two names on it, one click opens it on that tab.
  if (p.folded)
    return (
      <div className="rail left-rail">
        <button className="rail-button" onClick={() => (setTab('outline'), p.setFolded(false))} title={t('What is in the drawing')} aria-label={t('Show the outline')}>
          <Icon name="list-tree" size={16} />
          <span className="rail-label">{t('Outline')}</span>
        </button>
        <button className="rail-button" onClick={() => (setTab('shapes'), p.setFolded(false))} title={t('Every shape, to drag onto the drawing')} aria-label={t('Show the shapes')}>
          <Icon name="boxes" size={16} />
          <span className="rail-label">{t('Shapes')}</span>
        </button>
      </div>
    );
  return (
    <aside className="shapes" aria-label={tab === 'outline' ? t('Outline') : t('Shapes')}>
      <div className="side-tabs left-tabs" role="tablist" aria-label={t('Left panel')}>
        <button role="tab" aria-selected={tab === 'outline'} onClick={() => setTab('outline')} title={t('What is in the drawing')}>
          <Icon name="list-tree" size={14} /> <span className="tab-label">{t('Outline')}</span>
        </button>
        <button role="tab" aria-selected={tab === 'shapes'} onClick={() => setTab('shapes')} title={t('Every shape, to drag onto the drawing')}>
          <Icon name="boxes" size={14} /> <span className="tab-label">{t('Shapes')}</span>
        </button>
        <button className="icon-button small fold-left" onClick={() => p.setFolded(true)} title={t('Fold the panel to the side: more room for the drawing')} aria-label={t('Fold the panel')}>
          <Icon name="panel-left-close" size={14} />
        </button>
      </div>
      {tab === 'outline' ? <Outline {...p} /> : <AddMenu inline items={p.items} onAdd={p.onAdd} onClose={p.focusDrawing} />}
    </aside>
  );
}
