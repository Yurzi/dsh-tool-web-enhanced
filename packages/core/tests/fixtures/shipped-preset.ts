import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { parse } from 'yaml'

export async function shippedWebPreset(ctx: Context, id: 'standard' | 'minimal' | 'ptc'): Promise<void> {
  // Resolve shipped plugin rows from their bundle, including its presentation dependency.
  ctx.baseUrl = new URL('../', import.meta.resolve('@deepseek-ai/dsh-web-app')).href
  const url = import.meta.resolve('@deepseek-ai/dsh-web-app/presets/' + id + '.patch.yml')
  const text = await readFile(new URL(url), 'utf8')
  // Platform expressions belong only to excluded shell rows; no JS evaluation is needed.
  const patches = parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: () => false }] }) as Array<{ insert: Array<{ config: PresetDefinition }> }>
  const preset = patches[0]!.insert[0]!.config
  await ctx.agentPresets.register({ ...preset, plugins: preset.plugins.filter(row => row.id === 'tool-web' || row.id === 'tool-presentation') })
}

export async function mountPtcRuntime(ctx: Context, root: string): Promise<void> {
  const installed = createRequire('/usr/lib/node_modules/@deepseek-ai/dsh/package.json')
  for (const name of ['fs-local', 'subprocess-local', 'sandbox-local', 'sandbox-policy', 'ptc-runtime-node']) {
    const module = await import(pathToFileURL(installed.resolve('@deepseek-ai/dsh-' + name)).href)
    const config = name === 'fs-local' ? { cwd: root } : name === 'sandbox-policy' ? { workspaceRoot: root } : {}
    await ctx.plugin(module.default, config)
  }
}
