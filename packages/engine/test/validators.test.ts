// The precompiled validators (packages/core/src/generated/validators.ts) are those of today's schemas:
// otherwise core compiles at run time, with Function(), which the web app's CSP refuses.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { schemaKey } from '@cartography/core';
import * as validators from '../../core/src/generated/validators.ts';
import { generated, validatorsModule } from '../../../scripts/validators.ts';
import { validatedSchemas } from '../src/index.ts';

describe('precompiled validators', () => {
  it('has one for every schema the engine validates with', () => {
    const missing = validatedSchemas().map(schemaKey).filter((k) => !(k in validators));
    expect(missing, 'run: pnpm validators').toEqual([]);
  });

  it('is what scripts/validators.ts makes of the schemas now', () => {
    expect(fs.readFileSync(generated, 'utf8') === validatorsModule(), 'run: pnpm validators').toBe(true);
  }, 60_000);
});
