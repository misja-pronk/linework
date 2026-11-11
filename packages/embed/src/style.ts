// The chrome around the drawing, inside the shadow tree: page CSS cannot reach it, and it cannot
// leak out. Colours come from the theme the diagram was drawn with (--c-*); a page can set
// --carto-border, --carto-radius, --carto-max-height and --carto-accent, or style ::part(frame).
export const css = `
:host{display:block;max-width:100%}
:host([hidden]){display:none}
*{box-sizing:border-box}
.frame{position:relative;border:1px solid var(--carto-border,var(--c-border,rgba(128,128,128,.3)));border-radius:var(--carto-radius,10px);background:var(--c-canvas,transparent);color:var(--c-text,inherit);overflow:hidden;font:13px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;--accent:var(--carto-accent,#2f6fed)}
.stage{position:relative;overflow:hidden;outline:none;max-height:var(--carto-max-height,none);touch-action:pan-x pan-y}
.stage:focus-visible::after{content:'';position:absolute;inset:2px;border:2px solid var(--accent);border-radius:calc(var(--carto-radius,10px) - 3px);pointer-events:none}
.frame[data-state=drawn] .stage{cursor:grab}
.stage[data-zoomed]{touch-action:none}
.stage[data-panning]{cursor:grabbing;user-select:none;-webkit-user-select:none}
.frame[data-state=drawn] slot,.frame[data-state=failed]:not([data-fallback]) slot{display:none}
.wait{display:none;min-height:120px;place-items:center;color:var(--c-muted,inherit);opacity:.7}
.frame[data-state=waiting]:not([data-fallback]) .wait{display:grid}
.canvas{position:absolute;inset:0}
.frame:not([data-state=drawn]) .canvas{display:none}
.canvas svg{display:block;position:absolute;left:0;top:0;transform-origin:0 0;user-select:text;-webkit-user-select:text}
.canvas text{cursor:text}
.canvas .link,.canvas .link text,.canvas a,.canvas a text{cursor:pointer}
.canvas .link{outline:none}
.canvas .link:hover{opacity:.86}
.canvas .link:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:8px}
button,select{font:inherit;color:inherit}
.tools{position:absolute;right:8px;bottom:8px;display:none;gap:4px;opacity:0;transition:opacity .15s}
.frame[data-state=drawn] .tools{display:flex}
.frame:hover .tools,.frame:focus-within .tools{opacity:1}
@media (hover:none){.tools{opacity:.85}}
.tools button,.bar button.back{width:28px;height:28px;display:grid;place-items:center;padding:0;border:1px solid var(--c-border,rgba(128,128,128,.4));border-radius:7px;background:var(--c-surface,#fff);cursor:pointer;font-size:15px;line-height:1}
.tools button:disabled{opacity:.4;cursor:default}
button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.bar{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--c-border,rgba(128,128,128,.3));min-height:42px}
.bar[hidden],.problems[hidden],.alt[hidden]{display:none}
.bar nav{min-width:0}
.bar ol{display:flex;flex-wrap:wrap;gap:2px 0;margin:0;padding:0;list-style:none}
.bar li{display:flex;align-items:center;min-width:0}
.bar li+li::before{content:'›';margin:0 6px;color:var(--c-muted,inherit);opacity:.7}
.bar li button{border:0;background:none;padding:2px 4px;border-radius:5px;cursor:pointer;color:var(--c-muted,inherit)}
.bar li button:hover{text-decoration:underline}
.bar li span{padding:2px 4px;font-weight:600}
.bar .grow{flex:1}
.bar select{max-width:50%;height:28px;padding:0 6px;border:1px solid var(--c-border,rgba(128,128,128,.4));border-radius:7px;background:var(--c-surface,#fff)}
.problems{padding:12px 14px;border-left:3px solid #d4372c;background:color-mix(in srgb,#d4372c 7%,transparent)}
.problems strong{display:block;margin-bottom:4px}
.problems ul{margin:0;padding-left:18px}
.problems li{margin:2px 0;overflow-wrap:anywhere}
.problems code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.85}
.alt{border-top:1px solid var(--c-border,rgba(128,128,128,.3));color:var(--c-muted,inherit);font-size:12.5px}
.alt:not([open]):not(:focus-within):not([data-shown]){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);border:0}
.alt summary{padding:6px 10px;cursor:pointer}
.alt summary:focus-visible{outline-offset:-3px;border-radius:7px}
.alt p{margin:4px 12px}
.alt p.head{font-weight:600;margin-top:10px}
.alt ul{margin:2px 12px 10px;padding-left:18px}
.alt strong{color:var(--c-text,inherit)}
.textlink{border:0;background:none;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer}
.frame[data-mode=dark]{--accent:var(--carto-accent,#7aa7ff)}
@media (prefers-reduced-motion:reduce){.tools{transition:none}}
@media (forced-colors:active){.stage:focus-visible::after{border-color:Highlight}.canvas .link:focus-visible,button:focus-visible,select:focus-visible,summary:focus-visible{outline-color:Highlight}}
`;
