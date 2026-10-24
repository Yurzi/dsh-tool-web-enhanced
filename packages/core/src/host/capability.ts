import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { z } from 'zod'
import type { ConnectionView, Freshness, PluginIdentity, SelectionChange } from '../shared/index.ts'
import type { CapabilityEnhanced } from './enhanced.ts'
import type { ConnectionBase } from './selectable.ts'
import type { SessionModel } from './model.ts'

export interface LabeledConnection extends ConnectionBase {
  readonly label: string
}

/** The settings facts used by the selection mechanism; capabilities retain all other fields. */
export interface CapabilitySettings<C extends ConnectionBase = ConnectionBase> {
  readonly defaultConnection: string
  /** The operator's enhanced-tools switch; with a confirmed route it decides whether the two tools are registered. */
  readonly enhancedTools: boolean
  readonly connections: ReadonlyMap<string, C>
}
export type ConnectionOf<S extends CapabilitySettings> = NonNullable<ReturnType<S['connections']['get']>>

/** Encodes only capability options, not connectionId, revision or inheritance metadata. */
export interface OptionsCodec<O extends Record<string, unknown>, S> {
  initial(settings: S): O
  /** Read legacy records as well as current ones; omitted options use current defaults. */
  fromRecord(record: Readonly<Record<string, unknown>>, settings: S): O
  /** A partial change must not reset omitted fields. Search keeps its historical flat freshness field. */
  toRecord(options: Partial<O>): Record<string, unknown>
}

/** The part of selectionContract needed by the Host. Browser remoteInfo stays in ./shared. */
export interface HostContract<O extends Record<string, unknown>> {
  readonly selectionChange: z.ZodType<Omit<SelectionChange<O>, 'options'> & { readonly options?: { [K in keyof O]?: O[K] | undefined } | undefined }>
}

/** Explicit per-call context; never inferred from a model-supplied tool argument. */
export interface CapabilityCall {
  readonly ctx: Context
  readonly agent: Agent | undefined
  readonly signal: AbortSignal | undefined
}

/** The single registered seat calls this function; available() must remain local and always true. */
export type CapabilityInvoke<Q, R> = (request: Q, signal?: AbortSignal) => Promise<R>

/**
 * All differences a plugin supplies to installCapability. No stores, listeners or
 * module-level state belong in this object: core owns their per-install lifetime.
 * S is resolved settings, O session options, V the secret-free connection view,
 * T an ephemeral execution target, Q/R the native DSH request/result types.
 */
export interface Capability<S extends CapabilitySettings<LabeledConnection>, O extends Record<string, unknown>, V extends ConnectionView, T, Q, R> {
  readonly identity: PluginIdentity
  readonly tool: 'web_search' | 'web_fetch'
  readonly field: 'searchProvider' | 'fetchProvider'
  readonly remoteNamespace: string
  readonly storageDomain: string
  readonly contract: HostContract<O>
  readonly optionsCodec: OptionsCodec<O, S>
  readonly commandOptions?: {
    freshness(options: O): Freshness
    changeFreshness(value: Freshness): Partial<O>
  }
  /** Resolve the current operator policy; errors must be safe model-facing WebErrors. */
  settings(): S
  /** Describe local readiness without leaking credential references or secrets. */
  describe(settings: S, model: SessionModel | undefined): Promise<V[]>
  /** Construct afresh for every call, after core rechecks current selectability. Never cache a plan target. */
  target(connection: ConnectionOf<S>, options: O, call: CapabilityCall): T
  execute(target: T, request: Q, call: CapabilityCall): Promise<R>
  /** Register exactly one native Web provider and bind its lifetime to ctx. */
  register(ctx: Context, invoke: CapabilityInvoke<Q, R>): void
  /** The capability's part of its two enhanced tools; core decides when they are registered and for whom they are masked. */
  readonly enhanced: CapabilityEnhanced<S, O, Q, R>
}
