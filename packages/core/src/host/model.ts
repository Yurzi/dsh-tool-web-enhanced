/** Model identity from public Session and projection APIs, never tool arguments. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'

export interface SessionModel { readonly provider: string; readonly model: string }
export const ACCOUNT_PROVIDER = 'deepseek-account'

export function nextModel(ctx: Context, agent: Agent): SessionModel | undefined {
  const projections = ctx.get('sessionProjections')
  const pending = projections?.stateOf(agent.session, 'modelSelection')?.pending
  if (pending !== undefined && pending !== null) return complete(pending)
  const request = agent.session.requestHeader()
  return complete(request === undefined ? agent.options : request.config)
}

function complete(value: { readonly provider?: string | undefined; readonly model?: string | undefined }): SessionModel | undefined {
  if (!value.provider || !value.model) return undefined
  return { provider: value.provider, model: value.model }
}

/** The resolved route used for native account authentication; pending choices do not authenticate. */
export function requestModel(agent: Agent): SessionModel | undefined {
  const request = agent.session.requestContext()
  return request === undefined ? undefined : complete(request)
}
