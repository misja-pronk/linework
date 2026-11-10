import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts', 'types/*/test/**/*.test.ts', 'docs/site/test/**/*.test.ts'] } });
