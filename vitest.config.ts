import { defineConfig } from 'vitest/config'
import { cssModules, standardDecorators } from './build/plugins.ts'

/** Unit and composition tests of every package; e2e has its own config. */
export default defineConfig({
  plugins: [standardDecorators(), cssModules('test')],
  test: {
    include: ['packages/*/tests/**/*.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'text'],
    },
  },
})
