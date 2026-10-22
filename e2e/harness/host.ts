/**
 * Boot the real host plane of the isolated profile inside the test process,
 * through the same steps the `dsh` CLI takes: load the profile, resolve its
 * packages, read its bundle and user patch layers, then boot the composed
 * entry list. No service is faked and no provider is registered by the test.
 *
 * These are public exports of the installed DSH packages, but they are the
 * CLI's building blocks rather than a documented embedding API, so this file
 * is the one place to adjust when a DSH release changes them.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRuntime } from '@deepseek-ai/dsh-web'
import { type E2EContext, PROFILE, run } from './environment.ts'

/** A booted host plane. */
export interface Host {
  readonly ctx: Context
  readonly web: WebRuntime
  dispose(): Promise<void>
}

/** The pieces of `@deepseek-ai/dsh-app-boot` the CLI uses to start a profile. */
interface AppBoot {
  loadProfile(binName: string, name: string, installAnchor: string): { dir: string; patchPath: string; layers: { packageName: string }[] }
  createRuntimeResolution(options: { installAnchor: string; profile: unknown }): Promise<unknown>
  loadOverlayPatches(binName: string, file: string): unknown[]
  readProfilePatches(binName: string, context: object, profile: unknown): unknown[]
  boot(binName: string, configPath: string, patches: unknown[], prepare: (ctx: Context) => Promise<void>): Promise<Context>
  PluginPackages: object
}

const BIN = 'web-enhanced-e2e'

/** Drops the rows that serve the browser GUI, so a host boot binds no port. */
const HOST_PLANE = join(import.meta.dirname, '../fixtures/host-plane.yml')

/**
 * @param e2e - the run's install and environment; `process.env` must already be the isolated one.
 * @param overlays - extra patch files, applied after the profile's own layers like `dsh --patch`.
 * @param prepare - register public observers before the profile's plugins initialize.
 * @param profileName - shipped Web or base profile to boot.
 * @returns the booted host plane.
 */
export async function bootHost(e2e: E2EContext, overlays: readonly string[] = [], prepare: (ctx: Context) => void = () => {}, profileName = PROFILE): Promise<Host> {
  const anchor = join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json')
  const require = createRequire(anchor)
  const app = require('@deepseek-ai/dsh-app-boot') as AppBoot
  const { provideCmdline } = require('@deepseek-ai/dsh-cmdline') as { provideCmdline: (ctx: Context, options: object) => void }
  const { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } = require('@deepseek-ai/dsh-launch-environment') as {
    createLaunchEnvironmentSnapshot: (layers: { source: string; values: NodeJS.ProcessEnv }[]) => unknown
    DSH_LAUNCH_ENVIRONMENT_KEY: string
  }

  const profile = app.loadProfile(BIN, profileName, anchor)
  const resolution = await app.createRuntimeResolution({ installAnchor: anchor, profile })
  // What the launcher knows about the profile it starts; plugins read it as `ctx.profileContext`.
  const context = {
    name: profileName,
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor: anchor,
    startedBundles: profile.layers.map(layer => layer.packageName),
    cwd: run,
    home: e2e.env.DSH_HOME,
    overlays: [HOST_PLANE, ...overlays].flatMap(file => app.loadOverlayPatches(BIN, file)),
    telemetryDisabledEnv: '1',
  }
  const listeners = new Set<() => void>()
  let ready = false
  const applicationReady = {
    onReady(listener: () => void): () => void {
      if (ready) listener()
      else listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const ctx = await app.boot(BIN, join(profile.dir, 'cordis.yml'), app.readProfilePatches(BIN, context, profile), async (root) => {
    root.provide('profileContext', context)
    root.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]))
    await root.plugin(app.PluginPackages as Parameters<Context['plugin']>[0], { resolution })
    provideCmdline(root, { args: [], exit: (code: number) => { throw new Error(`unexpected exit ${code}`) }, ready: applicationReady })
    prepare(root)
  })

  // HMR's initial reload waits for the launcher's public application-ready signal.
  ready = true
  for (const listener of listeners) {
    listeners.delete(listener)
    listener()
  }
  const web = ctx.get('web')
  if (web === undefined) throw new Error('the composed profile did not provide ctx.web')
  const hmr = ctx.get('hmr') as { runExclusive(work: () => Promise<void>): Promise<void> } | undefined
  return {
    ctx, web,
    dispose: async () => {
      // Let public profile-reload work finish before disposing the root it still uses.
      if (hmr !== undefined) await hmr.runExclusive(async () => {})
      await ctx.fiber.dispose()
    },
  }
}
