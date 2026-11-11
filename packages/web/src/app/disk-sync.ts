// Files edited elsewhere (your AI agent, git, another editor) show up: the folder is read again when
// the window gets focus, and the open file is watched while the tab is visible (carto serve says when
// it changes; a folder picked here is asked, or polled for its lastModified). Without unsaved changes
// the new text comes in as one undoable edit, marked in the Your AI panel; with them, a warning
// (saving then asks first).
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { readSidecar, scan, sidecarPath, type Workspace } from '../files.ts';
import type { DocumentState } from './document.ts';
import type { Notify } from './toasts.tsx';

export interface DiskChange {
  doc: number;
  path: string;
  before: string;
  after: string;
}

interface Props {
  ws: Workspace | undefined;
  setWs(w: Workspace): void;
  document: DocumentState;
  notify: Notify;
  /** Brings the Your AI panel up, where the change is marked. */
  show(): void;
  /** carto serve says when a file changes: no watching here then. */
  served: boolean;
}

export function useDiskSync({ ws, setWs, document: d, notify, show, served }: Props) {
  /** A file of the folder that changed on disk while open, already in the editor (Your AI panel). */
  const [diskChange, setDiskChange] = useState<DiskChange>();
  const checkDisk = useRef<() => void>(() => undefined);
  const { doc, dirty, savedText, docKey } = d;
  const onDisk = useRef({ ws, doc, dirty, savedText, docKey });
  onDisk.current = { ws, doc, dirty, savedText, docKey };
  /** The open file as it is on disk now came in from elsewhere. */
  const tookFromDisk = (w: Workspace, path: string, disk: string, side: string | undefined) => {
    const { doc: dc, dirty: changed, savedText: base, docKey: key } = onDisk.current;
    if (dc.path !== path || base == null || disk === base) return;
    // What the editor has already (its own save, an accepted proposal saved): nothing came in.
    const before = d.textNow();
    if (disk === before) return d.setSavedText(disk);
    if (changed) return notify(t('{path} changed on disk. Saving will ask before it overwrites that.', { path }), { tone: 'error' });
    if (side !== undefined && w.files.has(sidecarPath(path))) w.files.set(sidecarPath(path), { ...w.files.get(sidecarPath(path))!, text: side });
    w.files.set(path, { ...w.files.get(path)!, text: disk });
    d.editor.current?.replace(disk, { pins: readSidecar(w, path) ?? null });
    d.setSavedText(disk);
    d.setSavedPins(JSON.stringify(readSidecar(w, path) ?? null));
    setDiskChange({ doc: key, path, before, after: disk });
    show();
  };
  useEffect(() => {
    if (!ws) return;
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 1500) return;
      last = Date.now();
      void scan(ws.dir)
        .then((next) => {
          const p = onDisk.current.doc.path;
          const disk = p ? next.files.get(p)?.text : undefined;
          // The open file's cache stays what the editor has until it is taken in below.
          if (p && disk != null && ws.files.has(p)) next.files.set(p, { ...next.files.get(p)!, text: ws.files.get(p)!.text });
          setWs(next);
          if (p && disk != null) tookFromDisk(next, p, disk, next.files.get(sidecarPath(p))?.text);
        })
        .catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ws, notify]);
  useEffect(() => {
    const path = doc.path;
    if (!ws || !path) return;
    let stamp = 0;
    let busy = false;
    const check = async (force = false) => {
      const h = ws.files.get(path)?.handle;
      if (!h || busy || document.hidden) return;
      busy = true;
      try {
        const f = await h.getFile();
        if (!force && f.lastModified === stamp) return;
        stamp = f.lastModified;
        const side = ws.files.get(sidecarPath(path))?.handle;
        tookFromDisk(ws, path, await f.text(), side ? await side.getFile().then((x) => x.text(), () => undefined) : undefined);
      } catch {
        /* gone, or no permission any more: the focus rescan says so */
      } finally {
        busy = false;
      }
    };
    checkDisk.current = () => void check(true);
    void ws.files.get(path)?.handle.getFile().then((f) => (stamp = f.lastModified), () => undefined);
    // carto serve says when a file changes; a folder picked here is asked to say so, or polled.
    if (served) return () => void (checkDisk.current = () => undefined);
    const Observer = (window as unknown as { FileSystemObserver?: new (cb: () => void) => { observe(h: unknown): Promise<void>; disconnect(): void } }).FileSystemObserver;
    if (Observer) {
      const o = new Observer(() => void check());
      void o.observe(ws.files.get(path)!.handle).catch(() => undefined);
      return () => o.disconnect();
    }
    const timer = setInterval(() => void check(), 2000);
    return () => clearInterval(timer);
  }, [ws, doc.path]);
  /** carto serve said a file changed: the open one is read again. */
  const changed = (path: string) => path === onDisk.current.doc.path && checkDisk.current();
  return { diskChange, setDiskChange, changed };
}
