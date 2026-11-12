// carto validate <file.yaml…|folder>: each diagram and each of its views, the problems printed; --drift the sidecar too.
import fs from 'node:fs';
import path from 'node:path';
import { isDiagramFile, type LayoutSidecar } from '@cartography/core';
import { drift, render, SLIDE_MIN_PT, slideTextPt } from '@cartography/engine';
import type { ValidateOptions } from '../args.ts';
import { langOption } from '../draw.ts';
import { t } from '../i18n.ts';
import { dataFiles, isFolder, sidecarPath, writeSidecar, type Ctx } from '../io.ts';
import { readPack } from '../packs.ts';

/** validate --drift: what the sidecar still refers to that the diagram no longer has. */
async function checkDrift(ctx: Ctx, o: ValidateOptions, file: string): Promise<boolean> {
  const { red, yellow, dim } = ctx;
  const p = sidecarPath(file);
  if (!fs.existsSync(p)) return true;
  let sidecar: LayoutSidecar | undefined;
  try {
    sidecar = ctx.sidecarFor(file);
  } catch (e) {
    ctx.error(`${red(t('error'))}  ${(e as Error).message}`);
    return false;
  }
  if (!sidecar) return false;
  const r = await drift(fs.readFileSync(file, 'utf8'), sidecar, { load: ctx.loaderFor(file), file: path.basename(file), packs: o.pack, pack: readPack });
  if (r.error) return (ctx.error(`${p}  ${yellow(t('warning'))}  ${r.error}`), true);
  if (!r.stale.length) return true;
  const fixing = !!o.fix;
  for (const s of r.stale) ctx.error(`${p}  ${fixing ? yellow(t('fixed')) : red(t('stale'))}  ${s.path}: ${s.message}`);
  const count = r.stale.length;
  if (!fixing) return (ctx.error(`${p}  ${t('{count} stale entry; carto validate --drift --fix {file} drops it|{count} stale entries; carto validate --drift --fix {file} drops them', { count, file })}`), false);
  writeSidecar(file, r.fixed);
  ctx.log(`${p} ${dim(r.fixed ? t('{count} stale entry dropped|{count} stale entries dropped', { count }) : t('{count} stale entry dropped, nothing left: file removed|{count} stale entries dropped, nothing left: file removed', { count }))}`);
  return true;
}

export async function validateCommand(ctx: Ctx, files: string[], o: ValidateOptions): Promise<number> {
  let ok = true;
  // A folder: each diagram in it.
  const folders = files.filter(isFolder);
  for (const f of files.filter((x) => !isFolder(x)).concat(folders.flatMap((d) => dataFiles(d).filter((x) => isDiagramFile(x, fs.readFileSync(x, 'utf8')))))) {
    const text = fs.readFileSync(f, 'utf8');
    const opts = { fonts: 'none' as const, load: ctx.loaderFor(f), file: path.basename(f), ...langOption(ctx) };
    const r = await render(text, { ...opts, view: o.view });
    // Without --view every view is checked too: what a view says about itself (complete: true for
    // an environment) is only known when that view is drawn. The same problem is printed once.
    const rest = o.view ? [] : await Promise.all((r.views ?? []).map((v) => render(text, { ...opts, view: v.name })));
    const seen = new Set<string>();
    const diagnostics = [r, ...rest].flatMap((x) => x.diagnostics).filter((d) => !seen.has(`${d.line}:${d.column}:${d.message}`) && !!seen.add(`${d.line}:${d.column}:${d.message}`));
    // Fitted onto its page (a 16:9 slide unless aspect: says otherwise), the smallest text of each drawing should still be readable.
    // A drawing that is read scrolling (a whole sequence) goes on slides as its other views: those are checked, it only gets a hint.
    const hints: string[] = [];
    for (const x of [r, ...rest.filter((v) => v.view !== r.view)]) {
      const pt = x.svg && x.width && x.height ? slideTextPt(x.svg, x.width, x.height, x.page) : undefined;
      if (pt == null || pt >= SLIDE_MIN_PT) continue;
      if (x.scroll) {
        const by = (r.views ?? []).filter((v) => !rest.find((w) => w.view === v.name)?.scroll).map((v) => v.name);
        const hint = `On a ${x.page?.name ?? '16:9 slide'} the whole drawing is ${pt.toFixed(1)} pt: present it per view (${by.join(', ')})`;
        if (!hints.includes(hint)) hints.push(hint);
      } else diagnostics.push({ severity: 'warning', message: `${x.view ? `View "${x.view}": o` : 'O'}n a ${x.page?.name ?? '16:9 slide'} its smallest text is ${pt.toFixed(1)} pt, under ${SLIDE_MIN_PT} pt: split it into views, or let it wrap (aspect: 16:9)` });
    }
    ctx.report(f, diagnostics);
    for (const h of hints) ctx.error(`${f}  ${ctx.dim(t('hint'))}  ${h}`);
    const drifted = o.drift && !(await checkDrift(ctx, o, f));
    if (diagnostics.some((d) => d.severity === 'error') || drifted) ok = false;
    else ctx.log(`${f} ${ctx.dim(t('ok'))}`);
  }
  return ok ? 0 : 1;
}
