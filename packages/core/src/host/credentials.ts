import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { ACCOUNT_PROVIDER, nextModel, requestModel } from './model.ts'

/** Credentials is authoritative; absence does not fall back to process.env. */
export async function resolveApiKey(ctx: Context, ref: string): Promise<string | undefined> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  const found = await credentials.resolve(credentialRef(ref))
  return found === undefined ? undefined : found.value
}

/** Route authentication retains DSH's launch-plane fallback only when Credentials is absent. */
export async function routeApiKey(ctx: Context, ref: string): Promise<string | undefined> {
  if (ctx.get('credentials') !== undefined) return resolveApiKey(ctx, ref)
  const ambient = launchEnvironmentOf(ctx).get(credentialRef(ref))
  return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
}

/** Readiness follows the same source boundary as routeApiKey, without resolving secrets. */
export async function routeKeyConfigured(ctx: Context, ref: string, source: 'credentials' | 'route'): Promise<boolean> {
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) return (await credentials.describe(credentialRef(ref))).configured
  if (source === 'credentials') return false
  const ambient = launchEnvironmentOf(ctx).get(credentialRef(ref))
  return ambient !== undefined && ambient.value.length > 0
}

/** Native providers use the same credential source as DSH model routes. */
export function nativeAuth(ctx: Context, ref: string, secrets = new Set<string>()) {
  const apiKeyEnv = credentialRef(ref)
  let resolverFailed = false
  const tracked = async (resolve: () => Promise<string | undefined>): Promise<string | undefined> => {
    try {
      const value = await resolve()
      if (value !== undefined) secrets.add(value)
      return value
    } catch {
      resolverFailed = true
      // A resolver can fail before returning any secret, so its text cannot be safely retained.
      throw new Error('Native credential resolution failed')
    }
  }
  return {
    apiKeyEnv,
    secrets,
    resolverFailed: () => resolverFailed,
    resolveAccountToken: (endpoint: string): Promise<string | undefined> => tracked(async () => {
      const resolve = accountTokenFor(ctx, ctx.get('agents')?.currentInitiator())
      return resolve === undefined ? undefined : await resolve(endpoint)
    }),
    resolveApiKey: () => tracked(() => routeApiKey(ctx, ref)),
  }
}

/** Account readiness uses the next selected model, while request authentication uses its frozen route. */
export async function credentialReadiness(ctx: Context, agent: Agent, options: { readonly endpoint?: string | undefined; readonly credentialRef: string }): Promise<{
  readonly access: 'account' | 'api-key'
  readonly status: 'ready' | 'needs-credential'
}> {
  const account = options.endpoint !== undefined && nextModel(ctx, agent)?.provider === ACCOUNT_PROVIDER ? ctx.get('deepseekAccount') : undefined
  if (account !== undefined && await account.resolveToken(options.endpoint!) !== undefined) return { access: 'account', status: 'ready' }
  const credentials = ctx.get('credentials')
  const credential = credentials === undefined ? undefined : await credentials.describe(credentialRef(options.credentialRef))
  return { access: 'api-key', status: credential?.configured === true ? 'ready' : 'needs-credential' }
}

/** Account tokens are available only on a resolved deepseek-account request route. */
export function accountTokenFor(ctx: Context, agent: Agent | undefined): ((endpoint: string) => Promise<string | undefined>) | undefined {
  if (agent === undefined || requestModel(agent)?.provider !== ACCOUNT_PROVIDER) return undefined
  const account = ctx.get('deepseekAccount')
  return account === undefined ? undefined : endpoint => account.resolveToken(endpoint)
}
