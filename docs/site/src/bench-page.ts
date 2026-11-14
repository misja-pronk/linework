// The benchmark on the site: summary tiles, small charts (one measure each, every tool) and the
// drawings that were measured, from docs/benchmark/results.json. Colours are the Survey inks, set in
// CSS so the charts follow light and dark.
import { escape } from './highlight.ts';
import type { Results, ToolId, ToolResult } from './bench.ts';

const COLOR: Record<string, string> = {
  linework: 'var(--c-linework)',
  'linework-kept': 'var(--c-linework-kept)',
  mermaid: 'var(--c-mermaid)',
  'd2-dagre': 'var(--c-dagre)',
  'd2-elk': 'var(--c-elk)',
  'd2-tala': 'var(--c-tala)',
};

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

interface Series {
  id: string;
  name: string;
  value: number;
}

/** Horizontal bars, one per tool, value at the end of the bar. */
function bars(title: string, note: string, series: Series[], format: (v: number) => string): string {
  const w = 340;
  const row = 26;
  const labelW = 118;
  const h = series.length * row + 6;
  const max = Math.max(...series.map((s) => s.value), 1e-9);
  const best = Math.min(...series.map((s) => s.value));
  const rows = series
    .map((s, i) => {
      const y = i * row + 4;
      const len = Math.max(2, ((w - labelW - 54) * s.value) / max);
      return `<text x="0" y="${y + 15}" font-size="12.5">${escape(s.name)}</text>
<rect x="${labelW}" y="${y + 4}" width="${len.toFixed(1)}" height="14" rx="2" fill="${COLOR[s.id] ?? 'var(--faint)'}"/>
<text class="val" x="${(labelW + len + 6).toFixed(1)}" y="${y + 15}" font-size="12"${s.value === best ? ' font-weight="700"' : ''}>${format(s.value)}</text>`;
    })
    .join('');
  return `<figure class="chart"><h3>${escape(title)}</h3><p>${note}</p><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(title)}: ${series.map((s) => `${s.name} ${format(s.value)}`).join(', ')}">${rows}</svg></figure>`;
}

/** One row per case, a dot per tool at its value: shows where each tool wins and loses. */
function strip(title: string, note: string, r: Results, tools: Results['tools'], pick: (x: ToolResult) => number | undefined, format: (v: number) => string): string {
  const w = 700;
  const labelW = 150;
  const row = 28;
  const h = r.cases.length * row + 26;
  const values = r.cases.flatMap((c) => tools.map((t) => pick(c.results[t.id] ?? {}))).filter((v): v is number => v != null);
  const max = Math.max(...values, 1);
  const x = (v: number) => labelW + 10 + ((w - labelW - 30) * v) / max;
  const step = max <= 6 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step).map((v) => `<line x1="${x(v)}" x2="${x(v)}" y1="0" y2="${h - 20}" stroke="var(--line-soft)"/><text x="${x(v)}" y="${h - 4}" font-size="11" text-anchor="middle">${format(v)}</text>`).join('');
  const rows = r.cases
    .map((c, i) => {
      const y = i * row + 14;
      // Tools on the same value sit side by side instead of on top of each other.
      const seen = new Map<number, number>();
      const dots = tools
        .map((t) => {
          const v = pick(c.results[t.id] ?? {});
          if (v == null) return '';
          const key = Math.round(x(v));
          const n = seen.get(key) ?? 0;
          seen.set(key, n + 1);
          const dx = n * 9;
          return `<circle cx="${(x(v) + dx).toFixed(1)}" cy="${y}" r="${t.id === 'linework' ? 5.5 : 4.5}" fill="${COLOR[t.id]}"${t.id === 'linework' ? ' stroke="var(--card)" stroke-width="1.5"' : ' opacity="0.9"'}><title>${escape(t.name)}: ${format(v)}</title></circle>`;
        })
        .join('');
      return `<line x1="${labelW + 10}" x2="${w - 20}" y1="${y}" y2="${y}" stroke="var(--line-soft)" stroke-dasharray="2 3"/><text x="0" y="${y + 4}" font-size="12.5">${escape(c.title)}</text>${dots}`;
    })
    .join('');
  return `<figure class="chart wide-chart"><h3>${escape(title)}</h3><p>${note}</p><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(title)}">${ticks}${rows}</svg>${legend(tools)}</figure>`;
}

const legend = (tools: { id: string; name: string }[]) => `<div class="legend">${tools.map((t) => `<span><i style="background:${COLOR[t.id]}"></i>${escape(t.name)}</span>`).join('')}</div>`;

const measured = (r: Results) => r.tools.filter((t) => !r.skippedTools[t.id]);

function totals(r: Results) {
  const tools = measured(r);
  const of = (id: ToolId, pick: (x: ToolResult) => number | undefined) => r.cases.map((c) => pick(c.results[id] ?? {})).filter((v): v is number => v != null);
  return { tools, of };
}

export function benchmarkCharts(r: Results): string {
  const { tools, of } = totals(r);
  const series = (pick: (x: ToolResult) => number | undefined, agg: (v: number[]) => number) => tools.map((t) => ({ id: t.id, name: t.name, value: agg(of(t.id, pick)) }));
  const int = (v: number) => String(Math.round(v));
  const disp = [...series((x) => (x.edit ? x.edit.mean * 100 : undefined), median), { id: 'linework-kept', name: 'Linework, kept', value: median(of('linework', (x) => (x.editKept ? x.editKept.mean * 100 : undefined))) }];
  const linework = r.cases.map((c) => c.results.linework);
  const lostCrossings = r.cases.filter((c) => {
    const mine = c.results.linework?.metrics?.crossings;
    const others = tools.filter((t) => t.id !== 'linework').map((t) => c.results[t.id]?.metrics?.crossings).filter((v): v is number => v != null);
    return mine != null && others.length && mine > Math.min(...others);
  });
  const tiles = [
    [int(sum(of('linework', (x) => x.metrics?.crossings))), `crossings for Linework over ${r.cases.length} diagrams; best other tool ${int(Math.min(...tools.filter((t) => t.id !== 'linework').map((t) => sum(of(t.id, (x) => x.metrics?.crossings)))))}`],
    [String(lostCrossings.length), `diagrams where another tool crosses fewer lines: ${lostCrossings.map((c) => c.title).join(', ') || 'none'}`],
    [`${median(linework.map((x) => (x?.editKept?.mean ?? 0) * 100)).toFixed(1)} %`, 'median movement after an edit when Linework keeps the drawing before (from scratch: ' + `${median(linework.map((x) => (x?.edit?.mean ?? 0) * 100)).toFixed(1)} %)`],
    [String(sum(of('linework', (x) => (x.metrics ? x.metrics.labelOverlaps + x.metrics.throughShapes + x.metrics.touches : undefined)))), 'labels on shapes, lines through shapes and touching lines, Linework, all diagrams'],
  ];
  return `<div class="summary">${tiles.map(([b, s]) => `<div><b>${b}</b><small>${escape(s!)}</small></div>`).join('')}</div>
<div class="bench-charts">
${bars('Crossings', 'Total over all diagrams. Lower is better.', series((x) => x.metrics?.crossings, sum), int)}
${bars('Bends', 'Sharp changes of direction (25° or more within 24 px), total. Gentle curves are not counted.', series((x) => x.metrics?.bends, sum), int)}
${bars('Turning', 'Median degrees a line turns, corners and curves alike.', series((x) => x.metrics?.turning, median), (v) => `${Math.round(v)}°`)}
${bars('Defects', 'Labels on shapes or labels, lines through shapes, unrelated lines touching. Total.', series((x) => (x.metrics ? x.metrics.labelOverlaps + x.metrics.throughShapes + x.metrics.touches : undefined), sum), int)}
${bars('Line length', 'Median of the mean line length per diagram, in shape sizes.', series((x) => x.metrics?.length, median), (v) => v.toFixed(2))}
${bars('White space', 'Median drawing area per shape area. Lower is tighter.', series((x) => x.metrics?.area, median), (v) => v.toFixed(1))}
${bars('Movement after an edit', 'Median movement of the shapes that were there, % of the diagonal.', disp, (v) => `${v.toFixed(1)}%`)}
</div>
${strip('Crossings per diagram', 'Each dot is a tool. Dots on the same value sit side by side.', r, tools, (x) => x.metrics?.crossings, (v) => String(Math.round(v)))}
${strip('Movement after one edit, per diagram', 'Drawn from scratch by every tool, % of the diagonal. Linework drawn knowing the drawing before is in the table below.', r, tools, (x) => (x.edit ? x.edit.mean * 100 : undefined), (v) => `${v.toFixed(0)}%`)}`;
}

/** The drawings that were measured, case by case. */
export function benchmarkDrawings(r: Results, href: (file: string) => string): string {
  const tools = measured(r);
  return `<div class="bench-drawings">${r.cases
    .map(
      (c) => `<details class="bench-case"><summary><strong>${escape(c.title)}</strong> <span>${escape(c.kind)}</span></summary><div class="bench-row">${tools
        .filter((t) => c.results[t.id]?.metrics)
        .map((t) => `<figure><img loading="lazy" src="${href(`benchmark/png/${c.id}-${t.id}.png`)}" alt="${escape(`${c.title}, drawn by ${t.name}`)}"><figcaption>${escape(t.name)}</figcaption></figure>`)
        .join('')}</div></details>`,
    )
    .join('')}</div>`;
}

/** Three numbers for the home page, with the losses next to the wins. */
export function benchmarkTeaser(r: Results): string {
  const { tools, of } = totals(r);
  const others = tools.filter((t) => t.id !== 'linework');
  const crossings = sum(of('linework', (x) => x.metrics?.crossings));
  const bestOther = others.map((t) => ({ t, v: sum(of(t.id, (x) => x.metrics?.crossings)) })).sort((a, b) => a.v - b.v)[0];
  const lost = r.cases.filter((c) => {
    const mine = c.results.linework?.metrics?.crossings;
    const o = others.map((t) => c.results[t.id]?.metrics?.crossings).filter((v): v is number => v != null);
    return mine != null && o.length && mine > Math.min(...o);
  });
  const kept = median(of('linework', (x) => (x.editKept ? x.editKept.mean * 100 : undefined)));
  const fresh = median(of('linework', (x) => (x.edit ? x.edit.mean * 100 : undefined)));
  return `<section class="band">
  <div class="band-head"><p class="eyebrow">Measured, not claimed</p><h2>The same ${r.cases.length} diagrams, five layout engines</h2><p>Linework against Mermaid and D2 (dagre, ELK, TALA), measured from each tool's own SVG. Including the cases where it loses.</p></div>
  <div class="summary">
    <div><b>${crossings}</b><small>line crossings in total for Linework; ${bestOther ? `${escape(bestOther.t.name)}, the best of the others, ${bestOther.v}` : ''}</small></div>
    <div><b>${lost.length} of ${r.cases.length}</b><small>diagrams where another tool crosses fewer lines${lost.length ? `: ${escape(lost.map((c) => c.title).join(', '))}` : ''}</small></div>
    <div><b>${kept.toFixed(1)} %</b><small>median movement after adding one shape, when the editor keeps the drawing before (${fresh.toFixed(1)} % from scratch)</small></div>
  </div>
  <p><a class="button" href="benchmark.html">The method, every number and every drawing →</a></p>
</section>`;
}
