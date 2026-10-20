import { defineConfig } from 'vitest/config'
import { cssModules, primitivesStub, standardDecorators } from './build/plugins.ts'

/** Unit and composition tests of every package; e2e has its own config. */
export default defineConfig({
  define: { __PLUGIN_VERSION__: JSON.stringify('0.0.0-test') },
  plugins: [standardDecorators(), cssModules('test'), primitivesStub()],
  test: {
    include: ['packages/*/tests/**/*.spec.{ts,tsx}'],
    // Browser components render the real primitives; their missing implementation libraries are stubbed above.
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      reporter: ['text-summary', 'text'],
    },
  },
})
