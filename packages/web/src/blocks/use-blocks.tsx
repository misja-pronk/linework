// Blocks in the editor (docs/blocks.md): the Blocks section of the shapes panel, B to insert one from
// the keyboard, ⇧B to save the selection as one, a drop onto the drawing or into a group, and
// "Update instances" when a block has changed since it was inserted. Everything goes in as plain
// YAML, one undo step per insert or update.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { parse } from 'yaml';
import type { DiagramType, Path, Point } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { findInstances, gather, insertBlock, outdated, updateInstance, type Block, type Selected } from '@cartography/blocks';
import { Palette, type Command } from '../palette.tsx';
import { Icon } from '../icon.tsx';
import { is, keyHint } from '../keys.ts';
import type { Workspace } from '../files.ts';
import { pinsOf, useBlockLibrary, useBlockThumbs } from './library.ts';
import { BlocksPanel, blockSearch } from './blocks-panel.tsx';
import { InsertDialog, SaveDialog, UpdateDialog, type SaveRequest, type UpdatePlan } from './dialogs.tsx';
import './blocks.css';

type Sel = { kind: 'node' | 'group' | 'edge'; id: string };
type Into = { collection: string; id: string };

export interface BlocksHost {
  ws?: Workspace;
  refresh(w: Workspace): void;
  inFolder: boolean;
  type?: DiagramType;
  /** The text drawn, and the editor's text right now. */
  text: string;
  textNow(): string;
  drawn?: RenderResult;
  current: boolean;
  selection: Sel[];
  pathOf(s: Sel): Path | undefined;
  theme: 'light' | 'dark';
  /** One undo step: the text, and nodes pinned where they go (pin coordinates). */
  apply(text: string, pins?: Record<string, Point>): void;
  /** Select these entries once they are drawn. */
  selectPaths(paths: Path[]): void;
  notify(message: string, o?: { tone?: 'error'; action?: { label: string; run(): void } }): void;
}

export function useBlocks(h: BlocksHost) {
  const lib = useBlockLibrary(h.ws, h.refresh);
  const typeId = h.type?.id ?? '';
  const forType = useMemo(() => lib.listed.filter((l) => l.block?.type === typeId), [lib.listed, typeId]);
  const thumb = useBlockThumbs(forType.flatMap((l) => (l.block ? [l.block] : [])), h.theme);
  const [asking, setAsking] = useState<{ block: Block; into?: Into; at?: Point }>();
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState<{ selected: Selected; positions: { nodes: Record<string, Point>; groups: Record<string, Point> } }>();
  const [updating, setUpdating] = useState<UpdatePlan[]>();
  /** Nodes just inserted, their connect handles shown until the next edit: the lines to the rest are the author's to draw. */
  const [fresh, setFresh] = useState<{ ids: string[]; text: string }>();
  const graph = h.current ? h.drawn?.graph : undefined;
  const behind = useMemo(() => outdated(h.text, lib.byName), [h.text, lib.byName]);
  useEffect(() => {
    if (fresh && h.current && h.text !== fresh.text) setFresh(undefined);
  }, [h.text, h.current, fresh]);

  const groupInto = (gid: string | null | undefined): Into | undefined => {
    const g = gid ? graph?.groups.find((x) => x.id === gid) : undefined;
    return g && g.path.length === 2 ? { collection: String(g.path[0]), id: String(g.path[1]) } : undefined;
  };
  /** Where B puts a block: in the selected group, or in the group of the selected element. */
  const selectionInto = (): Into | undefined => {
    const s = h.selection[0];
    if (!s || !graph) return undefined;
    if (s.kind === 'group') return groupInto(s.id);
    if (s.kind === 'node') return groupInto(graph.nodes.find((n) => n.id === s.id)?.parent);
    return undefined;
  };
  const groupLabel = (into?: Into) => (into ? (graph?.groups.find((g) => JSON.stringify(g.path) === JSON.stringify([into.collection, into.id]))?.label ?? into.id) : undefined);

  const insert = (block: Block, values: Record<string, string>, into?: Into, at?: Point) => {
    setAsking(undefined);
    if (!h.type) return;
    const r = insertBlock(h.textNow(), h.type, at ? { ...block, pins: pinsOf(block) } : block, { values, into });
    if ('error' in r) return h.notify(r.error, { tone: 'error' });
    // Dropped at a point: its nodes stand where the block had them, from there. Otherwise the layout places them.
    const pins = at && Object.keys(r.pins.nodes).length ? Object.fromEntries(Object.entries(r.pins.nodes).map(([id, p]) => [id, { x: Math.round(at.x + p.x), y: Math.round(at.y + p.y) }])) : undefined;
    h.apply(r.text, pins);
    const entries = r.paths.filter((p) => typeof p[1] === 'string');
    h.selectPaths(entries);
    setFresh({ ids: entries.filter((p) => p[0] !== 'groups').map((p) => String(p[1])), text: r.text });
    const suffix = [...r.ids].find(([a, b]) => a !== b);
    h.notify(`Inserted ${block.title}${into ? ` in ${groupLabel(into)}` : ''}${suffix ? ` (ids end in ${suffix[1].slice(suffix[0].length)}: the others were taken)` : ''}. Drag from a dot to connect it; ⌘Z takes it out`);
  };
  /** A block chosen: its parameters asked for first, if it has any. */
  const pick = (block: Block, where: Into | null | 'selection' = 'selection', at?: Point) => {
    if (!h.type) return;
    // Dropped on no group is no group, whatever is selected.
    const into = where === 'selection' ? selectionInto() : (where ?? undefined);
    if (block.type !== h.type.id) return h.notify(`${block.title} is a block for ${block.type} diagrams`, { tone: 'error' });
    if (block.params.length) setAsking({ block, into, at });
    else insert(block, {}, into, at);
  };
  /** A block dropped on the drawing (pin coordinates of the point), maybe into a group. */
  const onDrop = (name: string, at: Point | undefined, group: string | null) => {
    const b = lib.byName.get(name);
    if (b) pick(b, groupInto(group) ?? null, at);
  };

  const startSave = () => {
    if (!h.type) return;
    const paths = h.selection.map(h.pathOf).filter((p): p is Path => !!p && p.length === 2 && typeof p[1] === 'string');
    if (!paths.length) return h.notify('Select the shapes and groups to keep as a block first (⇧-click for more)', { tone: 'error' });
    let data: Record<string, unknown>;
    try {
      data = parse(h.textNow()) as Record<string, unknown>;
    } catch {
      return h.notify('Fix the YAML first: it does not parse', { tone: 'error' });
    }
    const selected = gather(data, h.type, paths);
    // Where they are drawn now, by entry id: kept relative as the block's pins.
    const placed = h.drawn?.placed;
    const at = (kind: 'nodes' | 'groups') =>
      Object.fromEntries(
        (kind === 'nodes' ? (graph?.nodes ?? []) : (graph?.groups ?? [])).flatMap((x) => {
          const b = (kind === 'nodes' ? placed?.nodes : placed?.groups)?.get(x.id);
          return b && x.path.length === 2 && x.path[0] === kind ? [[String(x.path[1]), { x: b.x, y: b.y }]] : [];
        }),
      );
    setSaving({ selected, positions: { nodes: at('nodes'), groups: at('groups') } });
  };
  const save = async (r: SaveRequest) => {
    setSaving(undefined);
    try {
      await lib.save(r.name, r.text, r.where);
      h.notify(r.where === 'folder' ? `Saved blocks/${r.name}.block.yaml: it is in the Blocks section of the shapes` : `Saved ${r.name} in your library: it is in the Blocks section of the shapes`);
    } catch (e) {
      h.notify(`Could not save the block: ${(e as Error).message}`, { tone: 'error' });
    }
  };

  const review = () => {
    if (!h.type) return;
    const t = h.textNow();
    const plans = outdated(t, lib.byName).map((instance) => {
      const block = lib.byName.get(instance.block)!;
      return { instance, block, before: t, result: updateInstance(t, h.type!, block, instance) };
    });
    if (!plans.length) return h.notify('Every instance is up to date with its block');
    setUpdating(plans);
  };
  const applyUpdates = (picked: UpdatePlan[]) => {
    setUpdating(undefined);
    if (!h.type) return;
    let t = h.textNow();
    let done = 0;
    for (const x of picked) {
      const inst = findInstances(t).find((i) => i.block === x.instance.block && i.no === x.instance.no);
      const r = inst && updateInstance(t, h.type, x.block, inst);
      if (!r || 'error' in r) continue;
      t = r.text;
      done++;
    }
    if (done) {
      h.apply(t);
      h.notify(`Updated ${done} ${done === 1 ? 'instance' : 'instances'} (⌘Z takes it back)`);
    }
  };

  const insertOptions = (into?: Into): Command[] =>
    forType.flatMap((l) =>
      l.block
        ? [{ id: `block:${l.name}`, group: into ? `Insert a block in ${groupLabel(into)}` : 'Insert a block', label: l.block.title, hint: [l.block.params.map((p) => p.name).join(', '), l.block.tags.join(' ')].filter(Boolean).join(' · '), icon: 'boxes', tags: l.block.tags, run: () => pick(l.block!, into ?? null) }]
        : [],
    );

  const commands: Command[] = h.type
    ? [
        { id: 'block-save', group: 'Blocks', label: 'Save the selection as a block…', hint: 'with its groups and the lines between, into blocks/ or your library', icon: 'package', shortcut: keyHint('save-block'), run: startSave },
        { id: 'block-insert', group: 'Blocks', label: 'Insert a block…', hint: forType.length ? `${forType.length} for this type` : 'none for this type yet', icon: 'boxes', shortcut: keyHint('insert-block'), run: () => setChoosing(true) },
        ...(behind.length ? [{ id: 'block-update', group: 'Blocks', label: `Update instances of blocks (${behind.length} behind)…`, hint: 'a diff per instance first', icon: 'refresh-cw', run: review }] : []),
        ...insertOptions(),
      ]
    : [];

  const menuItems = (close: () => void): ReactNode =>
    h.type && h.selection.some((s) => s.kind !== 'edge') ? (
      <button role="menuitem" onClick={() => (close(), startSave())}>
        <Icon name="package" /> Save as block…
      </button>
    ) : null;

  const panel: ReactNode = h.type ? <BlocksPanel listed={lib.listed} typeId={typeId} thumb={thumb} onPick={(b) => pick(b)} outdated={behind.length} onReview={review} hint={keyHint('insert-block')} /> : null;

  const dialog: ReactNode = (
    <>
      {choosing && (
        <Palette
          placeholder={forType.length ? `Insert a block${selectionInto() ? ` in ${groupLabel(selectionInto())}` : ''}…` : 'No blocks for this type yet: select shapes, then ⇧B'}
          onClose={() => setChoosing(false)}
          commands={insertOptions(selectionInto()).map((c) => ({ ...c, hint: [c.hint, blockSearch(lib.byName.get(c.id.slice(6))!)].filter(Boolean).join(' · ').slice(0, 90) }))}
        />
      )}
      {asking && (
        <InsertDialog
          block={asking.block}
          thumb={thumb(asking.block)}
          where={asking.into ? `In ${groupLabel(asking.into)}` : asking.at ? 'Where you dropped it' : 'The layout finds it a place'}
          onInsert={(v) => insert(asking.block, v, asking.into, asking.at)}
          onClose={() => setAsking(undefined)}
        />
      )}
      {saving && h.type && <SaveDialog type={h.type} selected={saving.selected} positions={saving.positions} inFolder={h.inFolder} exists={lib.exists} onSave={(r) => void save(r)} onClose={() => setSaving(undefined)} />}
      {updating && <UpdateDialog plans={updating} onApply={applyUpdates} onClose={() => setUpdating(undefined)} />}
    </>
  );

  /** The just-inserted nodes' connect handles, on the drawing (its overlay, layout coordinates). */
  const overlay = (scale: number): ReactNode => {
    const placed = h.drawn?.placed;
    if (!fresh || !placed || !h.current) return null;
    const o = h.drawn?.origin ?? { x: 0, y: 0 };
    return fresh.ids.map((id) => {
      const b = placed.nodes.get(id);
      return b ? <button key={id} className="connect-handle block-handle" data-handle={id} tabIndex={-1} title="Drag to another element to connect" aria-label={`Connect ${id}`} style={{ left: b.x + b.width + o.x, top: b.y + b.height / 2 + o.y, transform: `translate(-50%, -50%) scale(${1 / scale})` }} /> : null;
    });
  };

  /** B: insert a block; ⇧B: save the selection as one. Not while typing. */
  const onKey = (e: KeyboardEvent, typing: boolean): boolean => {
    if (typing || !h.type || asking || choosing || saving || updating) return false;
    if (is(e, 'insert-block')) return setChoosing(true), true;
    if (is(e, 'save-block')) return startSave(), true;
    return false;
  };

  return { commands, menuItems, panel, dialog, overlay, onDrop, onKey, open: !!(asking || choosing || saving || updating) };
}
