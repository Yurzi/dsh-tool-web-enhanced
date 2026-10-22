import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebError } from '@deepseek-ai/dsh-web'
import { isConnectionId, type ConnectionId } from '../../shared/index.ts'
import type { EnhancedAccess, Explicit, ExplicitCall } from '../enhanced.ts'
import { providerFailure, readyClause, rejectionError, type EnhancedVoice } from './wording.ts'

/** The longest `provider` argument checked against the connection id grammar. */
export const PROVIDER_ARGUMENT_MAX_LENGTH = 128

/** An argument error in DSH's own form, without the package prefix. */
export function invalidArguments(problem: string): Error {
  return new Error(`invalid arguments: ${problem}`)
}

/** DSH accepts extra properties on the open argument root; the enhanced tools refuse them without echoing the name. */
export function rejectUnknownProperties(args: object, known: readonly string[]): void {
  if (Object.keys(args).some(key => !known.includes(key))) throw invalidArguments('unknown property')
}

/** The caller DSH reports for this execution; a call without an Agent never falls back to a default connection. */
export function explicitCall(tool: string, exec: { readonly agent?: Agent | undefined; readonly signal: AbortSignal }): ExplicitCall {
  if (exec.agent === undefined) throw new Error(`${tool} can only be called by an Agent`)
  return { agent: exec.agent, signal: exec.signal }
}

/**
 * The model's `provider` argument, once it has the grammar of a connection id.
 * A malformed value is never echoed; the error names the ready providers instead.
 */
export async function providerArgument(voice: EnhancedVoice, value: string, access: Pick<EnhancedAccess<unknown, unknown, unknown>, 'ready'>, call: ExplicitCall): Promise<ConnectionId> {
  if (value.length > 0 && value.length <= PROVIDER_ARGUMENT_MAX_LENGTH && isConnectionId(value)) return value
  const ready = await access.ready(call)
  throw invalidArguments(`provider must be an id such as builtin:<key> or custom:<name>; ${readyClause(voice, ready)}`)
}

/**
 * Run one request on the named provider: a refusal is worded for the model,
 * a backend failure gets the switch-provider hint (docs/design.md, "增强工具的错误").
 */
export async function runOnProvider<O, Q, R>(
  voice: EnhancedVoice,
  access: EnhancedAccess<O, Q, R>,
  connectionId: ConnectionId,
  request: Q,
  call: ExplicitCall,
  unhinted: (error: WebError) => boolean = () => false,
): Promise<R> {
  let outcome: Explicit<R>
  try {
    outcome = await access.run(connectionId, request, call)
  } catch (cause) {
    throw providerFailure(voice, cause, connectionId, unhinted)
  }
  if (outcome.kind === 'rejected') throw rejectionError(voice, outcome.reason)
  return outcome.value
}
