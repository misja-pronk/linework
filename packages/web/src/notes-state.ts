// The review notes of the open document: kept with it in this browser, read from and saved to
// <name>.notes.json in an open folder (with ⌘S, as the diagram and its pins are). Notes are not in
// the editor's undo history: they are a conversation about the diagram, not the diagram.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyNotes, healNotes, lastActivity, mergeNotes, newNoteId, notesPath, parseNotes, printNotes, renameNoteAnchors, type Graph, type NoteAnchor, type NoteThread, type NotesFile } from '@cartography/core';
import { diskText, saveNotesInFolder, type Workspace } from './files.ts';
import { store } from './store.ts';

interface Kept {
  doc: string;
  notes: NotesFile;
  /** As last saved or read from the folder: what "unsaved" is measured against, and the base of a merge. */
  saved: string;
}

const text = (n: NotesFile) => printNotes(n) ?? '';
const now = () => new Date().toISOString();

/** Who writes, set once per browser: there are no accounts. */
export const noteAuthor = () => store.get<string>('note-author') ?? '';

export interface Review {
  notes: NotesFile;
  dirty: boolean;
  author: string;
  setAuthor(name: string): void;
  /** `as`: the author's name when it was just given with this note (the first one). */
  add(anchor: NoteAnchor, body: string, view?: string, as?: string): NoteThread;
  reply(id: string, body: string): void;
  edit(id: string, body: string, reply?: string): void;
  remove(id: string, reply?: string): void;
  setStatus(id: string, status: 'open' | 'resolved'): void;
  /** Hangs an orphaned thread on another anchor. */
  reattach(id: string, anchor: NoteAnchor, view?: string): void;
  /** An element renamed by the builder: its threads go along. */
  rename(kind: 'node' | 'group', from: string, to: string): void;
  /** Activity by others since this thread was last opened here. */
  unread(t: NoteThread): boolean;
  seen(ids: string[]): void;
  /** Writes the notes file next to the diagram (merged with what is on disk when that changed meanwhile). */
  saveTo(ws: Workspace, diagram: string, graph?: Graph, view?: string): Promise<void>;
  /** The notes as a file to download (no folder to save them in). */
  fileText(): string | undefined;
}

export function useReview(docId: string, docKey: number, folder: { ws: Workspace; path: string } | undefined): Review {
  const [kept, setKept] = useState<Kept>(() => {
    const k = store.get<Kept>('notes');
    return k && k.doc === docId && Array.isArray(k.notes?.threads) ? k : { doc: docId, notes: emptyNotes(), saved: '' };
  });
  const [author, setAuthorState] = useState(noteAuthor);
  const [seenMap, setSeenMap] = useState<Record<string, string>>(() => store.get<Record<string, Record<string, string>>>('notes-seen')?.[docId] ?? {});
  const where = useRef(folder);
  where.current = folder;
  const first = useRef(true);

  // Another document, or this one read again from disk: its notes come along.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      // After a reload: what was kept here, unless the folder's file says something newer and nothing is unsaved.
      if (kept.doc === docId && (!folder || text(kept.notes) !== kept.saved)) return;
    }
    const f = where.current;
    const disk = f ? (f.ws.files.get(notesPath(f.path))?.text ?? '') : undefined;
    setKept((k) => {
      if (disk === undefined) return k.doc === docId ? k : { doc: docId, notes: emptyNotes(), saved: '' };
      const theirs = parseNotes(disk).notes;
      // The same document read again: what was added here meanwhile is merged with what came from disk.
      if (k.doc === docId && text(k.notes) !== k.saved) return { doc: docId, notes: mergeNotes(parseNotes(k.saved).notes, k.notes, theirs), saved: text(theirs) };
      return { doc: docId, notes: theirs, saved: text(theirs) };
    });
    setSeenMap(store.get<Record<string, Record<string, string>>>('notes-seen')?.[docId] ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, docKey]);

  // The folder read again (back in the window): notes that changed on disk (a git pull) come in, merged.
  useEffect(() => {
    const f = where.current;
    const disk = f?.ws.files.get(notesPath(f.path))?.text;
    if (disk === undefined) return;
    setKept((k) => {
      if (k.doc !== docId || disk === k.saved) return k;
      const theirs = parseNotes(disk).notes;
      return { doc: docId, notes: mergeNotes(parseNotes(k.saved).notes, k.notes, theirs), saved: text(theirs) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.ws]);

  useEffect(() => {
    const t = setTimeout(() => store.set('notes', kept), 200);
    return () => clearTimeout(t);
  }, [kept]);

  const change = useCallback((f: (n: NotesFile) => NotesFile) => setKept((k) => ({ ...k, notes: f(k.notes) })), []);
  const threads = (f: (t: NoteThread) => NoteThread | undefined, id: string) => change((n) => ({ ...n, threads: n.threads.flatMap((t) => (t.id === id ? (f(t) ?? []) : [t])) }));

  const seen = useCallback(
    (ids: string[]) =>
      setSeenMap((m) => {
        const next = { ...m };
        for (const t of kept.notes.threads) if (ids.includes(t.id)) next[t.id] = lastActivity(t);
        const all = store.get<Record<string, Record<string, string>>>('notes-seen') ?? {};
        store.set('notes-seen', { ...all, [docId]: next });
        return next;
      }),
    [kept.notes, docId],
  );

  return useMemo<Review>(() => {
    const me = author;
    return {
      notes: kept.notes,
      dirty: text(kept.notes) !== kept.saved,
      author,
      setAuthor(name) {
        store.set('note-author', name.trim());
        setAuthorState(name.trim());
      },
      add(anchor, body, view, as) {
        const t: NoteThread = { id: newNoteId(), anchor, ...(view ? { view } : {}), status: 'open', author: as?.trim() || me, created: now(), text: body.trim() };
        change((n) => ({ ...n, threads: [...n.threads, t] }));
        return t;
      },
      reply: (id, body) => threads((t) => ({ ...t, replies: [...(t.replies ?? []), { id: newNoteId(), author: me, created: now(), text: body.trim() }] }), id),
      edit: (id, body, reply) =>
        threads((t) => (reply ? { ...t, replies: t.replies?.map((r) => (r.id === reply ? { ...r, text: body.trim(), edited: now() } : r)) } : { ...t, text: body.trim(), edited: now() }), id),
      remove: (id, reply) =>
        threads((t) => {
          if (!reply) return undefined;
          const replies = t.replies?.filter((r) => r.id !== reply);
          const out = { ...t, replies };
          if (!replies?.length) delete out.replies;
          return out;
        }, id),
      // The status alone: "edited" stays about the text.
      setStatus: (id, status) => threads((t) => ({ ...t, status }), id),
      reattach: (id, anchor, view) =>
        threads((t) => {
          const out: NoteThread = { ...t, anchor, ...(view ? { view } : {}) };
          if (!view) delete out.view;
          return out;
        }, id),
      rename: (kind, from, to) => change((n) => renameNoteAnchors(n, kind, from, to)),
      unread(t) {
        const others = [t, ...(t.replies ?? [])].filter((x) => x.author !== me).map((x) => x.edited ?? x.created);
        const last = others.reduce((a, b) => (b > a ? b : a), '');
        return !!last && last > (seenMap[t.id] ?? '');
      },
      seen,
      async saveTo(ws, diagram, graph, view) {
        const file = notesPath(diagram);
        const ours = graph ? healNotes(kept.notes, graph, view) : kept.notes;
        const disk = (await diskText(ws, file)) ?? '';
        // Someone else's notes arrived meanwhile (a git pull, another window): merged, not overwritten.
        const merged = disk && disk !== kept.saved ? mergeNotes(parseNotes(kept.saved).notes, ours, parseNotes(disk).notes) : ours;
        const out = printNotes(merged);
        if ((out ?? '') !== disk) await saveNotesInFolder(ws, file, out);
        setKept({ doc: kept.doc, notes: merged, saved: out ?? '' });
      },
      fileText: () => printNotes(kept.notes),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, author, seenMap, seen, change]);
}
