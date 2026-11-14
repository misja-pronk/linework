import { defineConfig } from 'vitest/config';
// LINEWORK_LANG=en: the CLI's tests read its English, whatever the locale of the machine they run on.
export default defineConfig({ test: { env: { LINEWORK_LANG: 'en' }, include: ['packages/*/test/**/*.test.ts', 'types/*/test/**/*.test.ts', 'docs/site/test/**/*.test.ts'] } });
