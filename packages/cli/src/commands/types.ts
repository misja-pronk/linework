// carto types [words…]: which type to pick, best match first; carto themes: the built-in themes.
import { matchTypes } from '@cartography/core';
import { findType, types } from '@cartography/engine';
import { themeCatalog } from '@cartography/theme';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';

/** What each type is for; with words, the best matches first and the rest left out. */
export function typeGuide(ctx: Ctx, query = '') {
  const { bold, dim } = ctx;
  const ranked = matchTypes(query, types);
  const shown = query && ranked[0]!.score > 0 ? ranked.filter((r) => r.score > 0) : ranked;
  if (query && !ranked[0]!.score) ctx.log(dim(`${t('Nothing matches "{query}"; architecture (systems) is the usual start.', { query })}\n`));
  const name = (id: string) => findType(id)?.name ?? id;
  for (const { type: ty } of shown) {
    ctx.log(`${bold(ty.id.padEnd(14))} ${ty.name}${ty.tagline ? dim(' — ' + ty.tagline) : ''}`);
    for (const u of ty.useWhen ?? []) ctx.log(`${' '.repeat(15)}+ ${u}`);
    for (const n of ty.notFor ?? []) ctx.log(dim(`${' '.repeat(15)}- ${t('not for:')} ${n.text}${n.use ? ` → ${n.use} (${name(n.use)})` : ''}`));
    ctx.log();
  }
  ctx.log(dim(t('Start one: carto new <type> [file.yaml]. Guide: docs/types.md')));
}

export function typesCommand(ctx: Ctx, files: string[]): number {
  typeGuide(ctx, files.join(' '));
  return 0;
}

export function themesCommand(ctx: Ctx): number {
  const { dim } = ctx;
  for (const th of themeCatalog) ctx.log(`${th.name.padEnd(14)} ${dim('— ' + th.description)}`);
  ctx.log(`${'light, dark'.padEnd(14)} ${dim(`— ${t('other names for survey and survey-dark')}`)}`);
  ctx.log(dim(t('Or a file: theme: ./client.theme.yaml (see docs/themes.md and docs/style.md)')));
  return 0;
}
