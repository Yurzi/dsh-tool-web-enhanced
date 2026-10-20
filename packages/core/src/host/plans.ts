import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebError } from '@deepseek-ai/dsh-web'
import type { Selection } from '../shared/index.ts'

/** Only identity and session options are frozen; targets always use current operator policy. */
export type Plan<O> =
  | { readonly kind: 'off' }
  | { readonly kind: 'failed'; readonly error: WebError }
  | { readonly kind: 'ready'; readonly connectionId: string; readonly options: O }

export function planFor<O>(selection: Selection<O>): Plan<O> {
  const { connectionId, options } = selection
  if (connectionId === null) return { kind: 'off' }
  return { kind: 'ready', connectionId, options: structuredClone(options) }
}

type Snapshot<P> = { readonly turn: number; readonly step: number } & (
  | { readonly kind: 'capturing'; readonly pending: Promise<void> }
  | { readonly kind: 'captured'; readonly plan: P }
)

/** Concurrent capture is shared; only failed captures may retry in the same step. */
export class Snapshots<P extends { readonly kind: string }> {
  private readonly steps = new WeakMap<Agent, Snapshot<P>>()

  capture(agent: Agent, turn: number, step: number, plan: () => Promise<P>): Promise<void> {
    const previous = this.steps.get(agent)
    if (previous !== undefined && previous.turn === turn && previous.step === step) {
      if (previous.kind === 'capturing') return previous.pending
      if (previous.plan.kind !== 'failed') return Promise.resolve()
    }
    const pending = plan().then(result => {
      if (this.steps.get(agent) === snapshot) this.steps.set(agent, { turn, step, kind: 'captured', plan: result })
    }, error => {
      if (this.steps.get(agent) === snapshot) this.steps.delete(agent)
      throw error
    })
    const snapshot: Snapshot<P> = { turn, step, kind: 'capturing', pending }
    this.steps.set(agent, snapshot)
    return pending
  }

  get(agent: Agent): P | undefined {
    const snapshot = this.steps.get(agent)
    return snapshot?.kind === 'captured' ? snapshot.plan : undefined
  }

  forget(agent: Agent): void { this.steps.delete(agent) }
}
