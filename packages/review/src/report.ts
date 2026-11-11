// The review as a report to hand over: a summary per Well-Architected pillar, then per diagram its
// drawing with the findings marked and each finding written out (what, why, how to fix), and what was
// set aside with its reason. Markdown for a repo or a ticket, HTML to send (one file, light and
// dark, a crop of the drawing beside each finding), and the summary as a table for PDF pages.
import { escapeXml as esc, type Graph, type MatrixCell, type MatrixHeader, type Path, type Tone } from '@cartography/core';
import { categories, categoryLabel, severities, severityLabel, type Category, type Finding, type RuleInfo, type Severity } from './types.ts';
import { tally } from './review.ts';
import { say, t } from './nl.ts';
import type { Lang } from '@cartography/i18n';

export interface ReportDrawing {
  view?: string;
  title?: string;
  /** The drawing with the review markers on it (no appendix). */
  svg: string;
  width: number;
  height: number;
  /** Where each finding's element is in the SVG, for a crop: by finding id. */
  boxes?: Record<string, { x: number; y: number; width: number; height: number }>;
  /** For Markdown: where the picture was written, relative to the report. */
  image?: string;
}

export interface ReportFile {
  /** As the reader knows it: "azure/web-shop.yaml". */
  file: string;
  title?: string;
  type?: string;
  findings: Finding[];
  drawings: ReportDrawing[];
  /** It could not be reviewed: the YAML has errors, or the file says review: off. */
  problems: string[];
  off?: boolean;
}

export interface Report {
  title: string;
  files: ReportFile[];
  /** The rules that ran on any of the files. */
  rules: RuleInfo[];
  /** Customer rules files read, relative to where the review ran. */
  config: string[];
  packs?: string[];
  date?: Date;
  /** The language of the report's own words; findings and rules are said in their drawing's. */
  lang?: Lang;
}

/** A severity's or pillar's name, one or many ("Errors"), in the report's language. */
const sev = (l: Lang | undefined, s: Severity) => say(l, severityLabel[s]);
const sevs = (l: Lang | undefined, s: Severity) => (s === 'error' ? t(l, 'Errors') : s === 'warn' ? t(l, 'Warnings') : t(l, 'Info'));
const pillar = (l: Lang | undefined, c: Category) => say(l, categoryLabel[c]);
/** The severity's shape as on the drawing (an octagon, a triangle, a circle), inline in the page's text. */
const glyph: Record<Severity, string> = {
  error: '<svg class="g" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3.5 1h5L11 3.5v5L8.5 11h-5L1 8.5v-5Z" fill="currentColor"/><path d="M6 3.4v3.3M6 8.4v.2" stroke="var(--surface)" stroke-width="1.6" stroke-linecap="round"/></svg>',
  warn: '<svg class="g" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 .8 11.6 11H.4Z" fill="currentColor" stroke-linejoin="round"/><path d="M6 4.6v2.9M6 9.2v.2" stroke="var(--surface)" stroke-width="1.5" stroke-linecap="round"/></svg>',
  info: '<svg class="g" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5.2" fill="currentColor"/><path d="M6 5.4v3.2M6 3.4v.2" stroke="var(--surface)" stroke-width="1.5" stroke-linecap="round"/></svg>',
};
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Findings that count, over all files. */
const live = (r: Report) => r.files.flatMap((f) => f.findings.filter((x) => !x.ignored));
const ignored = (r: Report) => r.files.flatMap((f) => f.findings.filter((x) => x.ignored));

/** The report's title by default: of one diagram ("Web shop: architecture review"), or of several inputs. */
export function reportTitle(lang: Lang | undefined, one: string | undefined, inputs: string[]): string {
  return one !== undefined ? t(lang, '{name}: architecture review', { name: one }) : t(lang, 'Architecture review of {names}', { names: inputs.join(', ') });
}

/** Counts per pillar and severity. */
export function pillarTally(findings: Finding[]): { category: Category; counts: Record<Severity, number>; total: number }[] {
  return categories.map((category) => {
    const counts = tally(findings.filter((f) => f.rule.category === category));
    return { category, counts, total: counts.error + counts.warn + counts.info };
  });
}

/** One sentence: "7 findings in 3 of 5 diagrams: 1 error, 4 warnings, 2 info." */
export function summaryLine(r: Report): string {
  const all = live(r);
  const n = tally(all);
  const files = r.files.filter((f) => f.findings.some((x) => !x.ignored)).length;
  const l = r.lang;
  const aside = ignored(r).length;
  if (!all.length) return `${t(l, 'No findings in {count} diagram|No findings in {count} diagrams', { count: r.files.length })}${aside ? t(l, ' ({count} set aside)', { count: aside }) : ''}.`;
  const parts = [n.error && t(l, '{count} error|{count} errors', { count: n.error }), n.warn && t(l, '{count} warning|{count} warnings', { count: n.warn }), n.info && t(l, '{count} info', { count: n.info })].filter(Boolean).join(', ');
  return `${t(l, '{count} finding|{count} findings', { count: all.length })} ${r.files.length > 1 ? t(l, 'in {files} of {count} diagrams', { files, count: r.files.length }) : t(l, 'in the diagram')}: ${parts}${aside ? t(l, '; {count} set aside', { count: aside }) : ''}.`;
}

const where = (f: Finding, file: string) => `${file}${f.line ? `:${f.line}` : ''}`;
const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function markdownReport(r: Report): string {
  const l = r.lang;
  const out = [`# ${r.title}`, '', `${summaryLine(r)}${r.date ? t(l, ' Reviewed {date}.', { date: day(r.date) }) : ''}`, ''];
  const tallies = pillarTally(live(r)).filter((p) => p.total);
  if (tallies.length) {
    out.push(`| ${t(l, 'Pillar')} | ${sevs(l, 'error')} | ${sevs(l, 'warn')} | ${sevs(l, 'info')} |`, '| --- | ---: | ---: | ---: |');
    for (const p of tallies) out.push(`| ${pillar(l, p.category)} | ${p.counts.error || '–'} | ${p.counts.warn || '–'} | ${p.counts.info || '–'} |`);
    out.push('');
  }
  for (const file of r.files) {
    const found = file.findings.filter((x) => !x.ignored);
    out.push(`## ${file.title ? `${file.title} (${file.file})` : file.file}`, '');
    if (file.off) out.push(t(l, 'Not reviewed: the file says {off}.', { off: '`review: off`' }), '');
    for (const p of file.problems) out.push(`> ${p}`, '');
    if (!file.off && !file.problems.length && !found.length) out.push(t(l, 'No findings.'), '');
    for (const d of file.drawings) if (d.image && found.length) out.push(`![${t(l, '{title}, with the findings marked', { title: `${md(d.title ?? file.file)}${d.view ? ` (${d.view})` : ''}` })}](${d.image})`, '');
    for (const c of categories) {
      const list = found.filter((x) => x.rule.category === c);
      if (!list.length) continue;
      out.push(`### ${pillar(l, c)}`, '');
      for (const f of list) {
        out.push(`**${f.id} ${sev(l, f.severity)}: ${md(f.rule.title)}** — ${md(f.message)}  `);
        out.push(`${t(l, 'About {about}', { about: md(f.about) })}${f.view ? t(l, ' in view {view}', { view: f.view }) : ''} · \`${where(f, file.file)}\` · \`${f.rule.id}\`  `);
        out.push(`*${t(l, 'Why')}:* ${md(f.rule.why)}  `);
        out.push(`*${t(l, 'Fix')}:* ${md(f.rule.fix)}${f.rule.docs ? `  \n*${t(l, 'Read')}:* ${md(f.rule.docs)}` : ''}`, '');
      }
    }
    const aside = file.findings.filter((x) => x.ignored);
    if (aside.length) {
      out.push(`### ${t(l, 'Set aside')}`, '', `| ${t(l, 'Rule')} | ${t(l, 'About')} | ${t(l, 'Reason')} |`, '| --- | --- | --- |');
      for (const f of aside) out.push(`| \`${f.rule.id}\` | ${md(f.about)} | ${md(f.ignored!.reason ?? t(l, '(no reason given)'))} |`);
      out.push('');
    }
  }
  out.push('---', '', `${t(l, 'Rules: {count} rule|Rules: {count} rules', { count: r.rules.length })}${r.packs?.length ? t(l, ' from {packs}', { packs: r.packs.join(', ') }) : ''}${r.config.length ? t(l, '; settings from {files}', { files: r.config.join(', ') }) : ''}${t(l, '. Each rule, its reason and its fix: docs/review.md.')}`, '');
  return out.join('\n');
}


/** The SVG of a drawing ready to sit in a page more than once: ids made unique, its content in a group a crop can <use>. */
function shareable(svg: string, key: string): { full: string; ref: string } {
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  let s = svg;
  for (const id of ids) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\sid="${safe}"`, 'g'), ` id="${key}-${id}"`).replace(new RegExp(`(url\\(#|href="#)${safe}([)"])`, 'g'), `$1${key}-${id}$2`);
  }
  const ref = `${key}-drawing`;
  s = s.replace(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/, (_, attrs: string, inner: string) => `<svg${attrs} class="drawing" role="img"><g id="${ref}">${inner}</g></svg>`);
  return { full: s, ref };
}

/** One self-contained HTML page: summary, then each diagram with its drawing, findings and crops. */
export function htmlReport(r: Report): string {
  const all = live(r);
  const n = tally(all);
  const tallies = pillarTally(all);
  const l = r.lang;
  const parts: string[] = [];
  parts.push(`<header><p class="eyebrow">${t(l, 'Architecture review')}${r.date ? ` · ${day(r.date)}` : ''}</p><h1>${esc(r.title)}</h1><p class="lead">${esc(summaryLine(r))}</p></header>`);
  parts.push(
    `<section class="summary" aria-label="${t(l, 'Summary')}"><div class="tiles">${severities.map((s) => `<div class="tile sev-${s}"><span class="glyph">${glyph[s]}</span><strong>${n[s]}</strong><span>${sevs(l, s)}</span></div>`).join('')}</div>` +
      `<table class="pillars"><thead><tr><th scope="col">${t(l, 'Pillar')}</th>${severities.map((s) => `<th scope="col" class="num">${sevs(l, s)}</th>`).join('')}</tr></thead><tbody>${tallies.map((p) => `<tr${p.total ? '' : ' class="quiet"'}><th scope="row">${esc(pillar(l, p.category))}</th>${severities.map((s) => `<td class="num">${p.counts[s] || '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`,
  );
  for (const [fi, file] of r.files.entries()) {
    const found = file.findings.filter((x) => !x.ignored);
    const head = `<h2>${esc(file.title ?? file.file)}</h2><p class="file"><code>${esc(file.file)}</code>${file.type ? ` · ${esc(file.type)}` : ''} · ${found.length ? t(l, '{count} finding|{count} findings', { count: found.length }) : t(l, 'no findings')}</p>`;
    const body: string[] = [];
    if (file.off) body.push(`<p class="note">${t(l, 'Not reviewed: the file says {off}.', { off: '<code>review: off</code>' })}</p>`);
    for (const p of file.problems) body.push(`<p class="note problem">${esc(p)}</p>`);
    const shared = new Map<number, { full: string; ref: string }>();
    for (const [di, d] of file.drawings.entries()) {
      if (!found.some((f) => (f.view ?? '') === (d.view ?? ''))) continue;
      const s = shareable(d.svg, `f${fi}d${di}`);
      shared.set(di, s);
      body.push(`<figure class="whole"><div class="sheet">${s.full}</div><figcaption>${t(l, '{title}, with the findings marked', { title: `${esc(d.title ?? file.title ?? file.file)}${d.view ? t(l, ' · view {view}', { view: esc(d.view) }) : ''}` })}</figcaption></figure>`);
    }
    for (const c of categories) {
      const list = found.filter((x) => x.rule.category === c);
      if (!list.length) continue;
      body.push(`<h3>${esc(pillar(l, c))}</h3>`);
      for (const f of list) {
        const di = file.drawings.findIndex((d) => (d.view ?? '') === (f.view ?? ''));
        const d = file.drawings[di];
        const box = d?.boxes?.[f.id];
        const s = shared.get(di);
        const crop = box && s && d ? (() => {
          // Around the element with room for its neighbours, at least 320 × 180, kept inside the drawing.
          const w = Math.min(d.width, Math.max(320, box.width + 80));
          const h = Math.min(d.height, Math.max(180, box.height + 80));
          const x = Math.max(0, Math.min(d.width - w, box.x + box.width / 2 - w / 2));
          const y = Math.max(0, Math.min(d.height - h, box.y + box.height / 2 - h / 2));
          return `<div class="crop"><svg viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="${esc(t(l, '{about}, as drawn', { about: f.about }))}"><use href="#${s.ref}"/></svg></div>`;
        })() : '';
        body.push(
          `<article class="finding sev-${f.severity}" id="${esc(`${file.file}-${f.id}`)}">${crop}<div class="text">` +
            `<p class="meta"><span class="badge">${glyph[f.severity]} ${f.id} · ${sev(l, f.severity)}</span> <code>${esc(f.rule.id)}</code> <span class="at">${esc(where(f, file.file))}</span></p>` +
            `<h4>${esc(f.rule.title)}</h4><p class="what">${esc(f.message)}</p>` +
            `<dl><dt>${t(l, 'Why')}</dt><dd>${esc(f.rule.why)}</dd><dt>${t(l, 'Fix')}</dt><dd>${esc(f.rule.fix)}</dd>${f.rule.docs ? `<dt>${t(l, 'Read')}</dt><dd>${esc(f.rule.docs)}</dd>` : ''}</dl></div></article>`,
        );
      }
    }
    const aside = file.findings.filter((x) => x.ignored);
    if (aside.length)
      body.push(`<h3>${t(l, 'Set aside')}</h3><table class="aside"><thead><tr><th scope="col">${t(l, 'Rule')}</th><th scope="col">${t(l, 'About')}</th><th scope="col">${t(l, 'Reason')}</th></tr></thead><tbody>${aside.map((f) => `<tr><td><code>${esc(f.rule.id)}</code></td><td>${esc(f.about)}</td><td>${f.ignored!.reason ? esc(f.ignored!.reason) : `<em>${t(l, 'no reason given')}</em>`}</td></tr>`).join('')}</tbody></table>`);
    if (!file.off && !file.problems.length && !found.length) body.push(`<p class="note ok">${t(l, 'Nothing to report on this diagram.')}</p>`);
    parts.push(`<section class="diagram">${head}${body.join('')}</section>`);
  }
  parts.push(`<footer><p>${t(l, '{count} rule ran|{count} rules ran', { count: r.rules.length })}${r.packs?.length ? ` (${esc(r.packs.join(', '))})` : ''}${r.config.length ? t(l, ', with the settings of {files}', { files: r.config.map((c) => `<code>${esc(c)}</code>`).join(', ') }) : ''}. ${t(l, 'Made with Cartography: {command}.', { command: '<code>carto review</code>' })}</p></footer>`);
  return `<!doctype html>
<html lang="${l ?? 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.title)}</title>
<style>${CSS}</style></head><body><main>${parts.join('\n')}</main></body></html>
`;
}

const CSS = `:root{--paper:#f6f3ee;--surface:#fffdfa;--text:#24211d;--muted:#5e5850;--faint:#8a8378;--line:#e2dcd2;--ink:#b4501f;--err:#a3271f;--warn:#9a5a00;--info:#2f5d8a;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--paper:#1b1a18;--surface:#232220;--text:#ece7df;--muted:#b9b2a7;--faint:#8c857a;--line:#3a3732;--ink:#e58a55;--err:#f08378;--warn:#e7b25b;--info:#8fb8e3}.sheet{background:#fffdfa}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:40px 16px 64px}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:var(--faint);margin:0}
h1{font-size:30px;margin:4px 0 6px;font-weight:600}h2{font-size:21px;margin:0;font-weight:600}h3{text-transform:uppercase;letter-spacing:.1em;font-size:12px;color:var(--muted);margin:28px 0 8px;font-weight:600}
h4{margin:2px 0 4px;font-size:15px}.lead{color:var(--muted);margin:0 0 24px}code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace}
.summary{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:24px;align-items:start;margin-bottom:32px}
@media (max-width:720px){.summary{grid-template-columns:1fr}}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.tile{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px;display:flex;flex-direction:column}
.tile strong{font-size:28px;font-weight:600;line-height:1.1}.tile span:last-child{color:var(--muted);font-size:13px}.g{vertical-align:-1px}
.sev-error .glyph,.finding.sev-error .badge{color:var(--err)}.sev-warn .glyph,.finding.sev-warn .badge{color:var(--warn)}.sev-info .glyph,.finding.sev-info .badge{color:var(--info)}
table{border-collapse:collapse;width:100%;background:var(--surface);border:1px solid var(--line);border-radius:8px;overflow:hidden}th,td{text-align:left;padding:7px 12px;border-bottom:1px solid var(--line);font-size:14px}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums}tr.quiet{color:var(--faint)}tbody tr:last-child>*{border-bottom:0}
.diagram{border-top:1px solid var(--line);padding-top:28px;margin-top:36px}.file{color:var(--faint);margin:2px 0 16px;font-size:13px}
figure{margin:0 0 8px}.sheet{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px;overflow:auto}.sheet svg{display:block;max-width:100%;height:auto}
figcaption{font-size:12px;color:var(--faint);margin-top:6px}
.finding{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--ink);border-radius:8px;padding:14px;margin:10px 0}
.finding.sev-error{border-left-width:6px;border-left-style:double}.finding.sev-info{border-left-style:dashed}
.finding:not(:has(.crop)){grid-template-columns:1fr}@media (max-width:640px){.finding{grid-template-columns:1fr}}
.crop{background:#fffdfa;border:1px solid var(--line);border-radius:6px;overflow:hidden}.crop svg{display:block;width:100%;height:auto;max-height:200px}
.meta{margin:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12.5px;color:var(--faint)}.badge{font-weight:600}
.what{margin:0 0 8px}dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:14px}dt{color:var(--faint);text-transform:uppercase;letter-spacing:.08em;font-size:11px;padding-top:3px}dd{margin:0;color:var(--muted)}
.note{color:var(--muted)}.note.problem{color:var(--err)}footer{margin-top:48px;color:var(--faint);font-size:13px}
@media print{body{background:#fff}.finding{break-inside:avoid}}`;

/** The summary per pillar as a table drawing (rows pillars, columns severities): the first page of a PDF report. */
export function summaryGraph(r: Report): Graph {
  const all = live(r);
  const tallies = pillarTally(all);
  const tone: Record<Severity, Tone> = { error: 'rose', warn: 'amber', info: 'sky' };
  const rows: MatrixHeader[] = tallies.map((p) => ({ label: pillar(r.lang, p.category) }));
  const columns: MatrixHeader[] = severities.map((s) => ({ label: sevs(r.lang, s) }));
  const cells: (MatrixCell | undefined)[][] = tallies.map((p) => severities.map((s) => (p.counts[s] ? { text: String(p.counts[s]), tone: tone[s] } : { text: '–' })));
  const path: Path = [];
  return {
    title: r.title,
    subtitle: summaryLine(r),
    direction: 'right',
    groups: [],
    nodes: [{ id: 'summary', shape: { kind: 'matrix', corner: t(r.lang, 'Pillar'), plain: true, table: true, rows, columns, cells }, path }],
    edges: [],
    legend: [],
  };
}
