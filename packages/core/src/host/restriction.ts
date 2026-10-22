import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type { EnhancedToolNames } from '../shared/index.ts'
import type { EnhancedTools } from './enhanced.ts'

export interface RestrictionOptions {
  readonly tool: 'web_search' | 'web_fetch'
  readonly routed: () => boolean
  /** Read the effective choice without materializing session records. */
  readonly selection?: (agent: Agent) => Promise<string | null>
  readonly enhanced?: {
    readonly rowId: string
    readonly names: EnhancedToolNames
    readonly enabled: () => boolean
    readonly tools: () => EnhancedTools
    readonly providers: (agent: Agent) => Promise<readonly string[] | undefined>
  }
}

type Choice = 'unknown' | 'on' | 'off'
type Providers = 'unknown' | 'absent' | 'present'
interface State { version: number; choice: Choice; providers: Providers }
export interface VisibilityRead { readonly generation: number; readonly version: number }
export type ProviderListRead =
  | { readonly kind: 'read'; readonly ids: readonly string[] | undefined }
  | { readonly kind: 'unread' }

/** Owns registration and both masks, including their single ordered teardown. */
export class ToolRestriction {
  private readonly lifts = new Map<Agent, () => void>()
  private readonly enhancedLifts = new Map<Agent, () => void>()
  private readonly known = new Map<Agent, string | null>()
  private readonly states = new Map<Agent, State>()
  private readonly forgotten = new WeakSet<Agent>()
  private removes: Array<() => void> = []
  private definitions: EnhancedTools | undefined
  private generation = 0
  private disposed = false
  private enhancedContext: Context | undefined

  constructor(private readonly ctx: Context, private readonly options: RestrictionOptions) {
    ctx.on('settings/document-updated', async ns => {
      if (this.disposed) return
      const enhanced = options.enhanced
      if (ns !== 'web' && (enhanced === undefined || ns !== enhanced.rowId)) return
      // Registration and every initial mask are one synchronous segment.
      const newlyRegistered = this.reconcile()
      const nativeAgents = ns === 'web' ? [...this.known.keys()] : []
      if (!options.routed()) for (const agent of nativeAgents) this.native(agent, this.known.get(agent)!)
      const agents = new Set(newlyRegistered)
      if (this.registered) for (const agent of this.states.keys()) agents.add(agent)
      if (options.routed()) for (const agent of nativeAgents) agents.add(agent)
      await Promise.all([...agents].map(agent => this.refresh(agent, nativeAgents.includes(agent))))
    })
    ctx.effect(() => () => {
      this.disposed = true
      for (const lift of this.lifts.values()) lift()
      this.lifts.clear()
      this.known.clear()
      this.states.clear()
    }, options.tool + ' visibility')
  }

  get active(): boolean { return !this.disposed }
  get registered(): boolean { return this.removes.length !== 0 }

  offered(): boolean {
    return this.active && this.enhancedContext !== undefined && this.options.routed() && this.options.enhanced !== undefined && this.options.enhanced.enabled()
  }

  /** Call only after all runtime closures exist. Hot-start reads never create records. */
  async start(): Promise<void> {
    if (this.options.enhanced === undefined) return
    await this.ctx.inject(['tools', 'agents'], async scope => {
      this.enhancedContext = scope
      scope.effect(() => () => {
        this.withdraw()
        this.enhancedContext = undefined
      }, this.options.tool + ' enhanced visibility')
      const agents = this.reconcile()
      await Promise.all(agents.map(agent => this.refresh(agent, false)))
    })
  }

  created(agent: Agent): void {
    if (!this.active || this.forgotten.has(agent)) return
    this.states.set(agent, { version: 0, choice: 'unknown', providers: 'unknown' })
    this.apply(agent)
  }

  begin(agent: Agent): VisibilityRead {
    const state = this.state(agent)
    state.version++
    return { generation: this.generation, version: state.version }
  }

  captured(agent: Agent, read: VisibilityRead, connectionId: string | null, providers: ProviderListRead): void {
    this.commit(agent, read, connectionId === null ? 'off' : 'on', this.providerState(providers), connectionId)
  }

  private providerState(read: ProviderListRead): Providers {
    if (read.kind === 'unread') return 'unknown'
    return read.ids === undefined ? 'absent' : 'present'
  }

  failed(agent: Agent, read: VisibilityRead): void {
    this.commit(agent, read, 'unknown', 'unknown')
  }

  sync(agent: Agent, connectionId: string | null): void {
    if (!this.active || this.forgotten.has(agent)) return
    const read = this.begin(agent)
    this.commit(agent, read, connectionId === null ? 'off' : 'on', this.state(agent).providers, connectionId)
  }

  forget(agent: Agent): void {
    this.forgotten.add(agent)
    this.known.delete(agent)
    this.states.delete(agent)
    this.lift(this.lifts, agent)
    this.lift(this.enhancedLifts, agent)
  }

  private state(agent: Agent): State {
    let state = this.states.get(agent)
    if (state === undefined) {
      state = { version: 0, choice: 'unknown', providers: 'unknown' }
      this.states.set(agent, state)
    }
    return state
  }

  private reconcile(): Agent[] {
    if (!this.offered()) {
      if (this.registered) this.withdraw()
      return []
    }
    if (this.registered) return []
    const enhanced = this.options.enhanced!
    if (this.definitions === undefined) this.definitions = enhanced.tools()
    this.generation++
    const scope = this.enhancedContext!
    const removes: Array<() => void> = []
    try {
      removes.push(scope.tools.register(this.definitions.action))
      removes.push(scope.tools.register(this.definitions.list))
    } catch {
      for (const remove of removes.toReversed()) remove()
      this.ctx.logger.warn('%s: enhanced tool registration failed', this.options.tool)
      return []
    }
    this.removes = removes
    const agents = scope.agents.list()
    for (const agent of agents) {
      this.state(agent)
      this.apply(agent)
    }
    return agents
  }

  private withdraw(): void {
    this.generation++
    for (const remove of this.removes.splice(0)) remove()
    for (const lift of this.enhancedLifts.values()) lift()
    this.enhancedLifts.clear()
  }

  private async refresh(agent: Agent, native: boolean): Promise<void> {
    if (!this.active || this.forgotten.has(agent)) return
    const read = this.begin(agent)
    try {
      const selection = this.options.selection
      const connectionId = selection === undefined ? this.known.get(agent) : await selection(agent)
      if (connectionId === undefined) return
      const enhanced = this.options.enhanced
      let providers: ProviderListRead = { kind: 'unread' }
      if (this.registered && this.offered() && enhanced !== undefined) {
        try {
          providers = { kind: 'read', ids: await enhanced.providers(agent) }
        } catch {
          this.ctx.logger.warn('%s: conversation provider list could not be read', this.options.tool)
        }
      }
      this.commit(agent, read, connectionId === null ? 'off' : 'on', this.providerState(providers), native ? connectionId : undefined)
    } catch (error) {
      this.failed(agent, read)
      this.ctx.logger.warn('%s: refreshing tool restriction failed: %s', this.options.tool, error)
    }
  }

  private commit(agent: Agent, read: VisibilityRead, choice: Choice, providers: Providers, native?: string | null): void {
    const state = this.states.get(agent)
    if (!this.active || this.forgotten.has(agent) || state === undefined
      || read.generation !== this.generation || read.version !== state.version) return
    // A condition change without a settings event still cannot make a late read visible.
    if (this.registered && !this.offered()) { this.withdraw(); return }
    state.choice = choice
    state.providers = providers
    if (native !== undefined) { this.known.set(agent, native); this.native(agent, native) }
    this.apply(agent)
  }

  private apply(agent: Agent): void {
    if (!this.registered) return
    const state = this.state(agent)
    if (state.choice === 'on' && state.providers === 'present') {
      this.lift(this.enhancedLifts, agent)
    } else if (!this.enhancedLifts.has(agent)) {
      const names = this.options.enhanced!.names
      this.enhancedLifts.set(agent, agent.ctx.tools.restrict({ deny: [names.action, names.list] }))
    }
  }

  private native(agent: Agent, connectionId: string | null): void {
    if (connectionId !== null || !this.options.routed()) { this.lift(this.lifts, agent); return }
    if (this.lifts.has(agent)) return
    const tools = agent.ctx.get('tools')
    const scope = scopeOf(agent.ctx)
    if (scope === undefined || tools === undefined || tools.get(this.options.tool, scope) === undefined) return
    this.lifts.set(agent, tools.restrict({ deny: [this.options.tool] }))
  }

  private lift(lifts: Map<Agent, () => void>, agent: Agent): void {
    const lift = lifts.get(agent)
    lifts.delete(agent)
    if (lift !== undefined) lift()
  }
}
