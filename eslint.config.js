// ESLint flat config (Vite React-TS baseline).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'test-results',
      'playwright-report',
      'public/mockServiceWorker.js',
      'node_modules',
    ],
  },
  {
    // Node-side scripts and this config file.
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // `_`-prefixed names are the project's "intentionally unused" marker, mostly for stripping
      // a key via rest destructuring (`const { companyId: _c, ...rest } = row`) and for
      // positional args a signature must keep. Mirrors tsc's noUnused* behaviour.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // The MSW mock backend contains no React. Its Vitest helper `useSeedPerTest()` follows
    // Vitest's `use*` naming for per-test setup and is not a React hook.
    files: ['src/shared/mocks/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
);
