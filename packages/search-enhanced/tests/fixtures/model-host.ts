/** Real schema-backed Settings in a disposable profile, shared by route and Host tests. */
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { type Context, type Plugin } from '@deepseek-ai/cordis'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Settings from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export async function modelServer() {
  const calls: Array<{ path: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    calls.push({ path: request.url!, headers: request.headers, body })
    response.setHeader('content-type', 'application/json')
    if (request.url!.endsWith('/responses')) {
      response.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'fixture answer' }] }] }))
      return
    }
    response.end(JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', content: [
      { type: 'web_search_tool_result', tool_use_id: 'search', content: [{ type: 'web_search_result', url: 'https://example.org/result', title: 'Fixture source', page_age: null }] },
      { type: 'text', text: '  fixture answer\n' },
    ] }))
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected a local HTTP address')
  return { url: 'http://127.0.0.1:' + String(address.port), calls, close: () => new Promise<void>((resolve, reject) => { server.close(error => { if (error === undefined) resolve(); else reject(error) }); server.closeAllConnections() }) }
}

export const MODEL_SETTINGS_NS = 'fixture-model-routes'
export const modelSettingsPlugin = {
  Config: z.object({ routes: z.any().volatile() }),
  apply() {},
}

export async function mountModelSettings(ctx: Context, root: string, routes: Record<string, unknown> = {}): Promise<void> {
  ctx.baseUrl = pathToFileURL(process.cwd() + '/').href
  if (ctx.get('loader') === undefined) await ctx.plugin(Loader)
  const requireSettings = createRequire(import.meta.resolve('@deepseek-ai/dsh-settings'))
  const editorPath = requireSettings.resolve('@deepseek-ai/dsh-config-editor')
  const { default: ConfigEditor } = await import(pathToFileURL(editorPath).href) as { default: Plugin }
  const requireEditor = createRequire(editorPath)
  const boot = await import(pathToFileURL(requireEditor.resolve('@deepseek-ai/dsh-app-boot')).href) as {
    initProfile(dir: string, bundles: string[]): void
    readProfilePatches(bin: string, profile: object): PatchOptions[]
    mountRootInclude(ctx: Context, path: string, patches: PatchOptions[]): Promise<unknown>
  }
  const dir = join(root, 'profile')
  boot.initProfile(dir, [])
  const profile = { name: 'test', startedBundles: [], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(root, 'package.json'), cwd: root, home: root, overlays: [], telemetryDisabledEnv: undefined }
  await writeFile(profile.installAnchor, JSON.stringify({ name: 'search-model-test' }))
  await writeFile(join(dir, 'cordis.yml'), '[]')
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [{ id: MODEL_SETTINGS_NS, name: 'cordis:modelSettingsFixture', config: { routes } }] }]))
  ctx.provide('profileContext', profile)
  ctx.loader.builtins.modelSettingsFixture = modelSettingsPlugin
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await boot.mountRootInclude(ctx, join(dir, 'cordis.yml'), boot.readProfilePatches('dsh', profile))
  await ctx.loader.await()
}
