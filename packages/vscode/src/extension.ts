// The extension's entry: previews per document, problems as you type, commands, the YAML schemas and
// the Markdown preview's ```cartography blocks. Everything is drawn here, in the extension host,
// by the engine bundled into dist/: nothing is fetched and nothing is sent anywhere. The live link
// (live.ts) listens on 127.0.0.1 only, for the user's own AI agent through the MCP server.
import * as vscode from 'vscode';
import { registerCommands, type Previews } from './commands.ts';
import { sidecarName } from './detect.ts';
import { isDiagramDoc, Language, registerYamlSchemas } from './language.ts';
import { extendMarkdownIt } from './markdown.ts';
import { Preview, type PreviewHost } from './preview.ts';
import { NoteComments } from './notes.ts';
import { showDiskChanges, startLive } from './live.ts';
import { notesPath } from '@cartography/core';
import { settings } from './settings.ts';

type Mode = 'preview' | 'present';

export function activate(context: vscode.ExtensionContext) {
  const panels = new Map<string, Preview>();
  const keyOf = (doc: vscode.TextDocument, mode: Mode) => `${mode}:${doc.uri.toString()}`;
  const ofDoc = (doc: vscode.TextDocument) => [...panels.values()].filter((p) => p.doc === doc || p.doc.uri.toString() === doc.uri.toString());

  const language = new Language((doc) => ofDoc(doc).some((p) => p.mode === 'preview'));
  context.subscriptions.push(language, vscode.languages.registerCodeActionsProvider({ language: 'yaml' }, language, { providedCodeActionKinds: Language.kinds }));

  const notes = new NoteComments();
  context.subscriptions.push(notes);
  const host: PreviewHost = {
    // The preview's drawing is the one the problems (and the review notes' lines) come from; the presenter's would only repeat them.
    drawn: (p, d) => {
      if (p.mode !== 'preview') return;
      language.drawn(p.doc, d.ask, d.result, d.version);
      notes.update(p.doc, p.file, d.result);
    },
    command: (name, doc) => {
      const id = name === 'openEditor' ? 'cartography.openInEditor' : `cartography.${name}`;
      void vscode.commands.executeCommand(id, doc.uri);
    },
  };

  const previews: Previews = {
    async open(doc, mode, column = vscode.ViewColumn.Beside) {
      const key = keyOf(doc, mode);
      const known = panels.get(key);
      if (known) {
        known.panel.reveal(column === vscode.ViewColumn.Beside ? undefined : column, mode === 'preview');
        return known;
      }
      const p = new Preview(doc, mode, context.extensionUri, host, () => {
        panels.delete(key);
        if (mode === 'preview') notes.clear(doc.uri.toString());
        // Without a preview the language side checks the document itself again.
        language.update(doc, true);
      }, column);
      panels.set(key, p);
      p.schedule(true);
      return p;
    },
    of: (doc, mode = 'preview') => panels.get(keyOf(doc, mode)),
    active: () => [...panels.values()].find((p) => p.panel.active)?.doc,
  };

  registerCommands(context, previews);

  // The live link for the user's own AI agent (live.ts): what is open and selected, and proposals.
  context.subscriptions.push(
    startLive({
      current() {
        const active = [...panels.values()].find((p) => p.panel.active && p.mode === 'preview');
        const editor = vscode.window.activeTextEditor;
        // With the focus in a chat panel, nothing is active: the preview or diagram on screen is meant.
        const doc =
          active?.doc ??
          (editor && isDiagramDoc(editor.document) ? editor.document : undefined) ??
          [...panels.values()].find((p) => p.mode === 'preview' && p.panel.visible)?.doc ??
          vscode.window.visibleTextEditors.find((e) => isDiagramDoc(e.document))?.document;
        return doc ? { doc, preview: previews.of(doc) } : undefined;
      },
      preview: (doc) => previews.open(doc, 'preview'),
    }),
    showDiskChanges((doc) => previews.of(doc)),
  );

  // Typing, opening, closing.
  for (const doc of vscode.workspace.textDocuments) language.update(doc, true);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => language.update(doc, true)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      for (const p of ofDoc(e.document)) p.schedule();
      language.update(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => language.clear(doc)),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      for (const p of ofDoc(e.textEditor.document)) p.selectionChanged(e.textEditor);
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      for (const p of panels.values()) p.schedule(true);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('cartography')) return;
      for (const p of panels.values()) p.schedule(true);
      for (const doc of vscode.workspace.textDocuments) language.update(doc, true);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => void vscode.commands.executeCommand('setContext', 'cartography.isDiagram', !!editor && isDiagramDoc(editor.document))),
  );
  void vscode.commands.executeCommand('setContext', 'cartography.isDiagram', !!vscode.window.activeTextEditor && isDiagramDoc(vscode.window.activeTextEditor.document));

  // A sidecar or notes file written elsewhere (the CLI's --stable, the web editor, git) redraws its
  // diagram; so do files a diagram includes, which is any YAML next to it.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{layout.json,notes.json,yaml,yml}');
  const changed = (uri: vscode.Uri) => {
    for (const p of panels.values()) if (p.file && p.file !== uri.fsPath && (sidecarName(p.file) === uri.fsPath || notesPath(p.file) === uri.fsPath || p.last?.result.includes?.length)) p.schedule();
  };
  context.subscriptions.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));

  void registerYamlSchemas().catch(() => false);

  return {
    extendMarkdownIt: (md: Parameters<typeof extendMarkdownIt>[0]) => extendMarkdownIt(md, { enabled: () => settings().markdown, root: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath }),
  };
}

export function deactivate() {}
