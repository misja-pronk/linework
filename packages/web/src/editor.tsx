// The YAML editor: CodeMirror 6 with schema autocomplete, problems from the render, and a
// highlight on the entry of whatever is selected in the drawing. Builder edits go through
// transactions here too, so one undo history covers typing and drawing.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, Prec, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, invertedEffects, redo, undo } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionKeymap, completionStatus, selectedCompletion } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { yaml } from '@codemirror/lang-yaml';
import { tags as t } from '@lezer/highlight';
import type { Diagnostic, LayoutSidecar } from '@cartography/core';
import { schemaCompletion } from './complete.ts';

export interface EditorHandle {
  /** Replace the document as an undoable edit (builder changes), optionally with new pins in the same step. */
  replace(text: string, opts?: { select?: { from: number; to?: number }; pins?: LayoutSidecar | null }): void;
  /** Change only the pins, as one undoable step. */
  pin(pins: LayoutSidecar | undefined): void;
  /** Load a new document with a fresh history. */
  load(text: string, pins?: LayoutSidecar): void;
  reveal(from: number, to: number): void;
  focus(): void;
  text(): string;
  undo(): boolean;
  redo(): boolean;
}

interface Props {
  initial: string;
  initialPins?: LayoutSidecar;
  diagnostics: Diagnostic[];
  /** The text the diagnostics and mark were computed for. When the document has moved on, the old
   * ones stay and CodeMirror maps them through the edits, instead of landing on the wrong characters. */
  source?: string;
  /** Range of the selected element's entry, shown as a soft band. */
  mark?: { from: number; to: number };
  onChange(text: string): void;
  onCursor(pos: number): void;
  onPins(pins: LayoutSidecar | undefined): void;
}

// Pins (dragged positions) live in the editor state with an inverse, so the one undo history
// covers typing, builder edits and moves, in the order they happened.
const setPins = StateEffect.define<{ before: LayoutSidecar | undefined; after: LayoutSidecar | undefined }>();
const pinsField = StateField.define<LayoutSidecar | undefined>({
  create: () => undefined,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPins)) value = e.value.after;
    return value;
  },
});
const pinsHistory = invertedEffects.of((tr) =>
  tr.effects.filter((e) => e.is(setPins)).map((e) => setPins.of({ before: e.value.after, after: e.value.before })),
);

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

/** The indentation Enter just put on a line: until something else is typed there, it is only a suggestion. */
const autoIndent = StateEffect.define<number | null>();
const autoIndentField = StateField.define<number | null>({
  create: () => null,
  update(line, tr) {
    for (const e of tr.effects) if (e.is(autoIndent)) return e.value;
    if (line == null || !tr.docChanged) return line;
    return null;
  },
});

/**
 * Enter keeps the indentation, goes one level deeper after "key:" (also "- key:"), and lines up with
 * the keys of a list item that is a map ("- name: x"); after a plain item ("- a -> b: text") the next
 * item starts where it did.
 */
function yamlEnter(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty) return false;
  const line = state.doc.lineAt(r.head);
  const before = line.text.slice(0, r.head - line.from);
  const indent = /^\s*/.exec(before)![0];
  const item = /^\s*- /.test(before);
  const opens = /:\s*(#.*)?$/.test(before) && !/^\s*#/.test(before);
  const mapItem = /^\s*- [\w.-]+:(\s|$)/.test(before);
  const next = opens ? indent + (item ? '    ' : '  ') : mapItem ? indent + '  ' : indent;
  view.dispatch(state.update({ changes: { from: r.head, insert: '\n' + next }, selection: { anchor: r.head + 1 + next.length }, scrollIntoView: true, userEvent: 'input' }));
  if (next) view.dispatch({ effects: autoIndent.of(line.number + 1) });
  return true;
}

/**
 * Enter with a suggestion open that is exactly the word already typed ("type: sequence"): accepting
 * it would change nothing and swallow the new line, so the suggestion closes and Enter is a new line.
 */
function enterPastTypedSuggestion(view: EditorView): boolean {
  const { state } = view;
  if (completionStatus(state) !== 'active') return false;
  const picked = selectedCompletion(state);
  const r = state.selection.main;
  if (!picked || !r.empty) return false;
  const line = state.doc.lineAt(r.head);
  const word = /[\w.-]*$/.exec(line.text.slice(0, r.head - line.from))![0];
  if (word !== picked.label || (picked.apply != null && picked.apply !== picked.label)) return false;
  closeCompletion(view);
  return yamlEnter(view);
}

/**
 * Spaces typed right after Enter on a line that only has the suggested indentation: the person indents
 * by hand, so their spaces replace the suggestion instead of adding to it (typed or pasted YAML keeps
 * its own indentation).
 */
const ownIndent = EditorView.inputHandler.of((view, from, to, text) => {
  const pending = view.state.field(autoIndentField);
  if (pending == null || !/^ +$/.test(text) || from !== to) return false;
  const line = view.state.doc.lineAt(from);
  if (line.number !== pending || line.text.trim() !== '' || from !== line.to) return false;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, selection: { anchor: line.from + text.length }, userEvent: 'input.type' });
  return true;
});

/** Tab indents as YAML does, with two spaces and never a tab: lines of a selection one level deeper,
 * at the start of a line one level, elsewhere up to the next two-space column (the line itself stays). */
function yamlTab(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  const r = state.selection.main;
  if (!r.empty && state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number) return indentMore(view);
  const line = state.doc.lineAt(r.from);
  const col = r.from - line.from;
  const spaces = ' '.repeat(2 - (col % 2));
  view.dispatch(state.update(state.replaceSelection(spaces), { scrollIntoView: true, userEvent: 'input' }));
  return true;
}

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--syn-key)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-atom)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.squareBracket, t.brace], color: 'var(--syn-punct)' },
  { tag: [t.keyword, t.typeName, t.meta], color: 'var(--syn-meta)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--ink)' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--text-faint)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
  '.cm-entry': { backgroundColor: 'var(--entry-band)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-tooltip': { border: '1px solid var(--border)', borderRadius: 'var(--radius)', backgroundColor: 'var(--surface)', boxShadow: 'var(--shadow)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '3px 10px !important' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--hover)', color: 'var(--text)' },
  '.cm-completionDetail': { color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-completionInfo': { padding: '6px 10px', maxWidth: '280px' },
  '.cm-diagnostic': { padding: '6px 10px', borderLeftWidth: '3px' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warning)', textUnderlineOffset: '3px' },
  '.cm-foldGutter span': { color: 'var(--text-faint)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
});

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ initial, initialPins, diagnostics, source, mark, onChange, onCursor, onPins }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const callbacks = useRef({ onChange, onCursor, onPins });
  callbacks.current = { onChange, onCursor, onPins };

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
    Prec.highest(keymap.of([{ key: 'Enter', run: enterPastTypedSuggestion }])),
    autocompletion({ override: [schemaCompletion], icons: false }),
    syntaxHighlighting(highlight),
    yaml(),
    markField,
    pinsField,
    pinsHistory,
    theme,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
    autoIndentField,
    ownIndent,
    // Esc then Tab (or F6) leaves the editor: CodeMirror lets the Tab after an Escape move the focus.
    keymap.of([...closeBracketsKeymap, { key: 'Enter', run: yamlEnter }, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, { key: 'Tab', run: yamlTab, shift: indentLess }]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
      if (u.startState.field(pinsField) !== u.state.field(pinsField)) callbacks.current.onPins(u.state.field(pinsField));
      if (u.selectionSet && u.view.hasFocus) callbacks.current.onCursor(u.state.selection.main.head);
    }),
  ];

  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: initial, extensions: extensions() }) });
    view.current = v;
    if (initialPins) v.dispatch({ effects: setPins.of({ before: undefined, after: initialPins }), annotations: Transaction.addToHistory.of(false) });
    return () => v.destroy();
    // The editor is created once; documents are swapped through the handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    replace(text, opts = {}) {
      const v = view.current!;
      const old = v.state.doc.toString();
      const before = v.state.field(pinsField);
      const pins = opts.pins === undefined ? undefined : [setPins.of({ before, after: opts.pins ?? undefined })];
      const select = opts.select;
      if (old === text) {
        if (pins) v.dispatch({ effects: pins, annotations: Transaction.userEvent.of('builder.pin') });
        return;
      }
      // Replace only the changed middle, so marks, folds and the cursor elsewhere stay put.
      let a = 0;
      while (a < old.length && a < text.length && old[a] === text[a]) a++;
      let b = 0;
      while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
      v.dispatch({
        changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) },
        selection: select ? { anchor: select.from, head: select.to ?? select.from } : undefined,
        scrollIntoView: !!select,
        effects: pins,
        // Not "input.type": the history never merges a builder edit with typing or another edit.
        annotations: Transaction.userEvent.of('builder'),
      });
    },
    pin(pins) {
      const v = view.current!;
      v.dispatch({ effects: setPins.of({ before: v.state.field(pinsField), after: pins }), annotations: Transaction.userEvent.of('builder.pin') });
    },
    load(text, pins) {
      const v = view.current!;
      v.setState(EditorState.create({ doc: text, extensions: extensions() }));
      v.dispatch({ effects: setPins.of({ before: undefined, after: pins }), annotations: Transaction.addToHistory.of(false) });
      callbacks.current.onChange(text);
      callbacks.current.onPins(pins);
    },
    reveal(from) {
      const v = view.current!;
      const at = Math.min(from, v.state.doc.length);
      v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    },
    focus: () => view.current!.focus(),
    text: () => view.current!.state.doc.toString(),
    undo: () => undo(view.current!),
    redo: () => redo(view.current!),
  }));

  const current = () => view.current?.state.doc.toString();

  useEffect(() => {
    const v = view.current;
    if (!v || (source != null && source !== current())) return;
    const len = v.state.doc.length;
    const list: CmDiagnostic[] = diagnostics.map((d) => {
      const from = Math.min(d.from ?? (d.line ? v.state.doc.line(Math.min(d.line, v.state.doc.lines)).from : 0), len);
      return { from, to: Math.min(Math.max(d.to ?? from, from), len), severity: d.severity, message: d.message };
    });
    v.dispatch(setDiagnostics(v.state, list));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- diagnostics arrive with the source they are of
  }, [diagnostics]);

  useEffect(() => {
    if (mark && source != null && source !== current()) return;
    view.current?.dispatch({ effects: setMark.of(mark) });
  }, [mark?.from, mark?.to, source]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="editor" ref={host} />;
});
