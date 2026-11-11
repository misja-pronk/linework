// The commands: preview and present, a new diagram from a template, export (SVG, PNG, PowerPoint),
// and the share link the web editor opens.
import path from 'node:path';
import * as vscode from 'vscode';
import { SHARE_LIMIT, shareLink, withViewPins } from '@cartography/core';
import { render, type RenderResult } from '@cartography/engine';
import { toPptx } from '@cartography/export';
import { readSidecar, renderOptions, writeSidecar, type DrawAsk } from './draw.ts';
import { isDiagramDoc } from './language.ts';
import { scheme, type Preview } from './preview.ts';
import { settings } from './settings.ts';
import { typeChoices } from './types.ts';

export interface Previews {
  open(doc: vscode.TextDocument, mode: 'preview' | 'present', column?: vscode.ViewColumn): Promise<Preview>;
  of(doc: vscode.TextDocument, mode?: 'preview' | 'present'): Preview | undefined;
  /** The document of the preview in front, if one is. */
  active(): vscode.TextDocument | undefined;
}

/** The diagram a command is about: the file it was given, the editor in front, or the preview in front. */
async function target(previews: Previews, arg?: unknown): Promise<vscode.TextDocument | undefined> {
  let doc: vscode.TextDocument | undefined;
  if (arg instanceof vscode.Uri) doc = await vscode.workspace.openTextDocument(arg);
  else doc = previews.active() ?? vscode.window.activeTextEditor?.document;
  if (doc && isDiagramDoc(doc)) return doc;
  void vscode.window.showWarningMessage('Open a Cartography diagram first: a YAML file that starts with "type:", or a *.carto.yaml file.');
  return undefined;
}

const baseOf = (doc: vscode.TextDocument) => path.basename(doc.fileName).replace(/\.ya?ml$/i, '') || 'diagram';

/** Where the preview stands (view, step, focus), so an export is what is on screen. */
function askOf(doc: vscode.TextDocument, previews: Previews): DrawAsk {
  const p = previews.of(doc);
  return {
    text: doc.getText(),
    file: doc.uri.scheme === 'file' ? doc.uri.fsPath : undefined,
    view: p?.last?.result.view ?? p?.view,
    step: p?.step,
    ...(p?.focus !== undefined ? { focus: p.focus } : {}),
    // Exports look as `carto render` makes them: the diagram's theme, else light (not the editor's colours).
    scheme: 'light',
    themeOverride: settings().theme,
  };
}

async function drawFor(doc: vscode.TextDocument, previews: Previews, fonts: 'embed' | 'none'): Promise<RenderResult | undefined> {
  const ask = askOf(doc, previews);
  const r = await render(ask.text, renderOptions(ask, { fonts }));
  const error = r.diagnostics.find((d) => d.severity === 'error');
  if (!r.svg) {
    void vscode.window.showErrorMessage(`Cannot export: ${error ? `${error.line ? `line ${error.line}: ` : ''}${error.message}` : 'nothing to draw'}`);
    return undefined;
  }
  if (error) void vscode.window.showWarningMessage(`Exported with problems: ${error.message}`);
  return r;
}

async function saveAs(doc: vscode.TextDocument, suffix: string, ext: string, label: string, bytes: () => Promise<Uint8Array | string>) {
  const dir = doc.uri.scheme === 'file' ? path.dirname(doc.uri.fsPath) : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
  const to = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(dir, `${baseOf(doc)}${suffix}.${ext}`)), filters: { [label]: [ext] } });
  if (!to) return;
  const data = await bytes();
  await vscode.workspace.fs.writeFile(to, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  const open = await vscode.window.showInformationMessage(`Exported ${path.basename(to.fsPath)}`, 'Reveal');
  if (open) void vscode.commands.executeCommand('revealFileInOS', to);
}

const suffixOf = (r: RenderResult) => (r.view ? `-${r.view}` : '') + (r.step ? `-step-${String(r.step).padStart(2, '0')}` : '');

async function link(doc: vscode.TextDocument): Promise<string | undefined> {
  const url = await shareLink({ yaml: doc.getText(), name: path.basename(doc.fileName), layout: readSidecar(doc.uri.scheme === 'file' ? doc.uri.fsPath : undefined) }, settings().shareBase);
  if (url.length > SHARE_LIMIT) {
    void vscode.window.showErrorMessage(`The link would be ${Math.ceil(url.length / 1000)} kB, over the ${SHARE_LIMIT / 1000} kB a link can safely carry. Share the file itself instead.`);
    return undefined;
  }
  return url;
}

export function registerCommands(context: vscode.ExtensionContext, previews: Previews): void {
  const on = (id: string, run: (...args: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, run));

  on('cartography.showPreview', async (arg) => {
    const doc = await target(previews, arg);
    if (doc) await previews.open(doc, 'preview', vscode.ViewColumn.Beside);
  });

  on('cartography.present', async (arg) => {
    const doc = await target(previews, arg);
    if (!doc) return;
    const from = previews.of(doc);
    const p = await previews.open(doc, 'present', vscode.ViewColumn.Active);
    p.view = from?.last?.result.view ?? from?.view;
    p.focus = from?.focus;
    // A diagram with steps starts at the first.
    p.step = from?.step ?? (from?.last?.result.steps?.length ? 1 : undefined);
    p.schedule(true);
    await vscode.commands.executeCommand('workbench.action.maximizeEditorHideSidebar').then(undefined, () => vscode.commands.executeCommand('workbench.action.maximizeEditor').then(undefined, () => undefined));
    if (settings().presentFullScreen) await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
    p.panel.onDidDispose(() => {
      if (settings().presentFullScreen) void vscode.commands.executeCommand('workbench.action.toggleFullScreen');
    });
  });

  on('cartography.newDiagram', async () => {
    const items = typeChoices().map((c) => ({ label: c.label, description: c.id, detail: `${c.description}${c.detail ? ` — ${c.detail}` : ''}`, choice: c }));
    const picked = await vscode.window.showQuickPick(items, { title: 'New Cartography diagram', placeHolder: 'What do you want to draw? Type to filter (pods, who has access, roadmap…)', matchOnDescription: true, matchOnDetail: true });
    if (!picked) return;
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: picked.choice.template });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Active);
    await previews.open(doc, 'preview', vscode.ViewColumn.Beside);
  });

  on('cartography.exportSvg', async (arg) => {
    const doc = await target(previews, arg);
    const r = doc && (await drawFor(doc, previews, 'embed'));
    if (doc && r?.svg) await saveAs(doc, suffixOf(r), 'svg', 'SVG', async () => r.svg!);
  });

  on('cartography.exportPng', async (arg) => {
    const doc = await target(previews, arg);
    const r = doc && (await drawFor(doc, previews, 'embed'));
    if (!doc || !r?.svg) return;
    // The PNG is drawn by the preview's browser canvas: no native code in the extension.
    const p = previews.of(doc) ?? (await previews.open(doc, 'preview', vscode.ViewColumn.Beside));
    const k = settings().pngScale;
    await saveAs(doc, suffixOf(r), 'png', 'PNG', () => p.rasterize(r.svg!, r.width! * k, r.height! * k));
  });

  on('cartography.exportPptx', async (arg) => {
    const doc = await target(previews, arg);
    const r = doc && (await drawFor(doc, previews, 'none'));
    if (!doc || !r?.svg) return;
    const p = previews.of(doc);
    // A slide per written step (or only the step on screen), as `carto render --format pptx`; the preview, when open, gives icons a PNG fallback.
    await saveAs(doc, suffixOf(r), 'pptx', 'PowerPoint', () => toPptx([{ ...r, name: path.basename(doc.fileName) }], { theme: r.theme ?? scheme(), ...(p ? { rasterize: (svg: string, w: number, h: number) => p.rasterize(svg, w, h) } : {}) }));
  });

  on('cartography.copyShareLink', async (arg) => {
    const doc = await target(previews, arg);
    const url = doc && (await link(doc));
    if (!url) return;
    await vscode.env.clipboard.writeText(url);
    void vscode.window.showInformationMessage(`Share link copied (${Math.ceil(url.length / 100) / 10} kB). The diagram is in the link itself; opening it sends nothing to a server.`);
  });

  on('cartography.openInEditor', async (arg) => {
    const doc = await target(previews, arg);
    const url = doc && (await link(doc));
    if (url) await vscode.env.openExternal(vscode.Uri.parse(url, true));
  });

  on('cartography.clearPins', async (arg) => {
    const doc = await target(previews, arg);
    if (!doc || doc.uri.scheme !== 'file') return;
    const p = previews.of(doc);
    const view = p?.last?.result.view;
    const sidecar = readSidecar(doc.uri.fsPath);
    if (!sidecar) return void vscode.window.showInformationMessage('Nothing is pinned in this diagram');
    writeSidecar(doc.uri.fsPath, withViewPins(sidecar, view, view ? null : { version: 1, ...(sidecar.views ? { views: sidecar.views } : {}) }));
    p?.schedule(true);
  });
}
