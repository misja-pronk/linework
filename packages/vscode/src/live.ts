// The live link's VS Code host (core's live.ts): the user's own AI agent, through Cartography's MCP
// server, asks what is open and selected, and proposes edits that show over the preview with the
// diff marks, to accept (one undo step) or reject. A proposal for a workspace file that is not open
// opens it, with its preview, first. A small HTTP server on 127.0.0.1 with a random token, announced
// in the discovery folder so an MCP server started in this workspace finds it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { answerLive, applyOperations, parseSource, renamePinsEverywhere, yamlDiff, type LiveContext, type LiveHost, type Proposal, type ProposalResult } from '@cartography/core';
import { compare, summary } from '@cartography/diff';
import { findType } from '@cartography/engine';
import { announce } from '@cartography/mcp/discovery';
import { filesNear, readSidecar, writeSidecar } from './draw.ts';
import { scheme, type Preview } from './preview.ts';

export interface LiveSide {
  /** The preview to answer from: the active one, or the one of the active editor. */
  current(): { doc: vscode.TextDocument; preview?: Preview } | undefined;
  /** The preview of a document, opened when there is none. */
  preview(doc: vscode.TextDocument): Promise<Preview>;
}

export function startLive(side: LiveSide): vscode.Disposable {
  const token = randomBytes(24).toString('base64url');
  let forget = () => {};
  const roots = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);

  const host: LiveHost = {
    context(): LiveContext | undefined {
      const c = side.current();
      if (!c) return undefined;
      const r = c.preview?.last?.result;
      return {
        host: 'vscode',
        ...(c.doc.uri.scheme === 'file' ? { file: c.doc.uri.fsPath } : {}),
        selection: c.preview?.selection() ?? [],
        ...(r?.view ? { view: r.view } : {}),
        ...(r?.layers?.active.length ? { layers: r.layers.active } : {}),
        ...(c.preview?.step ? { step: c.preview.step } : {}),
        problems: (r?.diagnostics ?? []).map((d) => ({ severity: d.severity, message: d.message, ...(d.line ? { line: d.line } : {}) })),
        dirty: c.doc.isDirty,
      };
    },
    async propose(p: Proposal): Promise<ProposalResult> {
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === p.file) ?? (await openForProposal(p.file, roots()));
      if (typeof doc === 'string') return { outcome: 'not-open', message: doc };
      const before = doc.getText();
      const type = typeOf(before);
      if (!type) return { outcome: 'failed', message: 'The open document has no known type: line.' };
      const r = applyOperations(before, type, p.edits);
      if ('error' in r) return { outcome: 'failed', message: `On the text as it is in the editor now: ${r.error}` };
      if (r.text === before) return { outcome: 'failed', message: 'The editor already has this.' };
      const file = doc.uri.fsPath;
      const opts = { ...filesNear(file), sidecar: readSidecar(file), theme: scheme() };
      const c = await compare(before, r.text, { before: { ...opts, idPrefix: 'was' }, after: { ...opts, idPrefix: 'now' } });
      if (c.failed) return { outcome: 'failed', message: 'The change does not validate on the text as it is in the editor now.' };
      const preview = await side.preview(doc);
      const accept = await preview.propose({ summary: p.summary ?? 'A change from your AI', counts: c.diff.same ? 'Nothing drawn differently' : summary(c.diff), svg: c.picture({ against: 'now' })?.svg, lines: yamlDiff(before, r.text) });
      if (!accept) return { outcome: 'rejected' };
      // The text changed meanwhile: apply the edits to it again, or say they no longer fit.
      const now = doc.getText();
      const final = now === before ? r : applyOperations(now, type, p.edits);
      if ('error' in final) return { outcome: 'failed', message: `The user accepted, but the text changed meanwhile and the edits no longer apply: ${final.error}` };
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(now.length)), final.text);
      if (!(await vscode.workspace.applyEdit(edit))) return { outcome: 'failed', message: 'VS Code did not apply the edit.' };
      const pins = final.renames.size ? readSidecar(file) : undefined;
      if (pins) writeSidecar(file, renamePinsEverywhere(pins, final.renames));
      return { outcome: 'accepted', message: doc.isDirty ? 'Applied in the editor; on disk once the user saves.' : undefined };
    },
  };

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization === `Bearer ${token}`;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '') || !auth || req.method !== 'POST' || req.url !== '/live') {
      res.writeHead(auth ? 404 : 401).end();
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      let call: unknown;
      try {
        call = JSON.parse(body);
      } catch {
        return res.writeHead(400).end();
      }
      void answerLive(host, call).then((out) => {
        res.writeHead('error' in out ? 400 : 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      });
    });
  });
  const say = () => {
    const port = (server.address() as { port: number } | null)?.port;
    forget();
    if (port && roots().length) forget = announce({ host: 'vscode', url: `http://127.0.0.1:${port}`, token, roots: roots() });
  };
  server.listen(0, '127.0.0.1', say);
  const folders = vscode.workspace.onDidChangeWorkspaceFolders(say);
  return new vscode.Disposable(() => {
    forget();
    folders.dispose();
    server.close();
  });
}

/**
 * A file of the workspace that is not open yet, opened for a proposal: its editor (the focus stays
 * where it is, in the chat) and then its preview. Why not, in words for the agent, when it is outside
 * the workspace folders or not there.
 */
async function openForProposal(file: string, roots: string[]): Promise<vscode.TextDocument | string> {
  const inside = (root: string) => {
    const rel = path.relative(root, file);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  if (!roots.some(inside)) return `${file} is not in a folder VS Code has open${roots.length ? ` (${roots.join(', ')})` : ''}.`;
  if (!fs.existsSync(file)) return `${file} does not exist.`;
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
    return doc;
  } catch (e) {
    return `VS Code could not open ${file}: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** The type the text says it is. */
function typeOf(text: string) {
  const id = (parseSource(text).data as { type?: unknown } | undefined)?.type;
  return typeof id === 'string' ? findType(id) : undefined;
}

/**
 * A diagram written on disk by someone else (the agent's edit_diagram, git) while it is open and
 * saved: VS Code reloads it as an undoable edit; the preview shows what changed with the diff marks,
 * kept or undone in one step.
 */
export function showDiskChanges(previewOf: (doc: vscode.TextDocument) => Preview | undefined): vscode.Disposable {
  const known = new Map<string, string>();
  const remember = (doc: vscode.TextDocument) => doc.uri.scheme === 'file' && known.set(doc.uri.toString(), doc.getText());
  for (const d of vscode.workspace.textDocuments) remember(d);
  const subs = [
    vscode.workspace.onDidOpenTextDocument(remember),
    vscode.workspace.onDidSaveTextDocument(remember),
    vscode.workspace.onDidCloseTextDocument((d) => known.delete(d.uri.toString())),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = e.document;
      const before = known.get(doc.uri.toString());
      // A reload from disk leaves the document clean; typing does not.
      if (before === undefined || doc.isDirty || before === doc.getText()) return;
      remember(doc);
      const preview = previewOf(doc);
      if (!preview) return;
      const after = doc.getText();
      const file = doc.uri.fsPath;
      const opts = { ...filesNear(file), sidecar: readSidecar(file), theme: scheme() };
      void compare(before, after, { before: { ...opts, idPrefix: 'was' }, after: { ...opts, idPrefix: 'now' } }).then(async (c) => {
        const keep = await preview.propose({ summary: `${vscode.workspace.asRelativePath(doc.uri)} changed on disk`, counts: c.diff.same ? 'Nothing drawn differently' : summary(c.diff), svg: c.picture({ against: 'now' })?.svg, lines: yamlDiff(before, after), applied: true });
        if (keep || doc.getText() !== after) return;
        await vscode.window.showTextDocument(doc, { preserveFocus: false });
        await vscode.commands.executeCommand('undo');
      });
    }),
  ];
  return vscode.Disposable.from(...subs);
}
