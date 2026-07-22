import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['data', 'coverage'] },
  {
    files: ['server/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, fetch: 'readonly', FormData: 'readonly', Blob: 'readonly' },
    },
  },
]

