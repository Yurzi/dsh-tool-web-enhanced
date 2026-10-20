import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'

export interface RestrictionOptions {
  readonly tool: 'web_search' | 'web_fetch'
  readonly routed: () => boolean
  /** Read the effective choice without materializing session records. */
  readonly selection?: (agent: Agent) => Promise<string | null>
}

/** An instance owns only its own restrictions; disposed work can never install new ones. */
export class ToolRestriction {
  private readonly lifts = new Map<Agent, () => void>()
  private readonly known = new Map<Agent, string | null>()
  private readonly forgotten = new WeakSet<Agent>()
  private disposed = false

  constructor(ctx: Context, private readonly options: RestrictionOptions) {
    ctx.on('settings/document-updated', async ns => {
      if (ns !== 'web' || this.disposed) return
      const agents = [...new Set([...this.known.keys(), ...this.lifts.keys()])]
      // Route-away lifting must be immediate and must not depend on storage reads.
      const selection = options.routed() ? options.selection : undefined
      const results = await Promise.allSettled(agents.map(async agent => {
        const connectionId = selection === undefined ? this.known.get(agent) : await selection(agent)
        if (connectionId !== undefined) this.sync(agent, connectionId)
      }))
      for (const result of results) {
        if (result.status === 'rejected') ctx.logger.warn('%s: refreshing tool restriction failed: %s', options.tool, result.reason)
      }
    })
    ctx.effect(() => () => {
      this.disposed = true
      for (const lift of this.lifts.values()) lift()
      this.lifts.clear()
      this.known.clear()
    }, options.tool + ' tool restriction')
  }

  get active(): boolean { return !this.disposed }

  sync(agent: Agent, connectionId: string | null): void {
    if (this.disposed || this.forgotten.has(agent)) return
    this.known.set(agent, connectionId)
    const lift = this.lifts.get(agent)
    if (connectionId !== null || !this.options.routed()) {
      this.lifts.delete(agent)
      if (lift !== undefined) lift()
      return
    }
    if (lift !== undefined) return
    const tools = agent.ctx.get('tools')
    const scope = scopeOf(agent.ctx)
    if (scope === undefined || tools === undefined || tools.get(this.options.tool, scope) === undefined) return
    this.lifts.set(agent, tools.restrict({ deny: [this.options.tool] }))
  }

  forget(agent: Agent): void {
    this.forgotten.add(agent)
    this.known.delete(agent)
    const lift = this.lifts.get(agent)
    this.lifts.delete(agent)
    if (lift !== undefined) lift()
  }
}
