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
    // pnpm's vitest shim puts the workspace's .pnpm/node_modules on NODE_PATH; the
    // in-process host boot would then resolve this workspace's packages instead of
    // the profile's installed ones (the upgrade scenario installs older versions).
    execArgv: ['--no-global-search-paths'],
    testTimeout: 120_000,
    hookTimeout: 600_000,
  },
})
