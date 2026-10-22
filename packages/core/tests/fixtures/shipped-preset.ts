import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import PtcRuntimeNode from '@deepseek-ai/dsh-ptc-runtime-node'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
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

/** The local runtime rows the shipped PTC preset expects, in the order DSH mounts them. */
export async function mountPtcRuntime(ctx: Context, root: string): Promise<void> {
  await ctx.plugin(FsLocal, { cwd: root })
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(SandboxLocal, {})
  await ctx.plugin(SandboxPolicy, { workspaceRoot: root })
  await ctx.plugin(PtcRuntimeNode, {})
}
