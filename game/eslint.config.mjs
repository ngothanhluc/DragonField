import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'library/**',
      'temp/**',
      'build/**',
      'profiles/**',
      'native/**',
      'node_modules/**',
      '.creator/**',
      'types/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['assets/scripts/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Architecture boundary: core/ must be testable without the engine.
    files: ['assets/scripts/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['cc', 'cc/*'],
              message:
                'core/ must be plain TS: do not import cc. Move engine-dependent code into assets/scripts/game/.',
            },
          ],
        },
      ],
    },
  },
);
