// linework new <type> [file.yaml]: a diagram from the type's template; without a type, help picking one.
import fs from 'node:fs';
import { findType, types } from '@linework/engine';
import { t } from '../i18n.ts';
import type { Ctx } from '../io.ts';
import { typeGuide } from './types.ts';

export function newCommand(ctx: Ctx, files: string[]): number {
  const [id, target] = files;
  // Without a type, help picking one instead of an error.
  if (!id) return (typeGuide(ctx), 0);
  const type = findType(id);
  if (!type) {
    ctx.error(t('Unknown type "{name}". Types: {types}', { name: id ?? '', types: types.map((x) => x.id).join(', ') }));
    return 1;
  }
  // `-` is standard output, as everywhere a file is named.
  if (!target || target === '-') {
    ctx.write(type.template);
    return 0;
  }
  if (fs.existsSync(target)) {
    ctx.error(t('{file} already exists', { file: target }));
    return 1;
  }
  fs.writeFileSync(target, type.template);
  ctx.log(t('Created {file}', { file: target }));
  return 0;
}
