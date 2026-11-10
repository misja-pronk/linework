// Review notes in VS Code: <name>.notes.json next to the diagram. The preview draws their numbered
// markers (draw.ts); here each thread becomes a read-only comment on the YAML line of what it is about,
// so they also list in the Comments panel. Notes are written in the web editor or in the file itself.
import * as vscode from 'vscode';
import { anchorLabel, noteNumbers, notesInView, resolveAnchor } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { readNotes } from './draw.ts';
import { elementSpans, spanOf } from './mapping.ts';

const day = (iso: string) => iso.slice(0, 16).replace('T', ' ');

export class NoteComments implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('cartography.notes', 'Cartography review notes');
  /** Per document: what was shown (to leave it be when nothing changed) and its threads. */
  private readonly shown = new Map<string, { key: string; threads: vscode.CommentThread[] }>();

  /** The threads of a drawn document, on the lines of what they are about; orphaned ones on line 1. */
  update(doc: vscode.TextDocument, file: string | undefined, result: RenderResult): void {
    const notes = readNotes(file);
    const graph = result.graph;
    const uri = doc.uri.toString();
    if (!notes || !graph) return this.clear(uri);
    const numbers = noteNumbers(notes);
    const spans = elementSpans(doc.getText(), graph);
    const items = notesInView(notes, result.view).map((t) => {
      const r = resolveAnchor(t.anchor, graph);
      const span = r.state === 'attached' ? spanOf(spans, r.kind, r.id) : undefined;
      const line = span ? doc.positionAt(span.at).line : 0;
      const about = r.state === 'orphaned' ? `${r.was} (no longer in the diagram)` : r.state === 'point' ? 'a point on the canvas' : anchorLabel(r.anchor, graph);
      return { t, line, about, n: numbers.get(t.id)! };
    });
    const key = JSON.stringify(items);
    if (this.shown.get(uri)?.key === key) return;
    this.clear(uri);
    const threads = items.map(({ t, line, about, n }) => {
      const comments: vscode.Comment[] = [t, ...(t.replies ?? [])].map((c) => ({
        body: new vscode.MarkdownString(c.text),
        mode: vscode.CommentMode.Preview,
        author: { name: c.author || 'someone' },
        label: `${day(c.created)}${c.edited ? ', edited' : ''}`,
      }));
      const thread = this.controller.createCommentThread(doc.uri, new vscode.Range(line, 0, line, 0), comments);
      thread.label = `${n}. ${about}`;
      thread.canReply = false;
      thread.state = t.status === 'resolved' ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      return thread;
    });
    this.shown.set(uri, { key, threads });
  }

  clear(uri: string): void {
    for (const t of this.shown.get(uri)?.threads ?? []) t.dispose();
    this.shown.delete(uri);
  }

  dispose(): void {
    for (const uri of [...this.shown.keys()]) this.clear(uri);
    this.controller.dispose();
  }
}
