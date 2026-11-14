// The extension against a stubbed `vscode` module: it activates, registers what package.json
// contributes, reports the engine's problems with their fixes, hands the YAML extension the type
// schemas and draws into a preview.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => import('./vscode-stub.ts'));
const stub = await import('./vscode-stub.ts');
const { activate } = await import('../src/extension.ts');

const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../package.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linework-vscode-'));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | undefined, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await wait(20);
  }
}

beforeAll(() => {
  stub.state.config['linework.preview.debounce'] = 0;
  stub.workspace.workspaceFolders = [{ uri: stub.Uri.file(dir) }];
  activate({ subscriptions: [], extensionUri: stub.Uri.file('/ext'), extension: { packageJSON: manifest } } as never);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('activation', () => {
  it('registers every command package.json contributes', () => {
    const contributed = manifest.contributes.commands.map((c: { command: string }) => c.command).sort();
    expect([...stub.state.commands.keys()].sort()).toEqual(contributed);
  });

  it('registers with the YAML extension and hands it the type of each diagram', () => {
    const c = stub.state.yamlContributors[0]!;
    expect(c.name).toBe('linework');
    const doc = stub.openDocument(path.join(dir, 'erd.yaml'), 'type: erd\ntables: {}\n');
    expect(c.requestSchema(doc.uri.toString())).toBe('linework://schema/erd.json');
    const plain = stub.openDocument(path.join(dir, 'ci.yaml'), 'on: push\n');
    expect(c.requestSchema(plain.uri.toString())).toBeUndefined();
    const schema = JSON.parse(c.requestSchemaContent('linework://schema/erd.json')!);
    expect(schema.properties.type.const).toBe('erd');
  });
});

describe('the MCP server for the agents in VS Code', () => {
  it('needs a VS Code that can register it', () => {
    expect(manifest.engines.vscode).toBe('^1.101.0');
    expect(manifest.devDependencies['@types/vscode']).toBe('1.101.0');
  });

  it('registers the provider package.json contributes, and activates for it', () => {
    const ids = manifest.contributes.mcpServerDefinitionProviders.map((p: { id: string }) => p.id);
    expect([...stub.state.mcpProviders.keys()]).toEqual(ids);
    expect(manifest.activationEvents).toContain(`onMcpCollection:${ids[0]}`);
  });

  it('runs the bundled server on the editor\'s Node.js in the workspace folder', async () => {
    const [server, ...more] = await stub.state.mcpProviders.get('linework.mcp')!.provideMcpServerDefinitions();
    expect(more).toEqual([]);
    expect(server).toBeInstanceOf(stub.McpStdioServerDefinition);
    expect(server).toMatchObject({ label: 'Linework', command: process.execPath, args: ['/ext/dist/mcp.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' }, version: manifest.version });
    expect(server!.cwd?.fsPath).toBe(dir);
  });

  it('follows the workspace folders', async () => {
    const provider = stub.state.mcpProviders.get('linework.mcp')!;
    let told = 0;
    provider.onDidChangeMcpServerDefinitions!(() => told++);
    const other = path.join(dir, 'other');
    stub.setWorkspaceFolders([other, dir]);
    expect(told).toBe(1);
    expect((await provider.provideMcpServerDefinitions())[0]!.cwd?.fsPath).toBe(other);
    stub.setWorkspaceFolders([]);
    expect((await provider.provideMcpServerDefinitions())[0]!.cwd).toBeUndefined();
    stub.setWorkspaceFolders([dir]);
  });

  it('leaves it to the user in an editor without the API', async () => {
    const { registerMcp } = await import('../src/mcp.ts');
    const lm = stub.lm.registerMcpServerDefinitionProvider;
    (stub.lm as { registerMcpServerDefinitionProvider?: unknown }).registerMcpServerDefinitionProvider = undefined;
    try {
      expect(() => registerMcp({ extensionUri: stub.Uri.file('/ext') } as never).dispose()).not.toThrow();
    } finally {
      stub.lm.registerMcpServerDefinitionProvider = lm;
    }
  });
});

describe('problems', () => {
  it('shows the engine messages at their lines, with quick fixes', async () => {
    const file = path.join(dir, 'shop.yaml');
    const doc = stub.openDocument(file, 'type: systems\nnodes:\n  a: { kind: apii }\n');
    const collection = stub.state.collections.find((c) => c.name === 'linework')!;
    const list = await until(() => collection.get(doc.uri)?.length ? collection.get(doc.uri) : undefined);
    const d = list.find((x) => x.message.startsWith('"kind" cannot be "apii": did you mean api?'))!;
    expect(d.range.start).toMatchObject({ line: 2, character: 7 });
    expect(d.source).toBe('linework');
    const actions = stub.state.codeActionProviders[0]!.provideCodeActions(doc, d.range, { diagnostics: [d] }) as InstanceType<typeof stub.CodeAction>[];
    expect(actions[0]!.title).toBe('Change to "api"');
    expect(actions[0]!.isPreferred).toBe(true);
    expect(actions[0]!.edit!.edits[0]!.text).toBe('api');
  });

  it('clears them when the text is right again', async () => {
    const doc = stub.state.documents.find((d) => d.fileName.endsWith('shop.yaml'))!;
    stub.changeDocument(doc, 'type: systems\nnodes:\n  a: { kind: api }\n');
    const collection = stub.state.collections.find((c) => c.name === 'linework')!;
    await until(() => (collection.get(doc.uri)?.length === 0 ? true : undefined));
  });
});

describe('preview', () => {
  it('opens a webview with a strict policy and draws into it', async () => {
    const file = path.join(dir, 'web.yaml');
    const doc = stub.openDocument(file, 'type: systems\nnodes:\n  web: { kind: client }\n  api: { kind: api }\nedges:\n  - web -> api\n');
    stub.window.activeTextEditor = { document: doc, selections: [] };
    await stub.commands.executeCommand('linework.showPreview');
    const panel = await until(() => stub.state.panels.find((p) => p.viewType === 'linework.preview'));
    // The policy is an attribute, its quotes escaped: the browser reads it unescaped.
    expect(panel.webview.html.replaceAll('&#39;', "'")).toContain("default-src 'none'");
    expect(panel.webview.html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    panel.received.fire({ type: 'ready' });
    const picture = await until(() => panel.posted.find((m) => (m as { type: string }).type === 'picture')) as { picture: { svg: string; nodes: Record<string, unknown> }; fontCss?: string; pinnable: boolean };
    expect(picture.picture.svg).toContain('data-node="web"');
    expect(picture.picture.svg).not.toContain('@font-face');
    expect(picture.fontCss).toContain('@font-face');
    expect(Object.keys(picture.picture.nodes).sort()).toEqual(['api', 'web']);
    expect(picture.pinnable).toBe(true);
  });

  it('writes a pin to the sidecar when a node is dragged, and lets it go on double-click', async () => {
    const panel = stub.state.panels.find((p) => p.viewType === 'linework.preview')!;
    panel.received.fire({ type: 'pin', kind: 'node', id: 'api', x: 400, y: 20 });
    const sidecar = path.join(dir, 'web.layout.json');
    const written = await until(() => (fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')) : undefined));
    expect(written).toEqual({ version: 1, nodes: { api: { x: 400, y: 20 } } });
    panel.received.fire({ type: 'unpin', kind: 'node', id: 'api' });
    await until(() => (!fs.existsSync(sidecar) ? true : undefined));
  });

  it('redraws as you type, keeping the place (same docKey)', async () => {
    const panel = stub.state.panels.find((p) => p.viewType === 'linework.preview')!;
    const doc = stub.state.documents.find((d) => d.fileName.endsWith('web.yaml'))!;
    const before = panel.posted.filter((m) => (m as { type: string }).type === 'picture') as { docKey: string }[];
    stub.changeDocument(doc, 'type: systems\nnodes:\n  web: { kind: client }\n  api: { kind: api }\n  db: { kind: database }\nedges:\n  - web -> api\n');
    const after = await until(() => {
      const all = panel.posted.filter((m) => (m as { type: string }).type === 'picture') as { docKey: string; picture: { nodes: Record<string, unknown> }; fontCss?: string }[];
      const last = all[all.length - 1]!;
      return all.length > before.length && 'db' in last.picture.nodes ? last : undefined;
    });
    expect(after.docKey).toBe(before[before.length - 1]!.docKey);
    // The faces went once.
    expect(after.fontCss).toBeUndefined();
  });

  it('reveals the YAML of a clicked element', async () => {
    const panel = stub.state.panels.find((p) => p.viewType === 'linework.preview')!;
    let selected: InstanceType<typeof stub.Selection> | undefined;
    const show = stub.window.showTextDocument;
    stub.window.showTextDocument = async (doc) => {
      const e = await show(doc);
      return Object.defineProperty(e, 'selection', { set: (s) => (selected = s), get: () => selected });
    };
    panel.received.fire({ type: 'reveal', kind: 'node', id: 'db' });
    const s = await until(() => selected);
    expect(s.active).toMatchObject({ line: 4, character: 2 });
    stub.window.showTextDocument = show;
  });

  it('lights up what the cursor is on', async () => {
    const panel = stub.state.panels.find((p) => p.viewType === 'linework.preview')!;
    const doc = stub.state.documents.find((d) => d.fileName.endsWith('web.yaml'))!;
    const p = new stub.Position(3, 10);
    const editor = { document: doc, selections: [new stub.Selection(p, p)] };
    stub.window.visibleTextEditors = [editor];
    stub.fireSelection({ textEditor: editor });
    const hl = await until(() => panel.posted.findLast((m) => (m as { type: string }).type === 'highlight')) as { items: unknown[] };
    expect(hl.items).toEqual([{ kind: 'node', id: 'api' }]);
  });
});
