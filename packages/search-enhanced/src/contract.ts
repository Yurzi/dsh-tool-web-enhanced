import type { TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { SEARCH, selectionContract, type ConnectionsRemoteErrors, type ConnectionsRemoteMap } from 'dsh-tool-web-enhanced-core/shared'
import { z } from 'zod'
import { FRESHNESS } from './catalog.ts'

export const contract = selectionContract({
  namespace: 'searchConnections', packageName: SEARCH.packageName,
  options: { freshness: z.enum(FRESHNESS) },
  extras: { freshness: z.boolean() },
})
/** The Session options schema; `contract.optionsChange` accepts any subset of it. */
export const searchOptions = contract.options

export type SearchConnectionView = z.infer<typeof contract.connectionView>
export type SearchSelectionView = z.infer<typeof contract.selectionView>
export type SearchSelectionChange = z.infer<typeof contract.selectionChange>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap extends ConnectionsRemoteMap<'searchConnections', SearchSelectionView, SearchSelectionChange> {}
  interface TypertRemoteNamespaceMap {
    searchConnections: TypertRemoteNamespace<'searchConnections'>
  }
  interface RemoteErrorDetailsMap extends ConnectionsRemoteErrors<'searchConnections'> {}
}
