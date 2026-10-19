import { defineConfig } from 'vitest/config'

/**
 * End-to-end suite against a real, isolated DSH install. Slow and networked
 * on first run; not part of `pnpm run check`. See docs/development.md.
 */
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    // The files share one profile; GUI tests write to it.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
})
