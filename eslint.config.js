// Lint for bugs, not style: a handful of rules that each catch something the type checker lets through.
// Type-aware rules read the root tsconfig.json; formatting stays by hand.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const unused = ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }];

export default defineConfig(
  { ignores: ['**/node_modules/', '**/dist/', '**/generated/', 'gallery/', 'docs/site/shots/', 'test-results/', 'playwright-report/', 'e2e-out/', '.claude/'] },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  // Rules that need no types: every file, scripts and e2e included.
  {
    files: ['**/*.{js,mjs,ts,tsx,mts}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // `== null` is the one loose comparison worth keeping: null or undefined, nothing else.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-fallthrough': 'error',
      '@typescript-eslint/no-unused-vars': unused,
    },
  },
  {
    files: ['**/*.{ts,tsx,mts}'],
    ignores: ['**/*.d.mts'],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['packages/web/vite.config.ts'], defaultProject: 'tsconfig.json' },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
