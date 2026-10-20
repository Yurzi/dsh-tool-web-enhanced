/**
 * Prepare one isolated DSH world for the whole e2e run:
 *
 * 1. wipe `.e2e/run` and redirect every home, cache, and temp directory into it;
 * 2. install the DSH CLI under test (cached per version);
 * 3. pack every publishable package the way `pnpm publish` would;
 * 4. create the shipped `web` profile and install the profile bundle with the
 *    real plugin manager, its plugin dependencies resolved to this run's packs.
 *
 * Test files receive the result through `inject('e2e')`.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { addPlugins, artifacts, ensureDsh, isolatedEnvironment, packWorkspace, run } from './harness/environment.ts'

export default function setup(project: TestProject): void {
  // pnpm's Vitest shim adds workspace packages to NODE_PATH. Clear it before
  // workers start, otherwise Node's global lookup paths can make app-boot
  // prefer the workspace's new plain plugins over installed old bundles.
  delete process.env.NODE_PATH
  rmSync(run, { recursive: true, force: true })
  rmSync(artifacts, { recursive: true, force: true })
  mkdirSync(artifacts, { recursive: true })
  const env = isolatedEnvironment()
  const install = ensureDsh(env)
  const tarballs = packWorkspace(env)
  const e2e = { install, cli: join(install, 'node_modules/.bin/dsh'), env, tarballs }
  const { [PROFILE_PACKAGE]: profile, ...plugins } = tarballs
  addPlugins(e2e, [profile!], plugins)
  project.provide('e2e', e2e)
}
