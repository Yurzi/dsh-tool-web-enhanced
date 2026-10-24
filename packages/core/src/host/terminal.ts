import type { Context } from '@deepseek-ai/cordis'
import type { CapabilitySettings, LabeledConnection } from './capability.ts'
import { LABEL_MAX, oneLine } from './enhanced-parts/listing.ts'
import { InvalidSettingsError } from './settings-row.ts'
import { isSelectable } from './selectable.ts'

export interface CommandCompletionNode {
  readonly name: string
  readonly description: string
}

export interface TuiCommandTreeProvider {
  readonly root: string
  children(path: readonly string[]): readonly CommandCompletionNode[]
}

interface TuiCommandTrees {
  register(provider: TuiCommandTreeProvider): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context { tuiCommandTrees: TuiCommandTrees }
}

export function registerTerminal(ctx: Context, root: string, noun: string, settings: () => CapabilitySettings<LabeledConnection>, freshness: boolean): void {
  ctx.effect(() => ctx.tuiCommandTrees.register({
    root,
    children(path) {
      if (path[0] !== root) return []
      if (freshness && path.length === 2 && path[1] === 'freshness') {
        return [{ name: 'auto', description: 'Auto' }, { name: 'fresh', description: 'Within 24 hours' }, { name: 'realtime', description: 'Live' }]
      }
      if (path.length !== 1) return []
      const nodes: CommandCompletionNode[] = [{ name: 'off', description: 'Turn ' + noun + ' off for this session' }]
      try {
        for (const connection of settings().connections.values()) {
          if (isSelectable(connection)) nodes.push({ name: connection.id, description: oneLine(connection.label, LABEL_MAX) })
        }
      } catch (error) {
        if (!(error instanceof InvalidSettingsError)) throw error
      }
      if (freshness) nodes.push({ name: 'freshness', description: 'Content freshness, for connections that apply it' })
      return nodes
    },
  }))
}
