// The viewer's look: Survey's sheet on a table. Warm paper for the chrome, hairlines, small
// letterspaced capitals for headings, the mono face for kinds, ids and values, one rust accent.
// Colours come from the themes the drawings were made in, so a brand theme's page matches it.
import { mix, type Theme } from '@cartography/theme';

export interface Tokens {
  canvas: string;
  surface: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  line: string;
  paper: string;
  table: string;
  accent: string;
  /** Decisions' colour, as their markers on the drawings. */
  violet: string;
  sans: string;
  mono: string;
}

/** A theme file is the author's, but its values go into a stylesheet: colours and font stacks only, nothing that closes a rule. */
const colour = (c: string, fallback: string) => (/^(#[0-9a-f]{3,8}|[a-z]+|(rgb|hsl)a?\([\d\s.,%/]+\))$/i.test(c.trim()) ? c.trim() : fallback);
const stack = (f: string, fallback: string) => (/^[\w\s'",.-]+$/.test(f) ? f : fallback);

export function tokens(t: Theme): Tokens {
  const dark = t.mode === 'dark';
  const accent = (t as { accent?: string }).accent ?? t.tones.amber.fg;
  const k = raw(t, dark, accent);
  const safe = Object.fromEntries(Object.entries(k).map(([key, v]) => [key, key === 'sans' || key === 'mono' ? stack(v, key === 'mono' ? 'ui-monospace, monospace' : 'system-ui, sans-serif') : colour(v, dark ? '#888888' : '#777777')]));
  return safe as unknown as Tokens;
}

function raw(t: Theme, dark: boolean, accent: string): Tokens {
  return {
    canvas: t.canvas,
    surface: t.surface,
    text: t.text,
    muted: t.textMuted,
    faint: t.textFaint,
    border: t.border,
    line: mix(t.border, t.canvas, dark ? 0.55 : 0.62),
    paper: dark ? mix(t.surface, t.canvas, 0.3) : t.tones.blue.wash,
    table: dark ? mix(t.canvas, '#000000', 0.72) : mix(t.tones.blue.wash, t.border, 0.72),
    accent,
    violet: t.tones.violet.fg,
    sans: t.font.family,
    mono: t.font.mono,
  };
}

const vars = (k: Tokens) =>
  `--canvas:${k.canvas};--surface:${k.surface};--text:${k.text};--muted:${k.muted};--faint:${k.faint};--border:${k.border};--line:${k.line};--paper:${k.paper};--table:${k.table};--accent:${k.accent};--violet:${k.violet};`;

/** The page's stylesheet, with the light and the dark tokens. */
export function pageCss(light: Tokens, dark: Tokens): string {
  return `
:root{${vars(light)}--sans:${light.sans};--mono:${light.mono};color-scheme:light}
:root[data-theme=dark]{${vars(dark)}color-scheme:dark}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;height:100%}
body{background:var(--table);color:var(--text);font:14px/1.45 var(--sans);-webkit-font-smoothing:antialiased;overflow:hidden}
button{font:inherit;color:inherit}
kbd{font:500 11px/1 var(--mono);padding:2px 5px;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;color:var(--muted);background:var(--canvas)}
.caps{font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.mono{font-family:var(--mono)}
.app{display:grid;grid-template-columns:var(--side,268px) 1fr auto;grid-template-rows:52px 1fr;height:100vh;height:100dvh}
.app.no-side{--side:0px}
.top{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:0 12px 0 10px;background:var(--canvas);border-bottom:1px solid var(--line);min-width:0}
.top .title{display:flex;align-items:baseline;gap:10px;min-width:0;text-decoration:none;color:inherit;padding:4px 6px;border-radius:6px}
.top .title:hover{background:var(--paper)}
.top .title b{font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crumbs{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden;white-space:nowrap;color:var(--muted)}
.crumbs>*{overflow:hidden;text-overflow:ellipsis}
.crumbs a{color:var(--muted);text-decoration:none;padding:3px 6px;border-radius:5px}
.crumbs a:hover{color:var(--text);background:var(--paper)}
.crumbs .sep{color:var(--faint);padding:0 1px;flex:none}
.crumbs .here{color:var(--text);font-weight:500;padding:3px 6px}
.spacer{flex:1}
.btn{text-decoration:none;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 10px;border:1px solid transparent;background:none;border-radius:7px;cursor:pointer;color:var(--muted);white-space:nowrap}
.btn:hover{background:var(--paper);color:var(--text)}
.btn:focus-visible,.side a:focus-visible,.stage:focus-visible,.panel :focus-visible,.home :focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.btn svg{width:17px;height:17px;flex:none}
.btn.search{border-color:var(--line);min-width:220px;justify-content:flex-start;background:var(--paper)}
.btn.search span{flex:1;text-align:left}
.btn.primary{color:var(--canvas);background:var(--text)}
.btn.primary:hover{background:var(--text);opacity:.88;color:var(--canvas)}
.side{grid-row:2;grid-column:1;background:var(--paper);border-right:1px solid var(--line);overflow:auto;padding:14px 0 24px;min-width:0}
.no-side .side{display:none}
.side h2{margin:14px 18px 6px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.side h2:first-child{margin-top:4px}
.side a{display:flex;align-items:baseline;gap:8px;padding:5px 18px 5px 16px;border-left:2px solid transparent;color:var(--text);text-decoration:none;line-height:1.3}
.side a:hover{background:color-mix(in srgb,var(--canvas) 55%,transparent)}
.side a[aria-current]{border-left-color:var(--accent);background:var(--canvas);font-weight:500}
.side a svg{width:15px;height:15px;flex:none;align-self:center;color:var(--muted)}
.side a .n{margin-left:auto;font:11px var(--mono);color:var(--faint);flex:none}
.side a.file{font-weight:600;padding-top:8px}
.side a.sub{padding-left:30px;color:var(--muted)}
.side a.sub[aria-current]{color:var(--text)}
.side .home-link{margin-bottom:6px}
.main{grid-row:2;grid-column:2;position:relative;min-width:0;min-height:0;overflow:hidden}
.stage{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;outline:none}
.stage.panning{cursor:grabbing}
.sheet{position:absolute;left:0;top:0;transform-origin:0 0;background:var(--canvas);box-shadow:0 0 0 1px var(--line)}
.sheet svg{display:block}
.sheet [data-node],.sheet [data-group]{cursor:pointer}
.sheet .drills{cursor:zoom-in}
.sheet .carto-hl{fill:none;stroke:var(--accent);stroke-width:2.5;pointer-events:none}
.sheet .carto-hl.soft{stroke-dasharray:6 4}
.zoom{position:absolute;right:14px;bottom:14px;display:flex;background:var(--canvas);border:1px solid var(--line);border-radius:8px;overflow:hidden;z-index:2}
.zoom button{width:34px;height:32px;border:0;background:none;cursor:pointer;color:var(--muted);display:grid;place-items:center}
.zoom button:hover{background:var(--paper);color:var(--text)}
.zoom button+button{border-left:1px solid var(--line)}
.zoom svg{width:16px;height:16px}
.zoom .pct{width:auto;min-width:52px;padding:0 8px;font:12px var(--mono)}
.steps{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;max-width:min(760px,calc(100% - 160px));background:var(--canvas);border:1px solid var(--line);border-radius:10px;padding:5px;z-index:2}
.steps[hidden]{display:none}
.steps .nav{width:32px;height:32px;border:0;background:none;border-radius:7px;cursor:pointer;color:var(--muted);display:grid;place-items:center;flex:none}
.steps .nav:hover:not(:disabled){background:var(--paper);color:var(--text)}
.steps .nav:disabled{opacity:.35;cursor:default}
.steps .nav svg{width:18px;height:18px}
.steps .say{padding:2px 10px;min-width:0;flex:1}
.steps .say .caps{display:block;font-size:10.5px}
.steps .say b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.steps .say p{margin:1px 0 0;color:var(--muted);font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.steps .dots{display:flex;gap:4px;padding:0 6px;flex:none}
.steps .dots button{width:9px;height:9px;padding:0;border-radius:50%;border:1.5px solid var(--faint);background:none;cursor:pointer}
.steps .dots button[aria-current]{background:var(--accent);border-color:var(--accent)}
.steps .dots .all{border-radius:2px}
.panel{grid-row:2;grid-column:3;width:0;overflow:hidden;background:var(--canvas);border-left:1px solid var(--line);transition:width .16s ease}
.panel.open{width:340px}
.panel .in{width:340px;height:100%;overflow:auto;padding:18px 20px 28px}
.panel .head{display:flex;align-items:flex-start;gap:8px}
.panel h3{margin:4px 0 2px;font-size:18px;line-height:1.25;font-weight:600;flex:1;overflow-wrap:anywhere}
.panel .x{margin:-4px -8px 0 0}
.panel .kind{display:inline-block;font:500 11px/1 var(--mono);letter-spacing:.02em;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:4px 6px;margin:6px 6px 0 0}
.panel .desc{margin:14px 0 0;line-height:1.5;overflow-wrap:anywhere}
.panel section{margin-top:22px}
.panel section>.caps{display:block;padding-bottom:6px;margin-bottom:4px;border-bottom:1px solid var(--line)}
.panel dl{margin:0;display:grid;grid-template-columns:minmax(80px,auto) 1fr;gap:6px 14px}
.panel dt{color:var(--muted)}
.panel dd{margin:0;font:12.5px/1.5 var(--mono);overflow-wrap:anywhere}
.panel ul{list-style:none;margin:0;padding:0}
.panel li a,.panel li span.na{display:flex;gap:8px;align-items:baseline;padding:6px 8px;margin:0 -8px;border-radius:6px;color:var(--text);text-decoration:none}
.panel li a:hover{background:var(--paper)}
.panel li a small,.panel li span small{margin-left:auto;color:var(--faint);font:11px var(--mono);white-space:nowrap}
.panel li a[aria-current]{background:var(--paper)}
.panel .open-btn{margin-top:16px;width:100%;justify-content:center;height:38px}
.panel .tags{margin-top:8px;display:flex;flex-wrap:wrap;gap:4px}
.panel .tags span{font:11px var(--mono);color:var(--muted);background:var(--paper);border-radius:4px;padding:2px 6px}
.adr-status{display:inline-block;padding:1px 8px;border-radius:4px;font-size:12px;font-weight:600;border:1.5px solid var(--violet);color:var(--violet)}
.adr-status.accepted{background:var(--violet);color:var(--canvas)}
.adr-status.proposed{border-style:dashed}
.adr-status.superseded,.adr-status.deprecated,.adr-status.rejected{border-color:var(--muted);color:var(--muted);text-decoration:line-through}
.adr-text{max-width:46em;line-height:1.55}
.adr-text h2{font-size:17px;margin:26px 0 6px}
.adr-text pre{padding:10px;background:var(--canvas);border:1px solid var(--line);border-radius:6px;overflow:auto}
.adr-text blockquote{margin:8px 0;padding-left:12px;border-left:3px solid var(--line);color:var(--muted)}
.adr-where{font-size:14px}
.adr .lede .adr-status{margin-right:6px}
.adr-where a,.adr-text a,.adr td a,.adr>.wrap>a.caps{color:var(--text);text-decoration-color:var(--violet);text-underline-offset:3px}
.adr>.wrap>a.caps{display:inline-block;margin-bottom:6px;text-decoration:none}
.note{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.note:last-child{border-bottom:0}
.note .num{flex:none;width:22px;height:22px;border-radius:50%;background:var(--accent);color:var(--canvas);font:600 11px/22px var(--sans);text-align:center}
.note .body{min-width:0}
.note .meta{font-size:12px;color:var(--muted)}
.note p{margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.note .reply{margin:8px 0 0;padding-left:10px;border-left:2px solid var(--line)}
.home{position:absolute;inset:0;overflow:auto;padding:44px 48px 64px;background:var(--table)}
.home[hidden],.stage[hidden]{display:none}
.home .wrap{max-width:1180px;margin:0 auto}
.home h1{margin:6px 0 4px;font-size:30px;line-height:1.15;font-weight:600;letter-spacing:-.01em}
.home .lede{color:var(--muted);margin:0 0 6px}
.home .facts{display:flex;gap:22px;margin:18px 0 30px;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.home .facts div{font:12px var(--mono);color:var(--muted)}
.home .facts b{display:block;font:600 20px var(--sans);color:var(--text)}
.home h2{margin:34px 0 12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{display:flex;flex-direction:column;background:var(--canvas);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit}
.card:hover{border-color:var(--border)}
.card .thumb{height:180px;border-bottom:1px solid var(--line);display:grid;place-items:center;padding:12px;overflow:hidden;background:var(--canvas)}
.card .thumb svg{max-width:100%;max-height:156px;width:auto;height:auto}
.card .txt{padding:12px 14px 14px}
.card .txt b{display:block;font-weight:600}
.card .txt .caps{font-size:10.5px}
.card ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px}
.card li{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:2px 6px}
table.index{width:100%;border-collapse:collapse;background:var(--canvas);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.index th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);padding:10px 14px;border-bottom:1px solid var(--line);background:var(--paper)}
.index td{padding:8px 14px;border-bottom:1px solid var(--line);vertical-align:top}
.index tr:last-child td{border-bottom:0}
.index td.mono{font-size:12px;color:var(--muted);white-space:nowrap}
.index a{color:var(--text);text-decoration:none;font-weight:500}
.index a:hover{text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:3px}
.overlay{position:fixed;inset:0;background:color-mix(in srgb,var(--text) 22%,transparent);display:flex;justify-content:center;align-items:flex-start;padding-top:12vh;z-index:10}
.overlay[hidden]{display:none}
.dialog{width:min(620px,calc(100% - 32px));background:var(--canvas);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.dialog input{width:100%;border:0;border-bottom:1px solid var(--line);padding:16px 18px;font:16px var(--sans);background:none;color:var(--text);outline:none}
.results{max-height:52vh;overflow:auto;padding:6px}
.results .grp{padding:10px 12px 4px}
.results a{display:flex;gap:10px;align-items:baseline;padding:8px 12px;border-radius:7px;color:var(--text);text-decoration:none}
.results a[aria-selected=true]{background:var(--paper);box-shadow:inset 2px 0 0 var(--accent)}
.results a small{color:var(--muted);font:11.5px var(--mono);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50%}
.results .none{padding:18px;color:var(--muted)}
.dialog .foot{display:flex;gap:14px;padding:9px 16px;border-top:1px solid var(--line);color:var(--faint);font-size:12px}
.keys{padding:18px 22px 22px}
.keys .head{display:flex;align-items:center;justify-content:space-between;margin:-6px -8px 10px 0}
.keys h3{margin:0;font-size:16px}
.keys h3.sub{margin:20px 0 10px;font-size:13px}
.keys dt kbd+kbd{margin-left:3px}
.keys dl{display:grid;grid-template-columns:auto 1fr;gap:8px 18px;margin:0}
.keys dt{text-align:right}
.keys dd{margin:0;color:var(--muted)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.loading{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted)}
.words{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:pre-line}
.presenting .top,.presenting .side,.presenting .panel,.presenting .zoom{display:none}
.presenting.app{grid-template-columns:1fr;grid-template-rows:1fr}
.presenting .main{grid-row:1;grid-column:1}
.presenting .stage{background:var(--canvas);cursor:default}
.presenting .sheet{box-shadow:none}
.presenting .steps{bottom:28px;max-width:min(980px,calc(100% - 64px));padding:8px;border-radius:12px}
.presenting .steps .say b{font-size:19px}
.presenting .steps .say p{font-size:16px;-webkit-line-clamp:3}
.counter{position:absolute;right:20px;top:16px;font:12px var(--mono);color:var(--faint);display:none}
.presenting .counter{display:block}
.leave{position:absolute;left:16px;top:12px;display:none;z-index:3}
.presenting .leave{display:inline-flex}
noscript p{margin:40px;font:16px var(--sans)}
.print{display:none}
@media (max-width:880px){
.app{--side:0px}
.app.side-open{--side:260px}
.app.side-open .side{display:block;position:fixed;top:52px;bottom:0;left:0;width:260px;z-index:5}
.side{display:none}
.btn.search{min-width:0}
.btn.search span,.btn.search kbd,.btn span,.btn.printer{display:none}
.top{gap:2px;padding:0 6px}
.btn{padding:0 8px}
.panel.open{position:fixed;right:0;top:52px;bottom:0;width:min(340px,100vw);z-index:6}
.home{padding:28px 16px 48px}
.steps{max-width:calc(100% - 24px);bottom:58px}
.crumbs{display:none}
}
@media print{
@page{size:A4 landscape;margin:12mm}
html,body{height:auto;overflow:visible;background:#fff}
:root,:root[data-theme=dark]{${vars(light)}color-scheme:light}
.app,.overlay{display:none!important}
.print{display:block}
.print .page{break-after:page;page-break-after:always;height:184mm;display:flex;flex-direction:column}
.print .page:last-child{break-after:auto;page-break-after:auto}
.print header{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:8px}
.print header b{font-size:13px;font-weight:600}
.print header span{font-size:10px}
.print header .caps:last-child{margin-left:auto}
.print .fig{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.print .fig svg{width:100%;height:100%}
.print .cover{justify-content:center}
.print .cover h1{font-size:30px;margin:0 0 6px}
.print .cover ol{margin:24px 0 0;padding-left:20px;columns:2;font-size:12px;line-height:1.7}
}
`;
}
