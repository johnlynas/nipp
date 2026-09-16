import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore generated and node_modules directories (job-scheduler-runtime/ holds
  // the worker bootstrap materialized at runtime by lib/job-scheduler-bree.ts)
  { ignores: ['node_modules/', '.next/', 'dist/', 'next-env.d.ts', 'job-scheduler-runtime/'] },

  // Base JavaScript rules
  js.configs.recommended,

  // TypeScript/Next.js recommended rules
  ...tseslint.configs.recommended,

  // React Hooks rules
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },

  // Next.js specific rules
  {
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  // TypeScript-specific overrides
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Tenant isolation: prevent direct prisma imports from lib/db.ts in business logic
  {
    files: ['app/**/*.ts', 'app/**/*.tsx', 'lib/**/*.ts'],
    ignores: ['lib/tenant-db.ts', 'lib/db.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/db'],
              message: 'Use lib/tenant-db.ts instead of lib/db.ts to ensure tenant isolation.',
            },
          ],
        },
      ],
    },
  },

  // Allow imports from lib/db.ts in lib/tenant-db.ts and lib/db.ts itself
  {
    files: ['lib/tenant-db.ts', 'lib/db.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // Next.js app directory rules
  {
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },

  // Test files
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Development scripts and migrations
  {
    files: ['scripts/**/*', 'prisma/**/*'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // Node.js script files (root-level .mjs utilities and scripts) get node globals
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // CommonJS files (.spike/, builtins/, scripts/*.cjs) — allow require + node globals
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      // Throwaway/experimental scripts — suppress unused-var noise
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
