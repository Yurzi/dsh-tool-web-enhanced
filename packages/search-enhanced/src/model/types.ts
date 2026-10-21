/**
 * The `model` backend's contract: a route names the protocol, model, base
 * URL and how to authenticate; a Session route may instead be unsupported
 * for a reason the browser words. Built afresh for every call.
 */
import type { UnsupportedReason } from 'dsh-tool-web-enhanced-core/shared'
import type { ModelProtocol } from '../catalog.ts'

export type { ModelProtocol } from '../catalog.ts'

/**
 * `credentials`: DSH Credentials only, like every backend of this plugin.
 * `route`: the rule of the Session route itself (Credentials when the
 * service exists, else the launch environment), as DSH's own LLM routes do.
 */
export interface ApiKeyAuth {
  readonly kind: 'api-key'
  readonly credentialRef: string
  readonly source: 'credentials' | 'route'
}

/** The DeepSeek account token of the resolved `deepseek-account` request route; never falls back to a key. */
export interface AccountAuth { readonly kind: 'account' }

export type ModelAuth = ApiKeyAuth | AccountAuth

interface RouteBase {
  /** The model id sent upstream. */
  readonly model: string
  /**
   * `deepseek`: DeepSeek's own Messages routes, whose request defaults differ
   * from Anthropic's current standard (an accepted web_search version, thinking
   * disabled, as DSH's DeepSeek search sends). Every other route is `standard`.
   */
  readonly dialect: 'standard' | 'deepseek'
  /** The protocol root the request path is appended to (Messages roots gain `/v1` as DSH does). */
  readonly baseURL: string
}

/** Account sign-in exists only on DeepSeek's Messages route, so it never pairs with another protocol. */
export type ModelRoute =
  | RouteBase & { readonly protocol: ModelProtocol; readonly auth: ApiKeyAuth }
  | RouteBase & { readonly protocol: 'anthropic-messages'; readonly auth: AccountAuth }

export type SessionRoute =
  | { readonly kind: 'route'; readonly route: ModelRoute }
  | { readonly kind: 'unsupported'; readonly reason: UnsupportedReason }

/** Operator options of a model connection after catalog validation; each applies only where its protocol supports it (catalog MODEL_PROTOCOLS). */
export interface ModelOptions {
  readonly maxTokens?: number
  readonly anthropicTool?: 'web_search_20260318' | 'web_search_20260209' | 'web_search_20250305'
  readonly maxUses?: number
  readonly allowedCallers?: 'direct' | 'code_execution_20260120'
  readonly responseInclusion?: 'full' | 'excluded'
  readonly responsesTool?: 'web_search' | 'web_search_preview'
  readonly searchContextSize?: 'low' | 'medium' | 'high'
  readonly externalWebAccess?: boolean
  readonly returnTokenBudget?: 'default' | 'unlimited'
  readonly allowedDomains?: readonly string[]
  readonly blockedDomains?: readonly string[]
  readonly userCity?: string
  readonly userRegion?: string
  readonly userCountry?: string
  readonly userTimezone?: string
}
