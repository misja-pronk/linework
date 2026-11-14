// Opening and saving: a template or example, a file, a dropped file, a folder (picked here, or the one
// linework serve serves), a share link opened in the editor; saving where the document lives. Opening
// over unsaved changes saves first where the document lives, or asks.
import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeShare, type LayoutSidecar } from '@linework/core';
import { t, withUiLang } from '../i18n/index.ts';
import { blankText, type Starter } from '../library.ts';
import type { Opened, View } from '../start.tsx';
import { OPEN_KEY } from '../viewer.tsx';
import { dropped } from '../drop.ts';
import { download, yamlName } from '../export.ts';
import { served, servedFolder } from '../live/serve.ts';
import type { Ask } from '../confirm.tsx';
import type { Selection } from '../preview.tsx';
import { canSaveFiles, canUseFolders, diagrams, diskText, lastFolder, pickFolder, readSidecar, reopen, saveAs, saveFile, saveInFolder, scan, type Workspace } from '../files.ts';
import type { Doc, DocumentState } from './document.ts';
import type { Notify } from './toasts.tsx';

/** The open folder, and the last one (offered again after a reload). */
export function useWorkspace() {
  const [ws, setWs] = useState<Workspace>();
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle>();
  useEffect(() => {
    if (canUseFolders) void lastFolder().then(setRemembered);
  }, []);
  return { ws, setWs, remembered, setRemembered };
}
export type WorkspaceState = ReturnType<typeof useWorkspace>;

interface Props {
  document: DocumentState;
  workspace: WorkspaceState;
  notify: Notify;
  ask(a: Ask): Promise<boolean>;
  setSelected(s: Selection | undefined): void;
  closeModal(): void;
  /** Closes a dialog without counting as leaving the start dialog. */
  dropModal(): void;
  setView(v: View): void;
  focusDrawing(): void;
  /** The pins to write next to the YAML: with the note of the drawing on screen. */
  pinsToSave(): LayoutSidecar | undefined;
}

export function useFileIO({ document: d, workspace, notify, ask, setSelected, closeModal, dropModal, setView, focusDrawing, pinsToSave }: Props) {
  const { text, doc, pins, savedText, savedPins, dirty, editor, fileHandle } = d;
  const { ws, setWs, setRemembered } = workspace;

  const open = useCallback(
    (next: string, nextDoc: Doc, nextPins?: LayoutSidecar, quiet = false, said?: string) => {
      const restore = d.replaceWith(next, nextDoc, nextPins);
      setSelected(undefined);
      // Within a folder, files are saved before switching: nothing to undo. A blank start says nothing either.
      if (nextDoc.path || quiet) return;
      notify(said ?? t('Opened {name}', { name: nextDoc.name }), {
        action: {
          label: t('Undo'),
          run: () => {
            restore();
            setSelected(undefined);
          },
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- d is new every render: these are what d.replaceWith reads
    [text, doc, pins, notify, savedText, savedPins],
  );

  // "Open in editor" from a share link's viewer: the diagram becomes a document of this browser's own,
  // with an undo back to what was open; the link data leaves the address bar.
  const openShared = useRef(false);
  useEffect(() => {
    const m = new RegExp(`^#${OPEN_KEY}=([A-Za-z0-9_-]+)$`).exec(location.hash);
    if (!m || openShared.current) return;
    openShared.current = true;
    history.replaceState(null, '', location.pathname + location.search);
    void decodeShare(m[1]!).then((sh) => {
      if (!sh) notify(t('That link does not hold a diagram: it may have been cut short'), { tone: 'error' });
      else {
        dropModal();
        open(sh.yaml, { name: sh.name ?? 'shared.yaml' }, sh.layout, false, t('Opened the shared diagram as {name}', { name: sh.name ?? 'shared.yaml' }));
      }
    });
  }, [open, notify, dropModal]);

  /** Before replacing the document: save it where it lives, or ask. False keeps it open. */
  const leave = async (): Promise<boolean> => {
    if (!dirty) return true;
    if ((ws && doc.path) || fileHandle.current) return save();
    return ask({ title: t('Discard the unsaved changes?'), text: t('{name} has changes that are not saved in a file.', { name: doc.name }), ok: t('Discard'), cancel: t('Keep editing') });
  };

  /** Opening something else over unsaved changes (a template, a drop, a file): asked first, as for a folder. */
  const pick = async (s: Starter) => {
    dropModal();
    if (!(await leave())) return;
    fileHandle.current = undefined;
    open(withUiLang(s.text), { name: s.file, starter: s.id }, undefined, true);
    notify(t('Opened {name}', { name: s.title }));
    focusDrawing();
  };

  /**
   * From the start dialog: the chosen template, or a blank sheet. Unsaved changes were asked about
   * first, so it says what opened without offering to undo it.
   */
  const start = async (o: Opened) => {
    closeModal();
    if (!(await leave())) return;
    fileHandle.current = undefined;
    setView(o.view);
    open(withUiLang(o.text), { name: o.name, starter: o.starter }, undefined, true);
    if (!o.blank) notify(t('Opened {name}', { name: o.title ?? o.name }));
    if (o.view === 'code') requestAnimationFrame(() => editor.current?.focus());
    else focusDrawing();
  };

  /** An empty diagram of a type, from the palette. */
  const blank = (type: string) => {
    dropModal();
    fileHandle.current = undefined;
    open(withUiLang(blankText(type)), { name: `${type}.yaml` }, undefined, true);
    focusDrawing();
  };

  /** Saves where the document lives: its folder, its file, or a new file. Returns false when cancelled. */
  const save = async (): Promise<boolean> => {
    const now = d.textNow();
    // All pins are kept: other views of the same file (access matrices, data-products overview) draw other things.
    // The view on screen gets the note of the drawing as it is now, when it has a sidecar entry anyway.
    const toSave = pinsToSave();
    try {
      if (ws && doc.path) {
        // Never overwrite edits made elsewhere without asking.
        const disk = await diskText(ws, doc.path);
        if (disk != null && savedText != null && disk !== savedText && disk !== now && !(await ask({ title: t('Overwrite {path}?', { path: doc.path! }), text: t('{path} was changed outside Linework since it was opened.', { path: doc.path! }), ok: t('Overwrite'), cancel: t('Keep the file') }))) return false;
        await saveInFolder(ws, doc.path, now, toSave);
      } else if (fileHandle.current) await saveFile(fileHandle.current, now);
      else if (canSaveFiles) {
        const r = await saveAs(yamlName(doc.name), now, ws?.dir);
        if (!r) return false;
        // Saved inside the open folder: it becomes one of its files, with its pins next to it.
        const inside = ws ? await ws.dir.resolve(r.handle) : null;
        if (ws && inside) {
          const path = inside.join('/');
          await saveInFolder(ws, path, now, toSave);
          fileHandle.current = undefined;
          d.setDoc({ name: r.name, path });
          setWs(await scan(ws.dir));
        } else {
          fileHandle.current = r.handle;
          d.setDoc({ name: r.name });
        }
      } else download(yamlName(doc.name), now, 'text/yaml');
      d.markSaved(now);
      notify(t('Saved {name}', { name: doc.path ?? doc.name }));
      return true;
    } catch (e) {
      notify(t('Saving failed: {error}', { error: e instanceof Error ? e.message : String(e) }), { tone: 'error' });
      return false;
    }
  };

  const openFolder = async (dir?: FileSystemDirectoryHandle, given?: Workspace) => {
    try {
      const next = given ?? (dir ? await reopen(dir) : await pickFolder());
      if (!next) return;
      // After a reload the document of that folder is back with its edits: carry on with it.
      if (!ws && doc.path && next.files.has(doc.path)) {
        setWs(next);
        setRemembered(next.dir);
        d.setSavedText(next.files.get(doc.path)!.text);
        return;
      }
      if (!(await leave())) return;
      setWs(next);
      setRemembered(next.dir);
      const first = diagrams(next)[0];
      // Already left above: asking again would ask twice, from this render's stale dirty state.
      if (first) await openInFolder(next, first, true);
      else notify(t('No diagrams in {name} yet: start from a template and save it there', { name: next.name }));
    } catch (e) {
      notify(t('Opening the folder failed: {error}', { error: e instanceof Error ? e.message : String(e) }), { tone: 'error' });
    }
  };

  // Opened by linework serve: its folder is the workspace, read and written through the server.
  useEffect(() => {
    const s = served();
    if (s) void servedFolder(s).then(scan).then((next) => openFolder(undefined, next), (e: unknown) => notify(t('Opening the folder failed: {error}', { error: e instanceof Error ? e.message : String(e) }), { tone: 'error' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at launch: the folder linework serve opened
  }, []);

  /** Opens a file of the folder; false when it is not there or the user keeps the open one. */
  const openInFolder = async (w: Workspace, path: string, left = false): Promise<boolean> => {
    // Switching files keeps work: saved first where it lives, otherwise asked.
    if (doc.path === path && ws === w) return true;
    const f = w.files.get(path);
    if (!f) return false;
    if (!left && !(await leave())) return false;
    fileHandle.current = undefined;
    open(f.text, { name: path.split('/').pop()!, path }, readSidecar(w, path));
    return true;
  };

  /** A proposal for another file of the folder opens it; one written since the folder was read is looked for again. */
  const openForProposal = async (p: string) => {
    if (!ws) return false;
    let w = ws;
    if (!w.files.has(p)) {
      w = await scan(w.dir).catch(() => w);
      if (w !== ws) setWs(w);
    }
    return openInFolder(w, p);
  };

  /** Files picked or dropped: the first diagram opens. */
  const openTexts = async (files: { path: string; text: string }[], handle?: FileSystemFileHandle) => {
    const diagram = files.find((f) => /\.ya?ml$/i.test(f.path) && /^type:\s*[\w-]+/m.test(f.text)) ?? (files.length === 1 && /\.ya?ml$/i.test(files[0]!.path) ? files[0] : undefined);
    if (!diagram) return notify(t('Nothing to open there: drop a diagram (.yaml)'), { tone: 'error' });
    if (!(await leave())) return;
    fileHandle.current = files.length === 1 ? handle : undefined;
    open(diagram.text, { name: diagram.path.split('/').pop()! });
  };

  // Files dragged over the page: the whole page takes them, before the YAML editor reads them as text to insert.
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragFiles = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDropFiles = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    void dropped(e.dataTransfer)
      .then((files) => openTexts(files))
      .catch((err: unknown) => notify(t('Opening failed: {error}', { error: err instanceof Error ? err.message : String(err) }), { tone: 'error' }));
  };
  const onDragLeave = (e: React.DragEvent) => e.relatedTarget == null && setDropping(false);

  const openFile = () => {
    if ('showOpenFilePicker' in window) {
      void (async () => {
        try {
          const hs = await (window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
            multiple: true,
            types: [{ description: t('Linework diagram'), accept: { 'text/yaml': ['.yaml', '.yml'] } }],
          });
          const files = await Promise.all(hs.map(async (h) => ((f) => f.text().then((text) => ({ path: f.name, text })))(await h.getFile())));
          await openTexts(files, hs[0]);
        } catch (e) {
          if ((e as Error).name !== 'AbortError') notify(t('Opening failed: {error}', { error: (e as Error).message }), { tone: 'error' });
        }
      })();
      return;
    }
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,text/yaml';
    input.multiple = true;
    input.onchange = async () => {
      const files = await Promise.all([...(input.files ?? [])].map(async (f) => ({ path: f.name, text: await f.text() })));
      if (files.length) await openTexts(files);
    };
    input.click();
  };

  const saveYaml = () => void save();
  const downloadYaml = () => {
    download(yamlName(doc.name), d.textNow(), 'text/yaml');
    notify(t('Downloaded {file}', { file: yamlName(doc.name) }));
  };

  return { open, leave, pick, start, blank, save, saveYaml, downloadYaml, openFolder, openInFolder, openForProposal, openFile, dropping, onDragFiles, onDropFiles, onDragLeave };
}
export type FileIO = ReturnType<typeof useFileIO>;
