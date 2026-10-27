import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    '.local/**',
    'dist/**',
    'drizzle/**',
    'design/**',
    'screenshots/**',
    'node_modules/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      '@next/next/no-img-element': 'off',
      // Dialogs intentionally seed editable form state when their record changes.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
