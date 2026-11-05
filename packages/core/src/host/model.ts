/** Model identity from public Agent and Session APIs, never tool arguments. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

export interface SessionModel { readonly provider: string; readonly model: string }
export const ACCOUNT_PROVIDER = 'deepseek-account'

export function nextModel(_ctx: Context, agent: Agent): SessionModel | undefined {
  const current = agent.model.current()
  return current === undefined ? undefined : complete(current)
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
