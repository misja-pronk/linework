// The webview's page: a strict content policy (only our script, nothing from the network), the
// toolbar and the stage. The script is dist/webview.js; the drawing arrives as a message.
import type { ViewConfig } from './protocol.ts';

export interface PageParts {
  /** webview.asWebviewUri of dist/webview.js. */
  script: string;
  /** webview.cspSource. */
  cspSource: string;
  nonce: string;
  config: ViewConfig;
}

export function nonce(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const STYLE = `
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
body { background: var(--carto-canvas, var(--vscode-editor-background)); color: var(--vscode-foreground); font: 12px/1.4 var(--vscode-font-family, system-ui, sans-serif); }
#bar { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 6px; align-items: center; padding: 4px 8px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent)); z-index: 2; min-height: 26px; flex-wrap: wrap; }
#bar button, #bar select { font: inherit; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); background: var(--vscode-button-secondaryBackground, transparent); border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 2px 7px; cursor: pointer; }
#bar select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border-color: var(--vscode-dropdown-border, transparent); }
#bar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
#bar button:focus-visible, #bar select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
#bar .spacer { flex: 1; }
#bar .chip { padding: 1px 6px; border-radius: 9px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
#bar .chip.error { background: var(--vscode-inputValidation-errorBackground, #be1100); color: var(--vscode-errorForeground, #fff); }
#bar [hidden] { display: none !important; }
#bar .label { opacity: .75; }
#stage { position: absolute; inset: 0; overflow: hidden; outline: none; cursor: grab; touch-action: none; }
#bar:not([hidden]) ~ #stage { top: 35px; }
#stage.panning { cursor: grabbing; }
#paper { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
#paper svg { display: block; }
#stale { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); max-width: 80%; padding: 6px 10px; border-radius: 4px; background: var(--vscode-inputValidation-warningBackground, #352a05); color: var(--vscode-foreground); border: 1px solid var(--vscode-inputValidation-warningBorder, #b89500); z-index: 2; }
#stale[hidden], #empty[hidden] { display: none; }
#empty { position: absolute; inset: 0; display: grid; place-items: center; opacity: .7; }
[data-node], [data-group], [data-edge] { cursor: pointer; }
.pinnable [data-node] { cursor: move; }
.carto-hl { filter: drop-shadow(0 0 2px var(--vscode-focusBorder, #0078d4)) drop-shadow(0 0 5px var(--vscode-focusBorder, #0078d4)); }
.carto-dragging { opacity: .85; }
body.present #bar { display: none; }
body.present #stage { top: 0; cursor: default; }
#caption { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 24px 14px; text-align: center; background: color-mix(in srgb, var(--vscode-editor-background) 85%, transparent); z-index: 2; }
#caption[hidden] { display: none; }
#caption .t { font-weight: 600; font-size: 15px; }
#caption .c { font-size: 14px; opacity: .85; }
#caption .n { position: absolute; right: 16px; bottom: 14px; opacity: .6; }
#proposal { position: absolute; inset: 35px 0 0 0; display: flex; flex-direction: column; background: var(--vscode-editor-background); z-index: 3; }
#proposal[hidden] { display: none; }
#proposal header { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent)); }
#proposal header strong { flex: 1; }
#proposal .counts { opacity: .75; }
#proposal .body { flex: 1; overflow: auto; padding: 8px; }
#proposal .body svg { max-width: 100%; height: auto; display: block; margin: 0 auto; }
#proposal pre { margin: 0; font: 12px/1.45 var(--vscode-editor-font-family, monospace); }
#proposal pre .add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(40, 160, 70, .2)); }
#proposal pre .del { background: var(--vscode-diffEditor-removedLineBackground, rgba(200, 50, 50, .2)); }
#proposal pre .fold { opacity: .6; font-style: italic; }
#proposal footer { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent)); }
#proposal button { font: inherit; border-radius: 3px; padding: 4px 10px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
#proposal button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
#proposal button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
#proposal .fine { opacity: .7; }
`;

export function page(p: PageParts): string {
  const csp = [`default-src 'none'`, `img-src ${p.cspSource} data: blob:`, `font-src ${p.cspSource} data:`, `style-src ${p.cspSource} 'unsafe-inline'`, `script-src 'nonce-${p.nonce}'`].join('; ');
  const present = p.config.mode === 'present';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cartography</title>
<style>${STYLE}</style>
</head>
<body class="${present ? 'present' : 'preview'}" data-mode="${present ? 'present' : 'preview'}">
<div id="bar" role="toolbar" aria-label="Diagram">
  <select id="view" title="View" aria-label="View" hidden></select>
  <span id="steps" hidden><button id="prev" title="Previous step (←)" aria-label="Previous step">‹</button> <span id="stepN" class="label"></span> <button id="next" title="Next step (→)" aria-label="Next step">›</button> <button id="whole" title="The whole diagram">All</button></span>
  <span id="focusChip" class="chip" hidden></span><button id="unfocus" title="Draw everything" hidden>Clear focus</button>
  <button id="focus" title="Draw the selected element and its neighbours" hidden>Focus</button>
  <span class="spacer"></span>
  <span id="problems" class="chip error" hidden></span>
  <button id="fit" title="Fit (0)">Fit</button>
  <button id="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
  <button id="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
  <button id="present" title="Present full screen">Present</button>
  <button id="openEditor" title="Open in the Cartography web editor (as a share link)">Open in editor</button>
</div>
<div id="stage" tabindex="0" aria-label="Diagram"><div id="paper"></div></div>
<div id="empty">Drawing…</div>
<div id="stale" role="status" hidden></div>
<div id="caption" hidden><div class="t"></div><div class="c"></div><div class="n"></div></div>
<section id="proposal" role="dialog" aria-label="Proposed change" hidden>
  <header><strong id="pSummary"></strong><span id="pCounts" class="counts"></span><button id="pTab">YAML</button></header>
  <div class="body"><div id="pDrawing"></div><pre id="pYaml" hidden></pre></div>
  <footer><button id="pAccept" class="primary">Accept ⏎</button><button id="pReject">Reject Esc</button><span id="pFine" class="fine">Accept is one undo step. Pins stay.</span></footer>
</section>
<script nonce="${p.nonce}">window.cartoConfig = ${JSON.stringify(p.config).replace(/</g, '\\u003c')};</script>
<script nonce="${p.nonce}" src="${esc(p.script)}"></script>
</body>
</html>`;
}
