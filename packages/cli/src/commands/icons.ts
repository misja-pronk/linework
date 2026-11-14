// linework icons [vendor] | import | list | show | find | map | unmap: the official icon packs in the config folder.
import fs from 'node:fs';
import { coverage } from '@linework/icons';
import type { IconsOptions } from '../args.ts';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';
import { coverageKinds, findIcons, iconGuide, importIcons, isVendor, listPacks, mapIcon, packSheet, readPack, unmapIcon } from '../packs.ts';
import { toPng } from '../png.ts';

export function iconsCommand(ctx: Ctx, files: string[], o: IconsOptions, usage: () => number): number {
  const { red, dim } = ctx;
  const [sub, a, ...more] = files;
  const fail = (e: unknown) => (ctx.error(`${red(t('error'))}  ${(e as Error).message}`), 1);
  if (!sub || isVendor(sub)) return (ctx.log(iconGuide(sub)), 0);
  if (sub === 'list') {
    const packs = listPacks();
    if (!packs.length) ctx.log(t('No icon packs yet. Where to get them: linework icons'));
    for (const p of packs) {
      const cov = coverage(p, coverageKinds(p.name));
      ctx.log(`${p.name.padEnd(12)} ${t('{have} of {count} kinds', { have: cov.have, count: cov.of })}${p.manual && Object.keys(p.manual).length ? `, ${t('{count} by hand', { count: Object.keys(p.manual).length })}` : ''} ${dim(t('imported {when} ← {source}', { when: p.imported ?? '?', source: p.source ?? '?' }))}`);
    }
    return 0;
  }
  if (sub === 'import') {
    if (!a) return usage();
    try {
      const r = importIcons(a, o.pack?.[0]);
      const name = r.pack.name;
      ctx.log(`${a} → ${r.dir}\n  ${t('{files} SVG files; {have} of {count} {pack} kinds have an icon', { files: r.files, have: r.coverage.have, count: r.coverage.of, pack: name })}${r.kept.length ? ` ${t('({count} mapped by hand before, kept)', { count: r.kept.length })}` : ''}`);
      if (r.coverage.missing.length) ctx.log(dim(`  ${t('no icon yet: {kinds}', { kinds: r.coverage.missing.join(', ') })}\n  ${t('give one by hand: linework icons map {pack} <kind> <words>; see all: linework icons show {pack} -o {pack}.png', { pack: name })}`));
      ctx.log(dim(`  ${t('use it: icons: official in the diagram, or linework render diagram.yaml --icons official')}`));
      return 0;
    } catch (e) {
      return fail(e);
    }
  }
  if (!a) return usage();
  try {
    if (sub === 'show') {
      const { svg, coverage: cov } = packSheet(a);
      if (o.out === '-') ctx.write(svg);
      else if (o.out) {
        fs.writeFileSync(o.out, /\.png$/i.test(o.out) ? toPng(svg, 2) : svg);
        ctx.log(`${a}: ${t('{have} of {count} kinds', { have: cov.have, count: cov.of })} → ${o.out}`);
      } else {
        const pack = readPack(a)!;
        for (const k of coverageKinds(a)) ctx.log(`${k.kind.padEnd(24)} ${pack.icons[k.kind] ? pack.icons[k.kind] + (pack.manual?.[k.kind] ? dim(`  (${t('by hand')})`) : '') : dim('—')}`);
        ctx.log(`\n${t('{have} of {count} kinds have an icon', { have: cov.have, count: cov.of })}`);
      }
      return 0;
    }
    if (sub === 'find') {
      const hits = findIcons(a, more.join(' '));
      for (const h of hits.slice(0, 30)) ctx.log(`${h.name.padEnd(40)} ${dim(h.file)}`);
      if (!hits.length) ctx.log(t('Nothing in {pack} called "{words}"', { pack: a, words: more.join(' ') }));
      return hits.length ? 0 : 1;
    }
    if (sub === 'map') {
      const [kind, ...words] = more;
      if (!kind || !words.length) return usage();
      const r = mapIcon(a, kind, words.join(' '));
      ctx.log(`${a}: ${kind} → ${r.file}`);
      return 0;
    }
    if (sub === 'unmap') {
      const [kind] = more;
      if (!kind) return usage();
      unmapIcon(a, kind);
      ctx.log(`${a}: ${t('{kind} draws its line icon again', { kind })}`);
      return 0;
    }
  } catch (e) {
    return fail(e);
  }
  return usage();
}
