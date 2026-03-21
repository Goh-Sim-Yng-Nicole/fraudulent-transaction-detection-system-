import js from '@eslint/js';
import globals from 'globals';

const sharedRules = {
  'no-console': 'off',
  'no-unused-vars': [
    'error',
    {
      args: 'none',
      caughtErrors: 'none',
      argsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      '**/build/**',
      'grafana/dashboards/*.json',
    ],
  },
  js.configs.recommended,
  {
    files: ['services/**/*.js'],
    ignores: ['services/fraud_score/**/*.js', 'services/**/src/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
  {
    files: ['services/fraud_score/**/*.js', 'testing/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
  {
    files: ['services/**/src/public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Chart: 'readonly',
      },
    },
    rules: sharedRules,
  },
];
