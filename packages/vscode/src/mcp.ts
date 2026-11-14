// Linework's MCP server, registered with VS Code itself (VS Code 1.101 and later): Copilot's agent
// mode and every other agent in VS Code get the tools without a hand-written .vscode/mcp.json. The
// server is bundled into dist/mcp.mjs (build.mjs) and runs on the editor's own Node.js, with the
// workspace folder as its working directory, so relative paths land in the project and the live link
// (live.ts) is found for it.
import * as vscode from 'vscode';

/** The provider's id, as package.json's `mcpServerDefinitionProviders` contributes it. */
export const MCP_PROVIDER = 'linework.mcp';

/** The folder the server runs in: the first of the workspace on disk, none without one. */
export function mcpFolder(): vscode.Uri | undefined {
  return (vscode.workspace.workspaceFolders ?? []).find((f) => f.uri.scheme === 'file')?.uri;
}

/** The server as VS Code starts it. `version` changes with the extension, so VS Code reloads the tools. */
export function mcpServer(extensionUri: vscode.Uri, version: string, cwd = mcpFolder()): vscode.McpStdioServerDefinition {
  // process.execPath is the editor's Node.js (Electron run as Node), as VS Code's own docs suggest.
  const server = new vscode.McpStdioServerDefinition('Linework', process.execPath, [vscode.Uri.joinPath(extensionUri, 'dist', 'mcp.mjs').fsPath], { ELECTRON_RUN_AS_NODE: '1' }, version);
  if (cwd) server.cwd = cwd;
  return server;
}

export function registerMcp(context: vscode.ExtensionContext): vscode.Disposable {
  // Editors built on VS Code without this API (Cursor and others) set the server up by hand (docs/ai.md).
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') return new vscode.Disposable(() => {});
  const changed = new vscode.EventEmitter<void>();
  const version = String((context.extension?.packageJSON as { version?: unknown } | undefined)?.version ?? '0');
  return vscode.Disposable.from(
    changed,
    vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire()),
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER, {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: () => [mcpServer(context.extensionUri, version)],
    }),
  );
}
