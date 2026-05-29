'use strict';

const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    // Source files
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'coverage/**'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        require:   'readonly',
        module:    'readonly',
        exports:   'readonly',
        __dirname: 'readonly',
        __filename:'readonly',
        process:   'readonly',
        Buffer:    'readonly',
        console:   'readonly',
        setTimeout:'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // Errors
      'no-unused-vars':    ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-undef':           'error',
      'no-console':         'off',   // plugin uses console for Homebridge logging
      'eqeqeq':            ['error', 'always', { null: 'ignore' }],

      // Style (warnings only — don't block CI, just flag)
      'semi':              ['warn', 'always'],
      'no-trailing-spaces': 'warn',
      'eol-last':          ['warn', 'always'],
    },
  },
  {
    // Test files get Jest globals
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        describe:      'readonly',
        test:          'readonly',
        it:            'readonly',
        expect:        'readonly',
        beforeEach:    'readonly',
        afterEach:     'readonly',
        beforeAll:     'readonly',
        afterAll:      'readonly',
        jest:          'readonly',
        setImmediate:  'readonly',
        clearImmediate:'readonly',
      },
    },
  },
];
