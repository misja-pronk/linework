// A small stand-in for the `vscode` module: enough of the API for the extension to activate, open
// documents, publish problems and post to a webview, with everything it did kept for the test to see.
type Listener<T> = (e: T) => unknown;

class Emitter<T> {
  listeners: Listener<T>[] = [];
  event = (l: Listener<T>) => {
    this.listeners.push(l);
    return { dispose: () => (this.listeners = this.listeners.filter((x) => x !== l)) };
  };
  fire(e: T) {
    for (const l of this.listeners) l(e);
  }
}

export class Disposable {
  static from(...all: { dispose(): void }[]) {
    return new Disposable(() => all.forEach((d) => d.dispose()));
  }
  constructor(private readonly f: () => void = () => {}) {}
  dispose() {
    this.f();
  }
}

export class Uri {
  constructor(
    readonly scheme: string,
    readonly path: string,
    readonly fragment = '',
  ) {}
  get fsPath() {
    return this.path;
  }
  static file(p: string) {
    return new Uri('file', p);
  }
  static parse(s: string) {
    const m = /^(\w[\w+.-]*):(?:\/\/)?([^#]*)(?:#(.*))?$/.exec(s);
    return m ? new Uri(m[1]!, m[1] === 'file' ? m[2]! : m[2]!, m[3] ?? '') : new Uri('file', s);
  }
  static joinPath(u: Uri, ...parts: string[]) {
    return new Uri(u.scheme, [u.path, ...parts].join('/'));
  }
  toString() {
    return this.scheme === 'file' ? `file://${this.path}` : `${this.scheme}:${this.path}${this.fragment ? `#${this.fragment}` : ''}`;
  }
  with() {
    return this;
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}
export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    this.start = typeof a === 'number' ? new Position(a, b as number) : a;
    this.end = typeof a === 'number' ? new Position(c!, d!) : (b as Position);
  }
}
export class Selection extends Range {
  constructor(
    readonly anchor: Position,
    readonly active: Position,
  ) {
    super(anchor, active);
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}
export class Diagnostic {
  source?: string;
  constructor(
    readonly range: Range,
    readonly message: string,
    readonly severity: DiagnosticSeverity,
  ) {}
}
export class CodeActionKind {
  static QuickFix = new CodeActionKind('quickfix');
  constructor(readonly value: string) {}
}
export class CodeAction {
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  constructor(
    readonly title: string,
    readonly kind: CodeActionKind,
  ) {}
}
export class WorkspaceEdit {
  edits: { uri: Uri; range: Range; text: string }[] = [];
  replace(uri: Uri, range: Range, text: string) {
    this.edits.push({ uri, range, text });
  }
}
export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
}
export enum ColorThemeKind {
  Light = 1,
  Dark = 2,
  HighContrast = 3,
  HighContrastLight = 4,
}
export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
  InCenterIfOutsideViewport = 2,
  AtTop = 3,
}

/** A text document over a string, with offsets and positions as VS Code has them. */
export class TextDocument {
  version = 1;
  constructor(
    readonly uri: Uri,
    private text: string,
    readonly languageId = 'yaml',
  ) {}
  get fileName() {
    return this.uri.fsPath;
  }
  getText() {
    return this.text;
  }
  setText(t: string) {
    this.text = t;
    this.version++;
  }
  offsetAt(p: Position) {
    const lines = this.text.split('\n');
    let o = 0;
    for (let i = 0; i < p.line; i++) o += lines[i]!.length + 1;
    return o + p.character;
  }
  positionAt(offset: number) {
    const before = this.text.slice(0, offset).split('\n');
    return new Position(before.length - 1, before[before.length - 1]!.length);
  }
}

export interface Posted {
  panel: WebviewPanel;
  message: unknown;
}

export class WebviewPanel {
  html = '';
  posted: unknown[] = [];
  visible = true;
  active = true;
  iconPath?: Uri;
  readonly received = new Emitter<unknown>();
  readonly disposed = new Emitter<void>();
  readonly viewState = new Emitter<void>();
  readonly webview = {
    cspSource: 'vscode-webview://stub',
    asWebviewUri: (u: Uri) => u,
    postMessage: async (m: unknown) => {
      this.posted.push(m);
      return true;
    },
    onDidReceiveMessage: this.received.event,
    set html(v: string) {
      panelHtml.set(this, v);
    },
    get html() {
      return panelHtml.get(this) ?? '';
    },
  };
  onDidDispose = this.disposed.event;
  onDidChangeViewState = this.viewState.event;
  constructor(
    readonly viewType: string,
    readonly title: string,
  ) {}
  reveal() {}
  dispose() {
    this.disposed.fire();
  }
}
const panelHtml = new WeakMap<object, string>();

export class DiagnosticCollection {
  map = new Map<string, Diagnostic[]>();
  constructor(readonly name: string) {}
  set(uri: Uri, list: Diagnostic[]) {
    this.map.set(uri.toString(), list);
  }
  delete(uri: Uri) {
    this.map.delete(uri.toString());
  }
  get(uri: Uri) {
    return this.map.get(uri.toString());
  }
  dispose() {}
}

export class MarkdownString {
  constructor(readonly value = '') {}
}
export enum CommentMode {
  Editing = 0,
  Preview = 1,
}
export enum CommentThreadState {
  Unresolved = 0,
  Resolved = 1,
}
export enum CommentThreadCollapsibleState {
  Collapsed = 0,
  Expanded = 1,
}
/** A comment thread as the comments API makes it; kept in state.commentThreads while not disposed. */
export class CommentThread {
  label?: string;
  canReply = true;
  state?: CommentThreadState;
  collapsibleState?: CommentThreadCollapsibleState;
  constructor(
    readonly uri: Uri,
    readonly range: Range,
    readonly comments: { body: MarkdownString; author: { name: string } }[],
  ) {}
  dispose() {
    state.commentThreads = state.commentThreads.filter((t) => t !== this);
  }
}

// What the extension did, for the test.
export const state = {
  commentThreads: [] as CommentThread[],
  commands: new Map<string, (...a: unknown[]) => unknown>(),
  executed: [] as { id: string; args: unknown[] }[],
  collections: [] as DiagnosticCollection[],
  codeActionProviders: [] as { provideCodeActions: (...a: unknown[]) => unknown }[],
  panels: [] as WebviewPanel[],
  documents: [] as TextDocument[],
  config: {} as Record<string, unknown>,
  yamlContributors: [] as { name: string; requestSchema: (r: string) => string | undefined; requestSchemaContent: (u: string) => string | undefined }[],
  yamlInstalled: true,
  messages: [] as string[],
  clipboard: '',
};

const events = {
  open: new Emitter<TextDocument>(),
  change: new Emitter<{ document: TextDocument }>(),
  close: new Emitter<TextDocument>(),
  selection: new Emitter<unknown>(),
  theme: new Emitter<unknown>(),
  config: new Emitter<{ affectsConfiguration: (s: string) => boolean }>(),
  editor: new Emitter<unknown>(),
};

/** Opens a document as VS Code would, firing the event the extension listens to. */
export function openDocument(path: string, text: string): TextDocument {
  const doc = new TextDocument(Uri.file(path), text);
  state.documents.push(doc);
  events.open.fire(doc);
  return doc;
}
export const fireSelection = (e: unknown) => events.selection.fire(e);
export function changeDocument(doc: TextDocument, text: string) {
  doc.setText(text);
  events.change.fire({ document: doc });
}

export const languages = {
  createDiagnosticCollection: (name: string) => {
    const c = new DiagnosticCollection(name);
    state.collections.push(c);
    return c;
  },
  registerCodeActionsProvider: (_sel: unknown, p: { provideCodeActions: (...a: unknown[]) => unknown }) => {
    state.codeActionProviders.push(p);
    return new Disposable();
  },
};

export const commands = {
  registerCommand: (id: string, run: (...a: unknown[]) => unknown) => {
    state.commands.set(id, run);
    return new Disposable(() => state.commands.delete(id));
  },
  executeCommand: async (id: string, ...args: unknown[]) => {
    state.executed.push({ id, args });
    const run = state.commands.get(id);
    return run ? run(...args) : undefined;
  },
};

export const workspace = {
  get textDocuments() {
    return state.documents;
  },
  workspaceFolders: undefined as undefined | { uri: Uri }[],
  onDidOpenTextDocument: events.open.event,
  onDidChangeTextDocument: events.change.event,
  onDidCloseTextDocument: events.close.event,
  onDidChangeConfiguration: events.config.event,
  onDidChangeWorkspaceFolders: () => new Disposable(),
  onDidSaveTextDocument: () => new Disposable(),
  getConfiguration: (section: string) => ({ get: <T>(key: string, fallback: T): T => (`${section}.${key}` in state.config ? (state.config[`${section}.${key}`] as T) : fallback) }),
  createFileSystemWatcher: () => ({ onDidChange: () => new Disposable(), onDidCreate: () => new Disposable(), onDidDelete: () => new Disposable(), dispose() {} }),
  openTextDocument: async (arg: Uri | { content?: string; language?: string }) => {
    if (arg instanceof Uri) return state.documents.find((d) => d.uri.toString() === arg.toString()) ?? openDocument(arg.fsPath, '');
    const doc = new TextDocument(new Uri('untitled', `Untitled-${state.documents.length + 1}`), arg.content ?? '', arg.language);
    state.documents.push(doc);
    events.open.fire(doc);
    return doc;
  },
  fs: { readFile: async () => new Uint8Array(), writeFile: async () => {} },
};

export const window = {
  activeColorTheme: { kind: ColorThemeKind.Light },
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [] as unknown[],
  onDidChangeTextEditorSelection: events.selection.event,
  onDidChangeActiveColorTheme: events.theme.event,
  onDidChangeActiveTextEditor: events.editor.event,
  createWebviewPanel: (viewType: string, title: string) => {
    const p = new WebviewPanel(viewType, title);
    state.panels.push(p);
    return p;
  },
  showTextDocument: async (doc: TextDocument) => {
    const editor = { document: doc, selection: undefined as unknown, selections: [] as Selection[], viewColumn: ViewColumn.One, revealRange: () => {} };
    return editor;
  },
  showWarningMessage: async (m: string) => void state.messages.push(m),
  showErrorMessage: async (m: string) => void state.messages.push(m),
  showInformationMessage: async (m: string) => void state.messages.push(m),
  showQuickPick: async () => undefined,
  showSaveDialog: async () => undefined,
  showOpenDialog: async () => undefined,
  createOutputChannel: () => ({ appendLine() {}, show() {} }),
};

export const comments = {
  createCommentController: () => ({
    createCommentThread: (uri: Uri, range: Range, list: CommentThread['comments']) => {
      const t = new CommentThread(uri, range, list);
      state.commentThreads.push(t);
      return t;
    },
    dispose() {},
  }),
};

export const env = {
  clipboard: { writeText: async (t: string) => void (state.clipboard = t) },
  openExternal: async () => true,
};

export const extensions = {
  getExtension: (id: string) =>
    id === 'redhat.vscode-yaml' && state.yamlInstalled
      ? {
          isActive: true,
          exports: {
            registerContributor: (name: string, requestSchema: (r: string) => string | undefined, requestSchemaContent: (u: string) => string | undefined) => {
              state.yamlContributors.push({ name, requestSchema, requestSchemaContent });
              return true;
            },
          },
        }
      : undefined,
};
