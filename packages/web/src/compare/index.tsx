// Comparing the open diagram with an earlier version, as the editor offers it: "Compare with…" (⇧⌘D)
// picks the version (last saved, a snapshot, another file, a commit), "Take snapshot…" (⇧⌘S) keeps
// one. The app hands in what it knows about the document and places what this returns.
import { is, keyHint } from '../keys.ts';
import { useEffect, useRef, useState } from 'react';
import type { LayoutSidecar } from '@cartography/core';
import type { ItemDiff } from '@cartography/diff';
import { Palette, type Command } from '../palette.tsx';
import { Icon } from '../icon.tsx';
import { useModal } from '../menu.tsx';
import { store } from '../store.ts';
import { say, t } from '../i18n/index.ts';
import { diagrams, diskText, readSidecar, saveInFolder, type Workspace } from '../files.ts';
import { CompareView, type CompareActions, type CompareMode } from './compare-view.tsx';
import { gitFilesIn, Repo } from './git.ts';
import { ago, gitBaseline, type Baseline } from './versions.ts';
import { browserBackend, dropSnapshot, folderSnapshots, freeLabel, mergeSnapshots, snapshotPath, takeSnapshot, type Snapshot } from './snapshots.ts';

export interface CompareContext {
  /** The document, the same key across reloads: folder and path, a template id or a name. */
  docKey: string;
  docName: string;
  /** Its path in the open folder. */
  path?: string;
  ws?: Workspace;
  text: string;
  textNow(): string;
  pins?: LayoutSidecar;
  /** What was last saved or opened (null: never saved), and its pins as JSON. */
  savedText: string | null;
  savedPins: string;
  load?: (file: string) => string;
  file?: string;
  view?: string;
  theme: 'light' | 'dark';
  /** A dialog or the presenter is up: the keys are theirs. */
  blocked: boolean;
  notify(message: string, opts?: { tone?: 'error' }): void;
  /** Back in the editor with this element selected. */
  onSelect(sel: { kind: 'node' | 'group' | 'edge'; id: string }): void;
}

const backend = browserBackend();
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
};

async function pickYaml(): Promise<{ name: string; text: string } | undefined> {
  if ('showOpenFilePicker' in window) {
    try {
      const [h] = await (window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> }).showOpenFilePicker({ types: [{ description: t('Cartography diagram'), accept: { 'text/yaml': ['.yaml', '.yml'] } }] });
      const f = await h!.getFile();
      return { name: f.name, text: await f.text() };
    } catch {
      return undefined;
    }
  }
  return new Promise((ok) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,text/yaml';
    input.onchange = async () => {
      const f = input.files?.[0];
      ok(f ? { name: f.name, text: await f.text() } : undefined);
    };
    input.click();
  });
}

export function useCompare(ctx: CompareContext) {
  const [baseline, setBaseline] = useState<Baseline>();
  const [mode, setModeState] = useState<CompareMode>(() => store.get<CompareMode>('compare-mode') ?? 'overlay');
  const setMode = (m: CompareMode) => {
    setModeState(m);
    store.set('compare-mode', m);
  };
  const [choosing, setChoosing] = useState<Command[]>();
  const [naming, setNaming] = useState(false);
  const actions = useRef<CompareActions>(null);
  const latest = useRef(ctx);
  latest.current = ctx;

  // Another document: the comparison was about the one before.
  useEffect(() => setBaseline(undefined), [ctx.docKey]);

  const repo = useRef<{ dir?: FileSystemDirectoryHandle; repo?: Repo; why?: string }>({});
  const gitRepo = async (): Promise<{ repo?: Repo; why?: string }> => {
    const ws = latest.current.ws;
    if (!ws) return { why: t('Open the folder of a git repository to compare with commits') };
    if (repo.current.dir !== ws.dir) {
      const { files, why } = await gitFilesIn(ws.dir);
      repo.current = { dir: ws.dir, why };
      if (files) {
        try {
          repo.current.repo = await Repo.open(files);
        } catch (e) {
          repo.current.why = e instanceof Error ? e.message : String(e);
        }
      }
    }
    return repo.current;
  };

  const snapshots = async (): Promise<Snapshot[]> => {
    const c = latest.current;
    return mergeSnapshots(await backend.get(c.docKey), c.ws && c.path ? folderSnapshots(c.path, c.ws.files) : []);
  };

  const start = (b: Baseline) => {
    setChoosing(undefined);
    setBaseline(b);
  };
  const failed = (what: string) => (e: unknown) => latest.current.notify(t('{what} failed: {error}', { what: say(what), error: e instanceof Error ? e.message : String(e) }), { tone: 'error' });

  /** The versions to choose from, gathered now: snapshots and commits may have changed since last time. */
  const choose = async () => {
    const c = latest.current;
    const list: Command[] = [];
    if (c.savedText != null) {
      const inFolder = !!(c.ws && c.path);
      list.push({
        id: 'saved',
        group: t('Compare with'),
        label: inFolder ? t('Last saved (the file on disk)') : t('As opened or last saved'),
        hint: c.savedText === c.textNow() ? t('no unsaved changes') : t('your unsaved changes'),
        icon: 'save',
        run: () =>
          void (async () => {
            const text = inFolder ? ((await diskText(c.ws!, c.path!)) ?? c.savedText!) : c.savedText!;
            const sidecar = inFolder ? readSidecar(c.ws!, c.path!) : (JSON.parse(c.savedPins) as LayoutSidecar | null) ?? undefined;
            start({ id: 'saved', kind: 'saved', name: t('last saved'), text, ...(sidecar ? { sidecar } : {}) });
          })().catch(failed('Reading the file')),
      });
    }
    const snaps = await snapshots();
    for (const s of snaps)
      list.push({
        id: `snapshot:${s.label}`,
        group: t('Snapshots'),
        label: s.label,
        hint: [s.at ? ago(s.at) : '', s.path ? t('in the folder: {path}', { path: s.path }) : t('in this browser')].filter(Boolean).join(' · '),
        icon: 'clock',
        run: () => start({ id: `snapshot:${s.label}`, kind: 'snapshot', name: `snapshot ${s.label}`, text: s.text, ...(s.pins ? { sidecar: s.pins } : {}) }),
      });
    list.push({ id: 'snapshot-take', group: t('Snapshots'), label: t('Take snapshot…'), hint: t('keep the diagram as it is now, to compare with later'), icon: 'plus', shortcut: keyHint('snapshot'), run: () => (setChoosing(undefined), setNaming(true)) });
    if (c.ws && c.path) {
      const { repo: r, why } = await gitRepo();
      if (r) {
        try {
          const [head, branch, history] = [await r.resolve('HEAD'), await r.branch(), await r.history(c.path, { limit: 15 })];
          const headBlob = head ? await r.blobAt(head, c.path) : undefined;
          const at = (oid: string, name: string) => () => void gitBaseline(r, oid, c.path!, name).then(start, failed('Reading the commit'));
          if (head)
            list.push({
              id: 'git:HEAD',
              group: 'Git',
              label: `HEAD${branch ? ` (${branch})` : ''}`,
              hint: headBlob ? t('the last commit: {commit}', { commit: history[0] ? `${history[0].commit.message.split('\n')[0]}, ${ago(history[0].commit.time * 1000)}` : '' }) : t('not committed yet: everything is new'),
              icon: 'git-branch',
              run: at(head, 'HEAD'),
            });
          for (const v of history.slice(headBlob ? 1 : 0))
            list.push({
              id: `git:${v.commit.oid}`,
              group: t('Git: earlier versions of this file'),
              label: `${v.commit.oid.slice(0, 7)} ${v.commit.message.split('\n')[0]}`,
              hint: `${v.commit.author}, ${ago(v.commit.time * 1000)}`,
              icon: 'git-commit-horizontal',
              run: at(v.commit.oid, v.commit.oid.slice(0, 7)),
            });
        } catch (e) {
          list.push({ id: 'git-failed', group: 'Git', label: t('The repository could not be read'), hint: e instanceof Error ? e.message : String(e), icon: 'circle-exclamation-point', run: () => {} });
        }
      } else list.push({ id: 'git-none', group: 'Git', label: t('No commits to compare with'), hint: why, icon: 'git-branch', run: () => {} });
    }
    if (c.ws)
      for (const p of diagrams(c.ws).filter((p) => p !== c.path))
        list.push({ id: `file:${p}`, group: t('Another file in {folder}', { folder: c.ws.name }), label: p, icon: 'file-code', run: () => start({ id: `file:${p}`, kind: 'file', name: p, text: c.ws!.files.get(p)!.text, ...((s) => (s ? { sidecar: s } : {}))(readSidecar(c.ws!, p)) }) });
    list.push({
      id: 'file-pick',
      group: t('Another file'),
      label: t('Pick a file…'),
      hint: t('e.g. last quarter’s copy'),
      icon: 'folder-open',
      run: () => {
        setChoosing(undefined);
        void pickYaml().then((f) => f && start({ id: `file:${f.name}`, kind: 'file', name: f.name, text: f.text }));
      },
    });
    for (const s of snaps.filter((s) => !s.path))
      list.push({ id: `snapshot-drop:${s.label}`, group: t('Delete a snapshot'), label: t('Delete snapshot {label}', { label: s.label }), hint: t('from this browser'), icon: 'trash', run: () => void dropSnapshot(backend, c.docKey, s.label).then(() => (setChoosing(undefined), c.notify(t('Deleted snapshot {label}', { label: s.label })))) });
    setChoosing(list);
  };

  const snapshot = async (label: string, toFolder: boolean) => {
    const c = latest.current;
    const text = c.textNow();
    const snap: Snapshot = { label, text, ...(c.pins ? { pins: c.pins } : {}), at: Date.now() };
    await takeSnapshot(backend, c.docKey, snap);
    let where = t('in this browser');
    if (toFolder && c.ws && c.path) {
      const p = snapshotPath(c.path, label);
      await saveInFolder(c.ws, p, text, c.pins);
      where = t('in {path}', { path: p });
    }
    c.notify(t('Snapshot “{label}” taken, {where}. {key} compares with it (with the drawing in focus).', { label, where, key: keyHint('compare') }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⇧⌘S and ⇧⌘D while the drawing has focus: elsewhere they stay the browser's (bookmarks, screenshots).
      if (latest.current.blocked || choosing || naming || !(e.target as HTMLElement | null)?.closest?.('.preview')) return;
      if (is(e, 'snapshot')) setNaming(true);
      else if (is(e, 'compare')) void choose();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const commands: Command[] = [
    { id: 'compare', group: t('Compare'), label: t('Compare with…'), hint: t('last saved, a snapshot, another file or a commit'), icon: 'clock', shortcut: keyHint('compare'), run: () => setTimeout(() => void choose()) },
    { id: 'snapshot', group: t('Compare'), label: t('Take snapshot…'), hint: t('keep the diagram as it is now, to compare with later'), icon: 'plus', shortcut: keyHint('snapshot'), run: () => setTimeout(() => setNaming(true)) },
    ...(baseline
      ? [
          { id: 'compare-mode', group: t('Compare'), label: mode === 'overlay' ? t('Compare side by side') : t('Compare as an overlay'), icon: 'split', shortcut: 'M', run: () => setMode(mode === 'overlay' ? 'side' : 'overlay') },
          { id: 'compare-next', group: t('Compare'), label: t('Next change'), icon: 'arrow-right', shortcut: 'N', run: () => actions.current?.next() },
          { id: 'compare-previous', group: t('Compare'), label: t('Previous change'), icon: 'arrow-left', shortcut: 'P', run: () => actions.current?.previous() },
          { id: 'compare-copy', group: t('Compare'), label: t('Copy the summary of changes (Markdown)'), hint: t('for a change advisory board'), icon: 'copy', run: () => void actions.current?.copySummary() },
          { id: 'compare-pptx', group: t('Compare'), label: t('Before and after as slides (.pptx)'), icon: 'layout-template', run: () => void actions.current?.savePptx() },
          { id: 'compare-png', group: t('Compare'), label: t('Export the comparison as PNG'), icon: 'image', run: () => void actions.current?.savePng() },
          { id: 'compare-svg', group: t('Compare'), label: t('Export the comparison as SVG'), icon: 'download', run: () => void actions.current?.saveSvg() },
          { id: 'compare-stop', group: t('Compare'), label: t('Stop comparing'), icon: 'x', shortcut: 'Esc', run: () => setBaseline(undefined) },
        ]
      : []),
  ];

  const edit = (item: ItemDiff) => {
    setBaseline(undefined);
    if (item.status === 'removed') return latest.current.notify(t('{name} is not in the diagram any more', { name: item.label ?? item.id }));
    const id = item.kind === 'edge' ? item.edge?.after : item.id;
    if (id) requestAnimationFrame(() => latest.current.onSelect({ kind: item.kind, id }));
  };

  const view = baseline ? (
    <CompareView
      baseline={baseline}
      now={{ text: ctx.text, ...(ctx.pins ? { sidecar: ctx.pins } : {}), ...(ctx.load ? { load: ctx.load } : {}), ...(ctx.file ? { file: ctx.file } : {}), ...(ctx.view ? { view: ctx.view } : {}) }}
      theme={ctx.theme}
      name={ctx.docName}
      mode={mode}
      onMode={setMode}
      onExit={() => {
        setBaseline(undefined);
        // Back to the drawing, unless something else (a dialog) took the focus meanwhile.
        requestAnimationFrame(() => {
          const now = document.activeElement;
          if (!now || now === document.body) (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true });
        });
      }}
      onPick={() => void choose()}
      onEdit={edit}
      notify={ctx.notify}
      actions={actions}
    />
  ) : null;

  const dialogs = (
    <>
      {choosing && <Palette commands={choosing} placeholder={baseline ? t('Comparing with {name}: another version…', { name: baseline.name }) : t('Compare with…')} onClose={() => setChoosing(undefined)} />}
      {naming && (
        <SnapshotDialog
          suggested={stamp()}
          folderPath={ctx.ws && ctx.path ? ctx.path : undefined}
          used={() => snapshots()}
          onCancel={() => setNaming(false)}
          onTake={(label, toFolder) => {
            setNaming(false);
            void snapshot(label, toFolder).catch(failed('Taking the snapshot'));
          }}
        />
      )}
    </>
  );

  const button = (
    <button className={baseline ? 'tool active' : 'tool'} onClick={() => (baseline ? setBaseline(undefined) : void choose())} title={t('Compare with an earlier version ({key})', { key: keyHint('compare') })} aria-label={t('Compare with an earlier version')} aria-pressed={!!baseline}>
      <Icon name="clock" />
    </button>
  );

  const toggle = () => (baseline ? setBaseline(undefined) : void choose());
  /** Compares with a version handed in (the start of a session). */
  const compareWith = (b: Baseline) => start(b);
  return { active: !!baseline, commands, view, dialogs, button, toggle, compareWith };
}

function SnapshotDialog(p: { suggested: string; folderPath?: string; used(): Promise<Snapshot[]>; onCancel(): void; onTake(label: string, toFolder: boolean): void }) {
  const modal = useModal();
  const [label, setLabel] = useState(p.suggested);
  const [toFolder, setToFolder] = useState(() => store.get<boolean>('snapshot-in-folder') ?? true);
  const [taken, setTaken] = useState<Snapshot[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void p.used().then(setTaken), []);
  const final = label.trim() || p.suggested;
  const replaces = taken.some((s) => s.label.toLowerCase() === final.toLowerCase());
  return (
    <div className="snap-dialog" role="dialog" ref={modal} aria-modal="true" aria-label={t('Take a snapshot')} onPointerDown={(e) => e.target === e.currentTarget && p.onCancel()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          store.set('snapshot-in-folder', toFolder);
          p.onTake(final, !!p.folderPath && toFolder);
        }}
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), p.onCancel())}
      >
        <h2>{t('Take a snapshot')}</h2>
        <input autoFocus onFocus={(e) => e.currentTarget.select()} type="text" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('Name of the snapshot')} placeholder={t('before the review')} />
        {replaces && <span className="cmp-keys">{t('A snapshot with this name is replaced. Another name: {name}', { name: freeLabel(taken, final) })}</span>}
        {p.folderPath && (
          <label className="check">
            <input type="checkbox" checked={toFolder} onChange={(e) => setToFolder(e.target.checked)} />
            <span>
              {t('Also in the folder, as')} <code>{snapshotPath(p.folderPath, final)}</code>{t(': a plain file git can keep, and')} <code>carto diff --snapshot</code> {t('reads')}
            </span>
          </label>
        )}
        <div className="row">
          <button type="button" className="button ghost" onClick={p.onCancel}>
            {t('Cancel')}
          </button>
          <button type="submit" className="button primary">
            {t('Take snapshot')} <kbd>↵</kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
