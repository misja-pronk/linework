// Problems and quick fixes from the engine (the CLI's words, at the CLI's lines), and the type
// schemas handed to the YAML extension when it is installed, for completion and hover.
import fs from 'node:fs';
import * as vscode from 'vscode';
import type { Diagnostic } from '@linework/core';
import { render } from '@linework/engine';
import { isDiagram, typeLine } from './detect.ts';
import { allDiagnostics, renderOptions, type DrawAsk } from './draw.ts';
import { toProblems, type Problem } from './problems.ts';
import { editorSchema, idOfSchemaUri, schemaUri } from './schemas.ts';
import { settings } from './settings.ts';
import { scheme } from './preview.ts';
import { typeIds } from './types.ts';

export const isDiagramDoc = (doc: vscode.TextDocument) => (doc.languageId === 'yaml' || /\.ya?ml$/i.test(doc.fileName)) && isDiagram(doc.uri.scheme === 'untitled' ? `untitled:${doc.fileName}` : doc.fileName, doc.getText(), typeIds());

export class Language implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  readonly collection = vscode.languages.createDiagnosticCollection('linework');
  private problems = new Map<string, Problem[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private generation = new Map<string, number>();

  constructor(private readonly previewed: (doc: vscode.TextDocument) => boolean) {}

  /** Checks the document after the usual pause, unless a preview draws it (that drawing reports back through `drawn`). */
  update(doc: vscode.TextDocument, now = false) {
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    if (!settings().diagnostics || !isDiagramDoc(doc)) return this.clear(doc);
    if (this.previewed(doc)) return;
    this.timers.set(
      key,
      setTimeout(() => void this.check(doc), now ? 0 : settings().debounce),
    );
  }

  private async check(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    const gen = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, gen);
    const version = doc.version;
    const ask: DrawAsk = { text: doc.getText(), file: doc.uri.scheme === 'file' ? doc.uri.fsPath : undefined, scheme: scheme() };
    try {
      const first = await render(ask.text, renderOptions(ask, { fonts: 'none' }));
      const all = await allDiagnostics(ask, first);
      if (this.generation.get(key) === gen && doc.version === version) this.publish(doc, ask.text, all);
    } catch (e) {
      if (this.generation.get(key) === gen) this.publish(doc, ask.text, [{ severity: 'error', message: `The diagram could not be drawn: ${e instanceof Error ? e.message : String(e)}` }]);
    }
  }

  /** A preview drew the document: its problems, plus those of the other views. */
  async drawn(doc: vscode.TextDocument, ask: DrawAsk, result: Parameters<typeof allDiagnostics>[1], version: number) {
    if (!settings().diagnostics) return;
    const all = await allDiagnostics(ask, result);
    if (doc.version === version) this.publish(doc, ask.text, all);
  }

  publish(doc: vscode.TextDocument, text: string, diagnostics: Diagnostic[]) {
    const problems = toProblems(text, diagnostics);
    this.problems.set(doc.uri.toString(), problems);
    this.collection.set(
      doc.uri,
      problems.map((p) => {
        const d = new vscode.Diagnostic(new vscode.Range(p.start.line, p.start.character, p.end.line, p.end.character), p.message, p.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        d.source = 'linework';
        return d;
      }),
    );
  }

  clear(doc: vscode.TextDocument) {
    this.problems.delete(doc.uri.toString());
    this.collection.delete(doc.uri);
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range | vscode.Selection, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const problems = this.problems.get(doc.uri.toString()) ?? [];
    const out: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      if (d.source !== 'linework') continue;
      const p = problems.find((x) => x.message === d.message && x.start.line === d.range.start.line && x.start.character === d.range.start.character);
      for (const f of p?.fixes ?? []) {
        const a = new vscode.CodeAction(f.title, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [d];
        a.isPreferred = !!f.preferred;
        a.edit = new vscode.WorkspaceEdit();
        a.edit.replace(doc.uri, new vscode.Range(doc.positionAt(f.from), doc.positionAt(f.to)), f.text);
        out.push(a);
      }
    }
    return out;
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.collection.dispose();
  }
}

/** The YAML extension's API, as far as it is used here. */
interface YamlApi {
  registerContributor(schema: string, requestSchema: (resource: string) => string | undefined, requestSchemaContent: (uri: string) => string | undefined, label?: string): boolean;
}

/** Hands each diagram's type schema to redhat.vscode-yaml, when it is installed and the setting is on. */
export async function registerYamlSchemas(): Promise<boolean> {
  if (!settings().yamlSchemas) return false;
  const ext = vscode.extensions.getExtension<YamlApi>('redhat.vscode-yaml');
  if (!ext) return false;
  const api = ext.isActive ? ext.exports : await ext.activate();
  if (!api?.registerContributor) return false;
  const textOf = (resource: string): { name: string; text: string } | undefined => {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === resource);
    if (open) return { name: open.fileName, text: open.getText() };
    try {
      const uri = vscode.Uri.parse(resource);
      return uri.scheme === 'file' ? { name: uri.fsPath, text: fs.readFileSync(uri.fsPath, 'utf8') } : undefined;
    } catch {
      return undefined;
    }
  };
  const cache = new Map<string, string>();
  return api.registerContributor(
    'linework',
    (resource) => {
      if (!settings().yamlSchemas) return undefined;
      const f = textOf(resource);
      if (!f || !isDiagram(f.name, f.text, typeIds())) return undefined;
      const id = typeLine(f.text);
      return id && (id === 'model' || typeIds().includes(id)) ? schemaUri(id) : undefined;
    },
    (uri) => {
      const id = idOfSchemaUri(uri);
      if (!id) return undefined;
      let s = cache.get(id);
      if (!s) {
        const schema = editorSchema(id);
        if (!schema) return undefined;
        cache.set(id, (s = JSON.stringify(schema)));
      }
      return s;
    },
    'Linework',
  );
}
