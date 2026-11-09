// The YAML editor: CodeMirror 6 with schema autocomplete, problems from the render, and a
// highlight on the entry of whatever is selected in the drawing. Builder edits go through
// transactions here too, so one undo history covers typing and drawing.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { yaml } from '@codemirror/lang-yaml';
import { tags as t } from '@lezer/highlight';
import type { Diagnostic } from '@cartography/core';
import { schemaCompletion } from './complete.ts';

export interface EditorHandle {
  /** Replace the document as an undoable edit (builder changes). */
  replace(text: string, select?: { from: number; to?: number }): void;
  /** Load a new document with a fresh history. */
  load(text: string): void;
  reveal(from: number, to: number): void;
  focus(): void;
  text(): string;
}

interface Props {
  initial: string;
  diagnostics: Diagnostic[];
  /** Range of the selected element's entry, shown as a soft band. */
  mark?: { from: number; to: number };
  onChange(text: string): void;
  onCursor(pos: number): void;
}

const setMark = StateEffect.define<{ from: number; to: number } | undefined>();
const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setMark)) {
        if (!e.value) return Decoration.none;
        const doc = tr.state.doc;
        const from = doc.lineAt(Math.min(e.value.from, doc.length)).number;
        const to = doc.lineAt(Math.min(e.value.to, doc.length)).number;
        const lines = [];
        for (let n = from; n <= to; n++) lines.push(Decoration.line({ class: 'cm-entry' }).range(doc.line(n).from));
        return Decoration.set(lines);
      }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--syn-key)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-atom)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: 'var(--syn-punct)' },
  { tag: [t.keyword, t.typeName, t.meta], color: 'var(--syn-meta)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--text-faint)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '.cm-entry': { backgroundColor: 'var(--entry-band)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-tooltip': { border: '1px solid var(--border)', borderRadius: '8px', backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px !important' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-completionInfo': { padding: '6px 10px', maxWidth: '280px' },
  '.cm-diagnostic': { padding: '6px 10px', borderLeftWidth: '3px' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)', textUnderlineOffset: '3px' },
  '.cm-foldGutter span': { color: 'var(--text-faint)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
});

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ initial, diagnostics, mark, onChange, onCursor }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const callbacks = useRef({ onChange, onCursor });
  callbacks.current = { onChange, onCursor };

  const extensions = (): Extension[] => [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    lintGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    autocompletion({ override: [schemaCompletion], icons: false }),
    syntaxHighlighting(highlight),
    yaml(),
    markField,
    theme,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
      if (u.selectionSet && u.view.hasFocus) callbacks.current.onCursor(u.state.selection.main.head);
    }),
  ];

  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: initial, extensions: extensions() }) });
    view.current = v;
    return () => v.destroy();
    // The editor is created once; documents are swapped through the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    replace(text, select) {
      const v = view.current!;
      const old = v.state.doc.toString();
      if (old === text) return;
      // Replace only the changed middle, so marks, folds and the cursor elsewhere stay put.
      let a = 0;
      while (a < old.length && a < text.length && old[a] === text[a]) a++;
      let b = 0;
      while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
      v.dispatch({
        changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) },
        selection: select ? { anchor: select.from, head: select.to ?? select.from } : undefined,
        scrollIntoView: !!select,
      });
    },
    load(text) {
      view.current!.setState(EditorState.create({ doc: text, extensions: extensions() }));
      callbacks.current.onChange(text);
    },
    reveal(from, to) {
      const v = view.current!;
      const len = v.state.doc.length;
      v.dispatch({ selection: { anchor: Math.min(from, len) }, effects: EditorView.scrollIntoView(Math.min(from, len), { y: 'center' }) });
      void to;
    },
    focus: () => view.current!.focus(),
    text: () => view.current!.state.doc.toString(),
  }));

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const len = v.state.doc.length;
    const list: CmDiagnostic[] = diagnostics.map((d) => {
      const from = Math.min(d.from ?? (d.line ? v.state.doc.line(Math.min(d.line, v.state.doc.lines)).from : 0), len);
      return { from, to: Math.min(Math.max(d.to ?? from, from), len), severity: d.severity, message: d.message };
    });
    v.dispatch(setDiagnostics(v.state, list));
  }, [diagnostics]);

  useEffect(() => {
    view.current?.dispatch({ effects: setMark.of(mark) });
  }, [mark?.from, mark?.to]);

  return <div className="editor" ref={host} />;
});
