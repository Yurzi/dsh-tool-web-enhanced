import { SelectionConflict, type CurrentSelection, type SessionChange, type SessionTarget } from './sessions.ts'

export interface SelectionWriter<O> {
  selectable(connectionId: string): boolean
  change(target: SessionTarget, change: SessionChange<O>, expectedRevision: number): Promise<CurrentSelection<O>>
}

export type SelectionWrite<O> =
  | { readonly kind: 'written'; readonly current: CurrentSelection<O> }
  | { readonly kind: 'unavailable'; readonly connectionId: string }
  | { readonly kind: 'conflict' }

/** The shared eligibility check and revisioned write for commands and Remote set. */
export async function writeSelection<O>(sessions: SelectionWriter<O>, target: SessionTarget, change: SessionChange<O>, expectedRevision: number): Promise<SelectionWrite<O>> {
  if (typeof change.connectionId === 'string' && !sessions.selectable(change.connectionId)) {
    return { kind: 'unavailable', connectionId: change.connectionId }
  }
  try {
    return { kind: 'written', current: await sessions.change(target, change, expectedRevision) }
  } catch (error) {
    if (error instanceof SelectionConflict) return { kind: 'conflict' }
    throw error
  }
}
