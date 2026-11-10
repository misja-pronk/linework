// The extension's settings (package.json, contributes.configuration), read fresh each time.
import * as vscode from 'vscode';

export interface Settings {
  /** A theme that wins over the diagram's own; undefined for "auto" (VS Code's light or dark, unless the diagram names one). */
  theme?: string;
  debounce: number;
  shareBase: string;
  pngScale: number;
  diagnostics: boolean;
  yamlSchemas: boolean;
  markdown: boolean;
  presentFullScreen: boolean;
}

export function settings(): Settings {
  const c = vscode.workspace.getConfiguration('cartography');
  const theme = c.get<string>('preview.theme', 'auto');
  return {
    theme: theme && theme !== 'auto' ? theme : undefined,
    debounce: Math.max(0, c.get<number>('preview.debounce', 250)),
    shareBase: c.get<string>('shareBase', 'http://localhost:5178/'),
    pngScale: Math.min(8, Math.max(0.5, c.get<number>('export.pngScale', 2))),
    diagnostics: c.get<boolean>('diagnostics.enabled', true),
    yamlSchemas: c.get<boolean>('yamlSchemas', true),
    markdown: c.get<boolean>('markdown.enabled', true),
    presentFullScreen: c.get<boolean>('present.fullScreen', false),
  };
}
