// The open document: its text and pins (the editor holds the one undo history of both), where it came
// from, what was last saved, and the copy in the store that brings it back after a reload.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutSidecar } from '@linework/core';
import type { EditorHandle } from '../editor.tsx';
import { exampleLoader, starters } from '../library.ts';
import { folderLoader, type Workspace } from '../files.ts';
import { store } from '../store.ts';

export interface Doc {
  name: string;
  /** Where it came from, so bundled examples can read their contract files. */
  starter?: string;
  /** Path inside the open folder. */
  path?: string;
}

interface Saved {
  text: string;
  doc: Doc;
  pins?: LayoutSidecar;
  /** What was last saved or opened, for the unsaved-changes dot after a reload. */
  savedText?: string | null;
}

/** Behind the first start dialog: a small, friendly diagram, not the most complex example. */
const firstStarter = starters.find((s) => s.id === 'template:systems') ?? starters[0]!;

/** `endUndoOffer`: the first edit or move ends the "undo open" offer (it would throw that edit away). */
export function useDocument(endUndoOffer: () => void) {
  const saved = useMemo(() => store.get<Saved>('doc'), []);
  const [text, setText] = useState(saved?.text ?? firstStarter.text);
  const [doc, setDoc] = useState<Doc>(saved?.doc ?? { name: firstStarter.file, starter: firstStarter.id });
  const [pins, setPins] = useState<LayoutSidecar | undefined>(saved?.pins);
  const [docKey, setDocKey] = useState(0);
  const editor = useRef<EditorHandle>(null);
  const openedText = useRef<string | null>(null);
  /** A single file opened or saved outside a folder. */
  const fileHandle = useRef<FileSystemFileHandle>(undefined);
  /** What is on disk (or what was opened), for the unsaved-changes dot. */
  const [savedText, setSavedText] = useState<string | null>(saved ? (saved.savedText ?? null) : firstStarter.text);
  /** Pins as saved, compared as JSON: a move is an unsaved change too. */
  const [savedPins, setSavedPins] = useState<string>(() => JSON.stringify(saved?.pins ?? null));
  const dirty = savedText !== text || savedPins !== JSON.stringify(pins ?? null);

  // Keep the last document; also right away when the tab goes away.
  const latest = useRef<Saved>({ text, doc, pins, savedText });
  latest.current = { text, doc, pins, savedText };
  useEffect(() => {
    const t = setTimeout(() => store.set('doc', latest.current), 300);
    return () => clearTimeout(t);
  }, [text, doc, pins, savedText]);
  useEffect(() => {
    const flush = () => store.set('doc', latest.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const textNow = () => editor.current?.text() ?? text;
  const onChange = (next: string) => {
    setText(next);
    // The "undo open" offer ends with the first edit: it would throw that edit away.
    if (openedText.current != null && next !== openedText.current) {
      openedText.current = null;
      endUndoOffer();
    }
  };
  const onPins = (p: LayoutSidecar | undefined) => {
    setPins(p);
    // A move also ends the "undo open" offer: undoing the open would lose it.
    if (openedText.current != null) {
      openedText.current = null;
      endUndoOffer();
    }
  };
  /** Whether there is anything to undo and to redo (the toolbar greys out what there is not). */
  const [history, setHistory] = useState({ undo: false, redo: false });
  /** Marks what is in the editor now as saved. */
  const markSaved = (savedNow: string, pinsNow: LayoutSidecar | undefined | null = pins) => {
    setSavedText(savedNow);
    setSavedPins(JSON.stringify(pinsNow ?? null));
  };
  /** Another document in the editor, with a fresh history; returns how to put back the one before. */
  const replaceWith = (next: string, nextDoc: Doc, nextPins?: LayoutSidecar) => {
    const before = { text: editor.current?.text() ?? text, doc, pins, handle: fileHandle.current, savedText, savedPins };
    editor.current?.load(next, nextPins);
    setDoc(nextDoc);
    setDocKey((k) => k + 1);
    setSavedText(next);
    setSavedPins(JSON.stringify(nextPins ?? null));
    openedText.current = next;
    return () => {
      editor.current?.load(before.text, before.pins);
      setDoc(before.doc);
      // The file it belonged to comes back too, so the next save goes to the right place.
      fileHandle.current = before.handle;
      setSavedText(before.savedText);
      setSavedPins(before.savedPins);
      setDocKey((k) => k + 1);
    };
  };

  return { text, doc, setDoc, pins, docKey, editor, fileHandle, savedText, setSavedText, savedPins, setSavedPins, dirty, textNow, onChange, onPins, history, onHistory: setHistory, markSaved, replaceWith };
}
export type DocumentState = ReturnType<typeof useDocument>;

/** Where the document lives, as the drawing and the links need it. */
export function useDocPlace(ws: Workspace | undefined, doc: Doc) {
  const load = useMemo(
    () => (ws && doc.path ? folderLoader(ws, doc.path) : doc.starter ? exampleLoader(doc.starter) : undefined),
    [ws, doc.path, doc.starter],
  );
  // Views, steps and focus are kept per document: by this id.
  const docId = doc.path ?? doc.starter ?? doc.name;
  // The file name people see (and their AI is told): a template is "sequence.yaml", never its id "template:sequence".
  const docFile = (doc.path ?? (doc.starter?.startsWith('example:') ? doc.starter.slice('example:'.length) : undefined) ?? doc.name).split('/').pop();
  /** This diagram's path in its folder (or under examples/): links to other diagrams are relative to it. */
  const here = ws && doc.path ? doc.path : doc.starter?.startsWith('example:') ? doc.starter.slice('example:'.length) : undefined;
  return { load, docId, docFile, here };
}
