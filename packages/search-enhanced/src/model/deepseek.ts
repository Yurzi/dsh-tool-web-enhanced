import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { routeCredential, routeEndpoint } from './bounds.ts'
import type { SessionRoute } from './types.ts'

export const DEEPSEEK_MESSAGES = { anthropicTool: 'web_search_20250305', thinking: { type: 'disabled' } } as const

export function isDeepseekProvider(provider: string): provider is 'deepseek-official' | 'deepseek-account' {
  return provider === 'deepseek-official' || provider === 'deepseek-account'
}

// DSH packages/llm/llm-deepseek/src/config.ts:115–118,300: the session
// endpoint, deliberately not web-search-deepseek's DEEPSEEK_SEARCH_BASE_URL.
const PUBLIC_BASE_URL = 'https://api.deepseek.com/anthropic'
const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'
// DSH packages/llm/llm-deepseek-api-key/src/config.ts:16,38.
const API_KEY_ENV = 'DEEPSEEK_API_KEY'

// Both providers use DeepSeekAdapter's Messages endpoint (DSH
// packages/llm/llm-deepseek/src/adapter.ts:138–144), never a protocol inferred
// from the model id or a configurable model override.
/** The two official routes share Messages; only their authentication differs. sessionRoute has already bounded `model`. */
export function deepseekRoute(provider: 'deepseek-official' | 'deepseek-account', config: Record<string, unknown>, environment: LaunchEnvironmentSnapshot, model: string): SessionRoute {
  const configuredURL = Object.hasOwn(config, 'baseURL') ? config.baseURL : undefined
  const baseURL = configuredURL ?? environment.get(BASE_URL_ENV)?.value ?? PUBLIC_BASE_URL
  if (!routeEndpoint(baseURL)) return { kind: 'unsupported', reason: 'endpoint' }
  // DSH packages/llm/llm-deepseek-account/src/index.ts:24,55–73:
  // account authentication never falls back to an API key.
  if (provider === 'deepseek-account') return { kind: 'route', route: { protocol: 'anthropic-messages', dialect: 'deepseek', model, baseURL, auth: { kind: 'account' } } }
  const configuredRef = Object.hasOwn(config, 'apiKeyEnv') ? config.apiKeyEnv : undefined
  const credentialRef = configuredRef ?? API_KEY_ENV
  if (!routeCredential(credentialRef)) return { kind: 'unsupported', reason: 'credential' }
  return { kind: 'route', route: { protocol: 'anthropic-messages', dialect: 'deepseek', model, baseURL, auth: { kind: 'api-key', credentialRef, source: 'route' } } }
}
