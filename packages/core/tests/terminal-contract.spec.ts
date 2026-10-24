import { Context, type Plugin } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { registerTerminal, type CommandCompletionNode } from '../src/host/terminal.ts'

it('runs our terminal registration and effect disposal against the real TUI registry', async () => {
  // Keep the real TUI's ambient Context declaration out of the product's local structural type.
  const moduleName = '@deepseek-harness-tui/dsh-tui/command-trees'
  const { TuiCommandTreeRuntime } = await import(moduleName) as { TuiCommandTreeRuntime: Plugin }
  const ctx = new Context()
  const settings = {
    defaultConnection: 'custom:MyEngine', enhancedTools: false,
    connections: new Map([['custom:MyEngine', { id: 'custom:MyEngine', label: 'My\n Engine', kind: 'adapter' as const, disabled: false }]]),
  }
  let activations = 0
  const plugin = { name: 'completion-contract', apply(scope: Context) {
    scope.inject(['tuiCommandTrees'], injected => {
      registerTerminal(injected, 'setup-search', 'web search', () => settings, true)
      const registry = injected.get('tuiCommandTrees') as unknown as {
        children(path: readonly string[]): readonly CommandCompletionNode[]
      }
      expect(registry.children(['setup-search'])).toEqual([
        { name: 'off', description: 'Turn web search off for this session' },
        { name: 'custom:MyEngine', description: 'My Engine' },
        { name: 'freshness', description: 'Content freshness, for connections that apply it' },
      ])
      expect(registry.children(['setup-search', 'freshness'])).toEqual([
        { name: 'auto', description: 'Auto' },
        { name: 'fresh', description: 'Within 24 hours' },
        { name: 'realtime', description: 'Live' },
      ])
      activations++
    })
  } }
  try {
    await ctx.plugin(TuiCommandTreeRuntime)
    const first = await ctx.plugin(plugin)
    await ctx.fiber.await()
    expect(activations).toBe(1)
    await first.dispose()
    // The real registry rejects duplicate roots: a successful remount proves the effect unregistered it.
    await ctx.plugin(plugin)
    await ctx.fiber.await()
    expect(activations).toBe(2)
  } finally {
    await ctx.fiber.dispose()
  }
})
