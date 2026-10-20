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

/** Native providers alone retain DSH's launch-plane fallback when Credentials is absent. */
export function nativeAuth(ctx: Context, ref: string) {
  const apiKeyEnv = credentialRef(ref)
  return {
    apiKeyEnv,
    resolveAccountToken: async (endpoint: string): Promise<string | undefined> => {
      const resolve = accountTokenFor(ctx, ctx.get('agents')?.currentInitiator())
      return resolve === undefined ? undefined : await resolve(endpoint)
    },
    resolveApiKey: async (): Promise<string | undefined> => {
      if (ctx.get('credentials') !== undefined) return resolveApiKey(ctx, ref)
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
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
