// carto review <file|folder…>: the architecture review rules (packages/review) over diagrams, with the
// customer's .cartography/rules.yaml or rules/*.yaml, printed like validate's problems, or written as
// a report (Markdown with pictures, one HTML file, a PDF). Exits 1 when a finding at or above
// --fail-on (error by default) is left, 2 when something could not be reviewed: made for CI.
import fs from 'node:fs';
import path from 'node:path';
import { isDiagramFile, type Box, type Placed } from '@cartography/core';
import { render, renderGraph, themes, withReview, type RenderOptions, type RenderResult } from '@cartography/engine';
import { builtInIds, emptyConfig, failing, htmlReport, markdownReport, numbered, packs, readConfig, reportTitle, review, summaryGraph, summaryLine, tally, type ConfigProblem, type Finding, type Report, type ReportDrawing, type ReportFile, type ReviewConfig, type RuleInfo, type Severity } from '@cartography/review';
import type { Drawing } from '@cartography/export';
import type { Theme } from '@cartography/theme';
import { t } from './i18n.ts';

export interface ReviewFlags {
  inputs: string[];
  packs?: string[];
  failOn?: string;
  out?: string;
  json?: boolean;
  title?: string;
  /** Render options for a file (theme, loader, fonts). */
  options(file: string): RenderOptions;
  png(svg: string, theme: Theme | undefined): Promise<Uint8Array>;
  pdf(drawings: Drawing[], theme: Theme | undefined, title: string): Promise<Uint8Array>;
  say: { red(s: string): string; yellow(s: string): string; dim(s: string): string };
}

const SKIP = new Set(['node_modules', 'dist', '.git']);
const isFolder = (f: string) => fs.existsSync(f) && fs.statSync(f).isDirectory();

/** The diagrams under a folder: YAML with type:, not blocks, contracts, snapshots or rules files. */
function diagramsIn(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || SKIP.has(e.name) || /\.snapshots$/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...diagramsIn(p));
    else if (/\.ya?ml$/i.test(e.name) && !/\.(block|odcs)\.ya?ml$/i.test(e.name) && isDiagramFile(p, fs.readFileSync(p, 'utf8'))) out.push(p);
  }
  return out;
}

/** A rules file, not a diagram that happens to sit in rules/. */
const isRulesFile = (text: string) => !/^type:\s*\S/m.test(text);

/**
 * The customer's settings for a file: from the nearest folder up from it (not past a git root) with
 * a .cartography/rules.yaml or a rules/ folder of rules files, all of them merged in that order.
 */
const configs = new Map<string, { config: ReviewConfig; problems: ConfigProblem[] }>();
export function configFor(file: string): { config: ReviewConfig; problems: ConfigProblem[] } {
  let d = path.resolve(path.dirname(file));
  for (;;) {
    const cached = configs.get(d);
    if (cached) return cached;
    const found: string[] = [];
    for (const f of ['.cartography/rules.yaml', '.cartography/rules.yml']) if (fs.existsSync(path.join(d, f))) found.push(path.join(d, f));
    const rules = path.join(d, 'rules');
    if (isFolder(rules)) for (const f of fs.readdirSync(rules).sort()) if (/\.ya?ml$/i.test(f) && isRulesFile(fs.readFileSync(path.join(rules, f), 'utf8'))) found.push(path.join(rules, f));
    if (found.length) {
      const config = emptyConfig();
      const problems: ConfigProblem[] = [];
      for (const f of found) problems.push(...readConfig(fs.readFileSync(f, 'utf8'), path.relative(process.cwd(), f) || f, builtInIds, config).problems);
      const r = { config, problems };
      configs.set(d, r);
      return r;
    }
    if (fs.existsSync(path.join(d, '.git')) || path.dirname(d) === d) {
      const r = { config: emptyConfig(), problems: [] };
      configs.set(d, r);
      return r;
    }
    d = path.dirname(d);
  }
}

/** Where a finding's element is in the SVG (the drawing's own coordinates plus its origin). */
function boxOf(f: Finding, placed: Placed, origin: { x: number; y: number }): Box | undefined {
  if (f.on.kind === 'diagram') return undefined;
  let b: Box | undefined;
  if (f.on.kind === 'node') b = placed.nodes.get(f.on.id);
  else if (f.on.kind === 'group') b = placed.groups.get(f.on.id);
  else {
    const e = placed.edges.get(f.on.id);
    const pts = [...(e?.points ?? []), ...(e?.label ? [{ x: e.label.x, y: e.label.y }, { x: e.label.x + e.label.width, y: e.label.y + e.label.height }] : [])];
    if (!pts.length && f.ends) b = placed.nodes.get(f.ends.from);
    else if (pts.length) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      b = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
  }
  return b && { x: b.x + origin.x, y: b.y + origin.y, width: b.width, height: b.height };
}

interface Reviewed {
  file: ReportFile;
  results: { r: RenderResult; findings: Finding[] }[];
  /** The rules that ran on it. */
  rules: RuleInfo[];
  failed: boolean;
}

/** One file: the diagram as written and each of its views that is a drawing, findings merged. */
async function reviewFile(file: string, flags: ReviewFlags): Promise<Reviewed> {
  const text = fs.readFileSync(file, 'utf8');
  const shown = path.relative(process.cwd(), file) || file;
  const opts = flags.options(file);
  const { config, problems: cfgProblems } = configFor(file);
  const r = await render(text, opts);
  const problems: string[] = [];
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  for (const d of errors) problems.push(`${shown}${d.line ? `:${d.line}` : ''}: ${d.message}`);
  for (const p of cfgProblems) if (p.severity === 'error') problems.push(`${p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`);
  if (!r.graph || errors.length) return { file: { file: shown, title: r.graph?.title, type: r.type?.id, findings: [], drawings: [], problems }, results: [], rules: [], failed: true };
  const drawings: RenderResult[] = [r];
  // Model views draw other parts of the same architecture; a table (a threat table, an access matrix) is not a drawing to review.
  for (const v of r.views ?? []) {
    if (v.name === r.view) continue;
    const x = await render(text, { ...opts, view: v.name });
    if (x.graph && !x.empty && !(x.graph.nodes.length === 1 && x.graph.nodes[0]!.shape.kind === 'matrix')) drawings.push(x);
  }
  // A diagram with stages is the to-be; each stage before it is reviewed too, its findings named by the stage (what the to-be has as well is said once).
  for (const st of r.stages?.slice(0, -1) ?? []) {
    const x = await render(text, { ...opts, stage: st.id });
    if (x.graph && !x.empty) drawings.push({ ...x, view: st.id });
  }
  const seen = new Set<string>();
  const results: Reviewed['results'] = [];
  const rules = new Map<string, RuleInfo>();
  let off = false;
  for (const d of drawings) {
    const out = review(text, d, { packs: flags.packs, config, load: opts.load });
    off ||= !!out.off;
    for (const x of out.rules) rules.set(x.id, x);
    for (const p of out.problems) problems.push(`${shown}${p.line ? `:${p.line}` : ''}: ${p.message}`);
    const kept = out.findings.filter((f) => {
      const key = `${f.rule.id}|${f.on.kind === 'diagram' ? '' : f.on.id}|${f.message}`;
      return !seen.has(key) && !!seen.add(key);
    });
    results.push({ r: d, findings: kept });
  }
  // Numbered once over the whole file, then each drawing keeps the numbers.
  const all = numbered(results.flatMap((x) => x.findings));
  const byKey = new Map(all.map((f) => [`${f.rule.id}|${f.view ?? ''}|${f.on.kind === 'diagram' ? '' : f.on.id}|${f.message}`, f]));
  for (const x of results) x.findings = x.findings.map((f) => byKey.get(`${f.rule.id}|${f.view ?? ''}|${f.on.kind === 'diagram' ? '' : f.on.id}|${f.message}`)!);
  return { file: { file: shown, title: r.graph.title, type: r.type?.id, findings: all, drawings: [], problems: problems.filter((p) => !p.includes('There is no review rule')), ...(off ? { off } : {}) }, results, rules: [...rules.values()], failed: false };
}

export async function reviewCommand(flags: ReviewFlags): Promise<number> {
  const { red, yellow, dim } = flags.say;
  const failOn = (flags.failOn ?? 'error') as Severity | 'never';
  if (!['error', 'warn', 'info', 'never'].includes(failOn)) return (console.error(t('--fail-on is error, warn, info or never, not "{value}"', { value: String(flags.failOn) })), 2);
  const known = packs.map((p) => p.id);
  for (const p of flags.packs ?? []) if (!known.includes(p)) return (console.error(t('There is no rule pack "{name}": {packs}', { name: p, packs: known.join(', ') })), 2);
  const inputs = flags.inputs.length ? flags.inputs : [];
  if (!inputs.length) return 2;
  const list: string[] = [];
  for (const i of inputs) {
    if (!fs.existsSync(i)) return (console.error(t('{file}: no such file or folder', { file: i })), 2);
    list.push(...(isFolder(i) ? diagramsIn(i) : [i]));
  }
  if (!list.length) return (console.error(t('{file}: no diagrams here', { file: inputs.join(', ') })), 2);

  const reviewed: Reviewed[] = [];
  const shownConfig = new Set<string>();
  for (const f of list) {
    const { config, problems } = configFor(f);
    for (const c of config.files) if (!shownConfig.has(c)) {
      shownConfig.add(c);
      for (const p of problems.filter((x) => x.file === c)) console.error(`${p.file}${p.line ? `:${p.line}:${p.column}` : ''}  ${p.severity === 'error' ? red('error') : yellow('warning')}  ${p.message}`);
    }
    reviewed.push(await reviewFile(f, flags));
  }

  const word: Record<Severity, string> = { error: red('error'), warn: yellow('warn'), info: dim('info') };
  if (!flags.json && (!flags.out || flags.out === '-'))
    for (const x of reviewed) {
      for (const p of x.file.problems) console.error(`${p}  ${red(t('cannot review'))}`);
      for (const f of x.file.findings.filter((y) => !y.ignored)) console.log(`${x.file.file}${f.line ? `:${f.line}:${f.column}` : ''}  ${word[f.severity]}  ${f.id} ${f.message}  ${dim(`${f.rule.id} · ${f.rule.category}${f.view ? ` · view ${f.view}` : ''}`)}`);
      const aside = x.file.findings.filter((y) => y.ignored).length;
      if (x.file.off) console.log(`${x.file.file} ${dim(t('review: off'))}`);
      else if (!x.failed && !x.file.findings.some((y) => !y.ignored)) console.log(`${x.file.file} ${dim(aside ? t('no findings, {count} set aside', { count: aside }) : t('no findings'))}`);
      else if (aside) console.log(`${x.file.file} ${dim(t('{count} set aside', { count: aside }))}`);
    }

  const ran = [...new Map(reviewed.flatMap((x) => x.rules).map((r) => [r.id, r])).values()];
  // The report's own words in the drawings' language when they all have the same one.
  const langs = new Set(reviewed.flatMap((x) => x.results.map(({ r }) => r.lang ?? 'en')));
  const lang = langs.size === 1 && langs.has('nl') ? ('nl' as const) : undefined;
  const title = flags.title ?? reportTitle(lang, reviewed.length === 1 ? (reviewed[0]!.file.title ?? reviewed[0]!.file.file) : undefined, inputs.map((i) => path.basename(path.resolve(i))));
  const report: Report = { title, files: reviewed.map((x) => x.file), rules: ran, config: [...shownConfig], ...(flags.packs ? { packs: flags.packs } : {}), date: new Date(), ...(lang ? { lang } : {}) };

  if (flags.json) {
    const json = JSON.stringify({ title, summary: { ...tally(report.files.flatMap((f) => f.findings)), ignored: report.files.flatMap((f) => f.findings).filter((f) => f.ignored).length }, files: report.files.map((f) => ({ file: f.file, type: f.type, problems: f.problems, findings: f.findings.map(({ rule, ...rest }) => ({ ...rest, rule: rule.id, title: rule.title, category: rule.category, fix: rule.fix })) })) }, null, 2);
    if (!flags.out || flags.out === '-') process.stdout.write(json + '\n');
    else fs.writeFileSync(flags.out, json + '\n');
  } else if (flags.out && flags.out !== '-') {
    const ext = path.extname(flags.out).slice(1).toLowerCase();
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    if (ext === 'md' || ext === 'markdown') {
      const dir = flags.out.replace(/\.(md|markdown)$/i, '') + '-files';
      for (const [i, x] of reviewed.entries()) {
        for (const { r, findings } of x.results) {
          if (!findings.some((f) => !f.ignored) || !r.svg || !r.graph || !r.placed) continue;
          const marked = withReview({ svg: r.svg, width: r.width!, height: r.height!, origin: r.origin }, r.graph, r.placed, findings, r.theme ?? themes.light, { appendix: false });
          fs.mkdirSync(dir, { recursive: true });
          const name = `${String(i + 1).padStart(2, '0')}-${path.basename(x.file.file).replace(/\.ya?ml$/, '')}${r.view ? `-${r.view}` : ''}.png`;
          fs.writeFileSync(path.join(dir, name), await flags.png(marked.svg, r.theme));
          x.file.drawings.push({ ...(r.view ? { view: r.view } : {}), title: r.graph.title, svg: '', width: marked.width, height: marked.height, image: `${path.basename(dir)}/${name}` });
        }
      }
      fs.writeFileSync(flags.out, markdownReport(report));
    } else if (ext === 'html' || ext === 'htm') {
      for (const x of reviewed)
        for (const { r, findings } of x.results) {
          if (!r.svg || !r.graph || !r.placed) continue;
          const marked = withReview({ svg: r.svg, width: r.width!, height: r.height!, origin: r.origin }, r.graph, r.placed, findings, r.theme ?? themes.light, { appendix: false });
          const boxes: ReportDrawing['boxes'] = {};
          for (const f of findings) {
            const b = f.id && boxOf(f, r.placed, r.origin ?? { x: 0, y: 0 });
            if (b) boxes[f.id] = b;
          }
          x.file.drawings.push({ ...(r.view ? { view: r.view } : {}), title: r.graph.title, svg: marked.svg, width: marked.width, height: marked.height, boxes });
        }
      fs.writeFileSync(flags.out, htmlReport(report));
    } else if (ext === 'pdf') {
      const theme = reviewed.flatMap((x) => x.results.map(({ r }) => r.theme)).find(Boolean);
      const summary = await renderGraph(summaryGraph(report), { theme: theme ?? 'light', fonts: 'none' });
      const pages: Drawing[] = [{ ...summary, name: 'summary' } as Drawing];
      for (const x of reviewed)
        for (const { r, findings } of x.results) {
          if (!r.graph || !r.placed || !findings.some((f) => !f.ignored)) continue;
          const { graph, placed } = r;
          pages.push({ ...r, name: x.file.file, annotate: (d) => withReview(d, graph, placed, findings, r.theme ?? themes.light) } as Drawing);
        }
      fs.writeFileSync(flags.out, await flags.pdf(pages, theme, title));
    } else return (console.error(t('-o {out}: a review report is .md, .html, .pdf or (with --json) .json', { out: flags.out })), 2);
    console.error(`${inputs.join(', ')} → ${flags.out}  ${dim(summaryLine(report))}`);
  }
  if (!flags.json && (!flags.out || flags.out === '-')) console.error(dim(summaryLine(report)));

  if (reviewed.some((x) => x.failed)) return 2;
  const left = failOn === 'never' ? [] : failing(report.files.flatMap((f) => f.findings), failOn);
  return left.length ? 1 : 0;
}
