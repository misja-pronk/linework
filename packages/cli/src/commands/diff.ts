// carto diff: two files, or files against a git ref or an editor snapshot. Words (or JSON) on stdout, the picture with -o.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as yamlText } from 'yaml';
import { accessChanges, type AccessChange, type AccessSource } from '@cartography/access';
import { compare, explain, explainMarkdown, formatDiff, snapshotDir, snapshotPath, summary, type Comparison } from '@cartography/diff';
import { repoPath, repoRoot, versionAt } from '@cartography/diff/node';
import { render, type RenderOptions } from '@cartography/engine';
import { accessOf } from '@cartography/github';
import type { DiffOptions } from '../args.ts';
import { optionsFor, themeFlag } from '../draw.ts';
import { fontScale, ttfFiles } from '../fonts.ts';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';
import { readPack } from '../packs.ts';
import { toPng } from '../png.ts';

/** Two access or GitHub diagrams as access sources (principals, scopes, roles), for who gained and lost what; undefined for any other type. */
function accessSources(before: string | undefined, after: string | undefined): { was: AccessSource; now: AccessSource } | undefined {
  const read = (text: string | undefined): AccessSource | undefined => {
    if (text === undefined) return {};
    try {
      const doc = parseYaml(text) as { type?: string } | null;
      if (doc?.type === 'access') return doc as AccessSource;
      if (doc?.type === 'github') return accessOf(doc as Parameters<typeof accessOf>[0]) as AccessSource;
    } catch {
      // Not readable: the structural diff says so.
    }
    return undefined;
  };
  const was = read(before);
  const now = read(after);
  return was && now && (before ?? after) !== undefined ? { was, now } : undefined;
}

/** The changes in words, gained first: for the terminal, and as markdown for a pull request or a report. */
function accessMarkdown(name: string, changes: AccessChange[]): string {
  const head = { gained: 'Gained', lost: 'Lost', changed: 'Changed' } as const;
  const out = [`## Access: ${name}`, ''];
  if (!changes.length) return [...out, 'Nobody gained or lost access.', ''].join('\n');
  for (const kind of ['gained', 'lost', 'changed'] as const) {
    const list = changes.filter((c) => c.kind === kind);
    if (list.length) out.push(`### ${head[kind]} (${list.length})`, '', ...list.map((c) => `- ${c.text}`), '');
  }
  return out.join('\n');
}

export async function diffCommand(ctx: Ctx, files: string[], o: DiffOptions): Promise<number> {
  const forced = themeFlag(ctx, o.theme);
  if (forced === false) return 1;
  const { red, dim, bold } = ctx;
  const optionsOf = (f: string, fonts: RenderOptions['fonts']) => optionsFor(ctx, o, f, fonts, forced);
  // --since <ref> reads as "what changed since": the same as --git.
  const ref = o.git ?? o.since;
  const snap = o.snapshot;
  if (ref || snap ? !files.length : files.length !== 2)
    return (ctx.error(ref ? t('Name the diagrams: carto diff --git <ref> <file.yaml…>') : snap ? t('Name the diagrams: carto diff --snapshot <label> <file.yaml…>') : t('Two files: carto diff <before.yaml> <after.yaml>, carto diff --git <ref> <file.yaml…> or carto diff --snapshot <label> <file.yaml…>')), 1);
  if (snap) {
    // A snapshot that is not there: say which there are.
    const missing = files.filter((f) => !fs.existsSync(snapshotPath(f, snap)));
    for (const f of missing) {
      const dir = snapshotDir(f);
      const there = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /\.ya?ml$/i.test(x)).map((x) => x.replace(/\.ya?ml$/i, '')) : [];
      ctx.error(`${f}  ${red(t('error'))}  ${there.length ? t('no snapshot "{label}" ({path}); there are: {list}', { label: snap, path: snapshotPath(f, snap), list: there.join(', ') }) : t('no snapshot "{label}" ({path}); take one in the editor with ⇧⌘S', { label: snap, path: snapshotPath(f, snap) })}`);
    }
    if (missing.length) return 1;
  }
  const ext = o.out ? path.extname(o.out).slice(1).toLowerCase() : '';
  const format = ext === 'png' || ext === 'svg' ? ext : o.format === 'png' ? 'png' : 'svg';
  const fonts: RenderOptions['fonts'] = format === 'svg' && !o['no-fonts'] ? 'embed' : 'none';
  const disk = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined);
  const markdown = ext === 'md';
  let root = '';
  if (ref) {
    try {
      root = repoRoot(process.cwd());
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
    } catch {
      return (ctx.error(root ? t('"{ref}" is not a commit, branch or tag here', { ref }) : t('carto diff --git needs a git repository')), 1);
    }
  }
  const pairs = snap
    ? files.map((f) => {
        const file = snapshotPath(f, snap);
        // Read as the diagram itself would be: includes from beside it, pins from beside the snapshot.
        return { name: f, against: `snapshot ${snap}`, before: disk(file), beforeOptions: { ...optionsOf(f, fonts), sidecar: ctx.sidecarFor(file) }, after: disk(f), afterFile: f };
      })
    : ref
    ? files.map((f) => {
        const old = versionAt(root, ref, repoPath(root, process.cwd(), f));
        return { name: f, against: ref, before: old.text, beforeOptions: { ...old.options, themeOverride: forced, fontScale, packs: o.pack, pack: readPack, fonts }, after: disk(f), afterFile: f };
      })
    : [{ name: files[1]!, against: path.basename(files[0]!), before: disk(files[0]!), beforeOptions: optionsOf(files[0]!, fonts), after: disk(files[1]!), afterFile: files[1]! }];

  let ok = true;
  let changed = false;
  const json: unknown[] = [];
  for (const p of pairs) {
    if (p.before === undefined && p.after === undefined) {
      ctx.error(`${p.name}  ${red(t('error'))}  ${ref ? t('not found, here or in {ref}', { ref }) : t('not found')}`);
      ok = false;
      continue;
    }
    // Access and GitHub: who gained and lost what, and with --view access the who × where matrix marked with it.
    const sources = accessSources(p.before, p.after);
    const changes = sources && accessChanges(sources.was, sources.now);
    const matrix = o.view === 'access' && sources;
    let c: Comparison;
    try {
      // The structural diff is of the diagram as written; the matrix is drawn below from both states.
      const plain = (x: RenderOptions): RenderOptions => (matrix ? { ...x, view: undefined } : x);
      c = await compare(p.before, p.after, { before: plain(p.beforeOptions), after: plain(optionsOf(p.afterFile, fonts)), view: matrix ? undefined : o.view, fresh: o.fresh });
    } catch (e) {
      ctx.error(`${p.name}  ${red(t('error'))}  ${(e as Error).message}`);
      ok = false;
      continue;
    }
    ctx.report(p.name, c.diagnostics);
    if (c.failed) ok = false;
    if (!c.diff.same) changed = true;
    const state = p.before === undefined ? 'new' : p.after === undefined ? 'removed' : undefined;
    if (changes?.length) changed = true;
    if (o.json) json.push({ file: p.name, ...(o.view ? { view: o.view } : {}), against: p.against, ...(state ? { state } : {}), summary: summary(c.diff), explained: explain(c.diff, c.before?.graph, c.after?.graph).map((x) => x.text), ...c.diff, ...(changes ? { access: changes } : {}) });
    else {
      // With -o - the picture or the text is standard output: the summary goes to stderr.
      const say = o.out === '-' ? ctx.error : ctx.log;
      say(`${bold(p.name)}${o.view ? `#${o.view}` : ''} ${dim(t('against {what}', { what: p.against }))}: ${state ? `${state}, ` : ''}${summary(c.diff)}`);
      if (!c.diff.same) say(formatDiff(c.diff));
      if (changes?.length) for (const x of changes) say(`  ${x.kind === 'gained' ? '+' : x.kind === 'lost' ? '-' : '~'} ${x.text}`);
    }
    if (!o.out) continue;
    const single = pairs.length === 1 && !!ext;
    if (markdown) {
      const text = changes ? accessMarkdown(path.basename(p.name), changes) : explainMarkdown(c.diff, c.before?.graph, c.after?.graph, { name: path.basename(p.name), against: p.against });
      const out = o.out === '-' ? '-' : single ? o.out : path.join(o.out, path.basename(p.name).replace(/\.ya?ml$/, '') + '.diff.md');
      if (out !== '-') fs.mkdirSync(path.dirname(out), { recursive: true });
      ctx.put(out, text);
      if (out !== '-') ctx.error(`${p.name} → ${out}`);
      continue;
    }
    const overlay = { against: p.against, labels: { before: p.against, after: ref ? 'Working tree' : path.basename(p.name) } };
    let picture: { svg: string; width: number; height: number } | undefined;
    if (matrix) {
      // The type marks the cells itself: gained +, lost struck through, changed ~, each with its words.
      const r = await render(yamlText({ ...sources.now, type: 'access', view: undefined, was: sources.was }, { lineWidth: 0 }), optionsOf(p.afterFile, fonts));
      ctx.report(`${p.name}#access`, r.diagnostics.filter((d) => d.severity === 'error'));
      picture = r.svg && r.width !== undefined && r.height !== undefined ? { svg: r.svg, width: r.width, height: r.height } : undefined;
    } else picture = o['side-by-side'] ? c.sideBySide(overlay) : c.picture(overlay);
    if (!picture) continue;
    const out = o.out === '-' ? '-' : single ? o.out : path.join(o.out, path.basename(p.name).replace(/\.ya?ml$/, '') + (o.view ? `-${o.view}` : '') + `.diff.${format}`);
    if (out !== '-') fs.mkdirSync(path.dirname(out), { recursive: true });
    const faces = (c.after ?? c.before)?.theme?.font.faces ?? [];
    ctx.put(out, format === 'png' ? toPng(picture.svg, Number(o.scale) || 2, await ttfFiles(faces)) : picture.svg);
    ctx.error(`${p.name} → ${out} ${dim(`${picture.width}×${picture.height}`)}`);
  }
  if (o.json) ctx.log(JSON.stringify(ref || snap ? json : json[0], null, 2));
  return !ok ? 1 : o['exit-code'] && changed ? 1 : 0;
}
