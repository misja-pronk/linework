// The live preview (and the presenter): a webview per document that the extension draws into as you
// type. Clicks reveal the YAML, the cursor lights up the drawing, a drag pins a node in the sidecar.
import * as vscode from 'vscode';
import type { RenderResult } from '@linework/engine';
import { draw, pinned, readSidecar, writeSidecar, type DrawAsk } from './draw.ts';
import { elementSpans, elementsAt, spanOf, type Span } from './mapping.ts';
import { nonce, page } from './webview/html.ts';
import type { FromView, ToView, ViewConfig } from './webview/protocol.ts';
import { settings } from './settings.ts';

export interface Drawing {
  ask: DrawAsk;
  result: RenderResult;
  version: number;
}

type Command = Extract<FromView, { type: 'command' }>['name'];

export interface PreviewHost {
  /** A drawing was made (the language side reuses its problems). */
  drawn(preview: Preview, d: Drawing): void;
  command(name: Command, doc: vscode.TextDocument): void;
}

export const scheme = (): 'light' | 'dark' => {
  const k = vscode.window.activeColorTheme.kind;
  return k === vscode.ColorThemeKind.Dark || k === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light';
};

export class Preview {
  readonly panel: vscode.WebviewPanel;
  view?: string;
  step?: number;
  focus?: string | null;
  last?: Drawing;
  private spans: Span[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private ready = false;
  private fontsSent = '';
  private rasters = new Map<number, (r: { png?: string; error?: string }) => void>();
  private nextRaster = 1;
  private readyWaiters: (() => void)[] = [];
  private disposables: vscode.Disposable[] = [];
  private verdict?: (accept: boolean) => void;

  constructor(
    readonly doc: vscode.TextDocument,
    readonly mode: ViewConfig['mode'],
    private readonly extensionUri: vscode.Uri,
    private readonly host: PreviewHost,
    onDispose: () => void,
    column: vscode.ViewColumn,
  ) {
    const name = doc.uri.path.split('/').pop() ?? 'diagram';
    this.panel = vscode.window.createWebviewPanel(mode === 'present' ? 'linework.present' : 'linework.preview', mode === 'present' ? `Present ${name}` : `Preview ${name}`, { viewColumn: column, preserveFocus: mode === 'preview' }, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      retainContextWhenHidden: false,
    });
    this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
    const webview = this.panel.webview;
    webview.html = page({ script: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')).toString(), cspSource: webview.cspSource, nonce: nonce(), config: { mode } });
    this.disposables.push(
      webview.onDidReceiveMessage((m: FromView) => void this.receive(m)),
      this.panel.onDidDispose(() => {
        clearTimeout(this.timer);
        for (const d of this.disposables) d.dispose();
        for (const r of this.rasters.values()) r({ error: 'The preview was closed' });
        this.verdict?.(false);
        onDispose();
      }),
      this.panel.onDidChangeViewState(() => {
        // A page that was hidden starts again from nothing: it asks with 'ready'.
        if (!this.panel.visible) this.ready = false;
      }),
    );
  }

  get file(): string | undefined {
    return this.doc.uri.scheme === 'file' ? this.doc.uri.fsPath : undefined;
  }

  get docKey(): string {
    return `${this.doc.uri.toString()}#${this.last?.result.view ?? this.view ?? ''}#${this.focus ?? ''}`;
  }

  private post(m: ToView) {
    void this.panel.webview.postMessage(m);
  }

  /** Draw again after the pause the setting says; `now` skips it (a view picked, a pin set). */
  schedule(now = false) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.redraw(), now ? 0 : settings().debounce);
  }

  ask(): DrawAsk {
    return {
      text: this.doc.getText(),
      file: this.file,
      view: this.view,
      step: this.step,
      ...(this.focus !== undefined ? { focus: this.focus } : {}),
      scheme: scheme(),
      themeOverride: settings().theme,
      stepCaption: this.mode === 'present' ? false : undefined,
    };
  }

  async redraw(): Promise<void> {
    const gen = ++this.generation;
    const ask = this.ask();
    const version = this.doc.version;
    let drawn: Awaited<ReturnType<typeof draw>>;
    try {
      drawn = await draw(ask);
    } catch (e) {
      if (gen === this.generation) this.post({ type: 'stale', errors: 1, warnings: 0, message: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (gen !== this.generation || this.panel.webview === undefined) return;
    const { result, picture, fontCss } = drawn;
    // A view that is no longer there: back to the diagram as written.
    if (this.view && result.views && !result.views.some((v) => v.name === this.view)) {
      this.view = undefined;
      return this.redraw();
    }
    const d: Drawing = { ask, result, version };
    this.host.drawn(this, d);
    const errors = result.diagnostics.filter((x) => x.severity === 'error');
    const warnings = result.diagnostics.length - errors.length;
    const message = errors[0] ? `${errors[0].line ? `line ${errors[0].line}: ` : ''}${errors[0].message}` : undefined;
    if (!picture) {
      this.post({ type: 'stale', errors: errors.length || 1, warnings, message: message ?? 'Nothing to draw' });
      return;
    }
    this.last = d;
    this.spans = result.graph ? elementSpans(ask.text, result.graph) : [];
    if (!this.ready) await this.whenReady();
    const sendFonts = picture.fonts !== this.fontsSent;
    this.fontsSent = picture.fonts;
    this.post({ type: 'picture', picture, ...(sendFonts ? { fontCss } : {}), docKey: this.docKey, errors: errors.length, warnings, message, pinnable: !!this.file && this.mode === 'preview' });
    this.selectionChanged();
  }

  private whenReady(): Promise<void> {
    return new Promise((ok) => this.readyWaiters.push(ok));
  }

  /** Light up what the cursor is on in the text. */
  selectionChanged(editor = vscode.window.visibleTextEditors.find((e) => e.document === this.doc)) {
    if (!editor || !this.last) return;
    // An edit not drawn yet moves things in the text: only light up for the text that was drawn.
    if (this.last.version !== this.doc.version) return;
    const items = editor.selections.flatMap((s) => elementsAt(this.spans, this.doc.offsetAt(s.active))).map((s) => ({ kind: s.kind, id: s.id }));
    this.post({ type: 'highlight', items });
  }

  /** What the cursor is on in the text, as the preview lights it up. */
  selection(editor = vscode.window.visibleTextEditors.find((e) => e.document === this.doc)): { kind: Span['kind']; id: string }[] {
    if (!editor || !this.last || this.last.version !== this.doc.version) return [];
    const seen = new Set<string>();
    return editor.selections.flatMap((s) => elementsAt(this.spans, this.doc.offsetAt(s.active))).flatMap((s) => (seen.has(`${s.kind}:${s.id}`) ? [] : (seen.add(`${s.kind}:${s.id}`), [{ kind: s.kind, id: s.id }])));
  }

  /** Shows a change over the drawing until the user decides: true for accept (or keep), false for reject (or undo). */
  async propose(m: Omit<Extract<ToView, { type: 'proposal' }>, 'type'>): Promise<boolean> {
    this.verdict?.(false);
    if (!this.ready) await this.whenReady();
    this.panel.reveal(undefined, false);
    this.post({ type: 'proposal', ...m });
    return new Promise((ok) => {
      this.verdict = (accept) => {
        this.verdict = undefined;
        this.post({ type: 'proposal-done' });
        ok(accept);
      };
    });
  }

  /** SVG to PNG in the webview's canvas. */
  rasterize(svg: string, width: number, height: number): Promise<Uint8Array> {
    const id = this.nextRaster++;
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => {
        this.rasters.delete(id);
        fail(new Error('The preview did not answer in time'));
      }, 30_000);
      this.rasters.set(id, (r) => {
        clearTimeout(timer);
        this.rasters.delete(id);
        if (r.png) ok(Uint8Array.from(Buffer.from(r.png, 'base64')));
        else fail(new Error(r.error ?? 'No PNG'));
      });
      const go = () => this.post({ type: 'rasterize', id, svg, width, height });
      if (this.ready) go();
      else void this.whenReady().then(go);
    });
  }

  private async receive(m: FromView) {
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.fontsSent = '';
        for (const w of this.readyWaiters.splice(0)) w();
        if (!this.last) this.schedule(true);
        else void this.redraw();
        return;
      case 'reveal':
        return this.reveal(m.kind, m.id);
      case 'pin':
      case 'unpin':
        return this.pin(m.id, m.type === 'pin' ? { x: m.x, y: m.y } : undefined);
      case 'view':
        this.view = m.name ?? undefined;
        this.step = undefined;
        return this.schedule(true);
      case 'step':
        this.step = m.n ?? undefined;
        return this.schedule(true);
      case 'focus':
        // Clearing a focus the diagram writes itself draws everything (null); clearing one asked for goes back to the diagram's.
        this.focus = m.id ?? (this.last?.result.focusWritten ? null : undefined);
        return this.schedule(true);
      case 'exit':
        return this.panel.dispose();
      case 'raster':
        return this.rasters.get(m.id)?.({ png: m.png, error: m.error });
      case 'command':
        return this.host.command(m.name, this.doc);
      case 'verdict':
        return this.verdict?.(m.accept);
    }
  }

  private async reveal(kind: Span['kind'], id: string) {
    const span = spanOf(this.spans, kind, id);
    if (!span || !this.last || this.last.version !== this.doc.version) return;
    const shown = vscode.window.visibleTextEditors.find((e) => e.document === this.doc);
    const editor = await vscode.window.showTextDocument(this.doc, { viewColumn: shown?.viewColumn ?? vscode.ViewColumn.One, preserveFocus: false });
    const at = this.doc.positionAt(span.at);
    editor.selection = new vscode.Selection(at, at);
    editor.revealRange(new vscode.Range(at, this.doc.positionAt(span.to)), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /** Writes (or with undefined lets go of) a node's pin in the sidecar, in the view drawn, as the web editor does. */
  private pin(id: string, at: { x: number; y: number } | undefined) {
    const file = this.file;
    if (!file) return;
    const sidecar = readSidecar(file);
    const next = pinned(sidecar, this.last?.result.view, id, at);
    try {
      writeSidecar(file, next);
    } catch (e) {
      void vscode.window.showErrorMessage(`Could not write the layout file: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.schedule(true);
  }

  dispose() {
    this.panel.dispose();
  }
}
