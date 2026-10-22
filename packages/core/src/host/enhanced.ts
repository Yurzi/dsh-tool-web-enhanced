/**
 * Contract between core and a capability for its two enhanced model tools
 * (docs/design.md, "增强工具"). Core owns when the definitions are
 * registered and for which Agents they are masked; the capability supplies
 * the static definitions, their model-facing wording and its listing facts.
 * Model-facing text calls a connection a "provider".
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WebError } from '@deepseek-ai/dsh-web'
import type { EnhancedToolNames, UnsupportedReason } from '../shared/index.ts'
import type { CapabilitySettings, ConnectionOf } from './capability.ts'

/** The caller of an enhanced tool: the Agent DSH reports for the call, never a tool argument. */
export interface ExplicitCall {
  readonly agent: Agent
  readonly signal: AbortSignal
}

/**
 * The existing, ready entries of this conversation's list, in list order (readiness ignores
 * `disabled`), or `unread` when they could not be read: readiness threw, the call was
 * cancelled, or the list checks themselves reject. Lets the wording tell "none ready" from "unknown".
 */
export type ReadyProviders =
  | { readonly kind: 'read'; readonly ids: readonly string[] }
  | { readonly kind: 'unread' }

/** Why core refused before any backend ran; the capability's tool code words it for the model. */
export type Rejection =
  /** Not in this conversation's provider list. */
  | { readonly kind: 'unknown'; readonly connectionId: string; readonly ready: ReadyProviders }
  /** In the list, but the operator has since deleted the connection. */
  | { readonly kind: 'removed'; readonly connectionId: string; readonly ready: ReadyProviders }
  /** The Session turned the capability off for this step. */
  | { readonly kind: 'off' }
  /** Not offered to this conversation: not routed here, turned off by the operator, or no provider list. */
  | { readonly kind: 'withdrawn' }
  /** Core's own safe error, passed on unchanged: invalid settings, unreadable selection or readiness, plugin gone. */
  | { readonly kind: 'unavailable'; readonly error: WebError }

export type Explicit<T> =
  | { readonly kind: 'done'; readonly value: T }
  | { readonly kind: 'rejected'; readonly reason: Rejection }

/** Who receives the query or URL; the capability's tool code words it. */
export type Recipient =
  | { readonly kind: 'this-machine' }
  | { readonly kind: 'session-model'; readonly provider: string | undefined }
  /** `host` is the hostname of an operator endpoint that differs from the catalog's. */
  | { readonly kind: 'service'; readonly service: string; readonly host: string | undefined }

/** Secret-free capability facts about one listed connection. */
export interface ListingFacts {
  /** The catalog phrase on what the connection is for, when it has one. */
  readonly use: string | undefined
  readonly recipient: Recipient
  /** search: whether the connection applies the Session's freshness preference. */
  readonly appliesFreshness?: boolean
  /** fetch local: the operator allowlist notice, worded for "this provider". */
  readonly notice?: string
}

/** Local readiness only; `ready` never proves upstream access. */
export type ProviderReadiness =
  | { readonly status: 'ready' }
  /** `account`: the DeepSeek account token is unavailable, so the user must sign in again. */
  | { readonly status: 'needs-credential'; readonly credential: 'api-key' | 'account' }
  | { readonly status: 'unsupported'; readonly reason: UnsupportedReason }

export type ProviderEntry = { readonly id: string; readonly name: string; readonly facts: ListingFacts } & ProviderReadiness

export interface ProviderListing<O> {
  /** The connection this Session's own native tool uses in this step, and whether it is selectable now. */
  readonly session: { readonly connectionId: string; readonly selectable: boolean }
  /** The Session options frozen for this step (search: freshness). */
  readonly options: O
  /** The entries of this conversation's provider list that still exist, in list order. */
  readonly providers: readonly ProviderEntry[]
}

/** What core hands the capability's tool code; `run` and `list` run every check of docs/design.md, "增强工具". */
export interface EnhancedAccess<O, Q, R> {
  run(connectionId: string, request: Q, call: ExplicitCall): Promise<Explicit<R>>
  list(call: ExplicitCall): Promise<Explicit<ProviderListing<O>>>
  /**
   * What an `unknown` rejection's `ready` would hold, for an argument error that never reaches
   * `run`; `unread` whenever `list` would reject, readiness cannot be read, or the call is cancelled. Never throws.
   */
  ready(call: ExplicitCall): Promise<ReadyProviders>
}

export interface EnhancedTools {
  readonly action: ToolDefinition
  readonly list: ToolDefinition
}

/** A capability's part of its enhanced tools. */
export interface CapabilityEnhanced<S extends CapabilitySettings, O, Q, R> {
  readonly names: EnhancedToolNames
  /** Build the two static definitions once per install; core registers and masks them. */
  tools(access: EnhancedAccess<O, Q, R>): EnhancedTools
  /** Capability facts for one listed connection; no I/O and no secrets. */
  listing(connection: ConnectionOf<S>, call: ExplicitCall): ListingFacts
}
