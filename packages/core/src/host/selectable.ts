import type { BackendKind } from '../shared/connections.ts'

export interface ConnectionBase {
  readonly id: string
  readonly disabled: boolean
  readonly kind: BackendKind
}
export type Selectable<C extends ConnectionBase> = Exclude<C, { readonly kind: 'model' }>

/** One eligibility rule for memories, Remote changes, plans and per-call policy. */
export function isSelectable<C extends ConnectionBase>(connection: C | undefined): connection is Selectable<C> {
  return connection !== undefined && !connection.disabled && connection.kind !== 'model'
}
