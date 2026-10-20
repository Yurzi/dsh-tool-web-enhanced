import type { TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { FETCH, selectionContract, type ConnectionsRemoteErrors, type ConnectionsRemoteMap } from 'dsh-tool-web-enhanced-core/shared'
import type { z } from 'zod'

export const contract = selectionContract({ namespace: 'fetchConnections', packageName: FETCH.packageName, options: {}, extras: {} })
export const fetchOptions = contract.options

export type FetchConnectionView = z.infer<typeof contract.connectionView>
export type FetchSelectionView = z.infer<typeof contract.selectionView>
export type FetchSelectionChange = z.infer<typeof contract.selectionChange>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap extends ConnectionsRemoteMap<'fetchConnections', FetchSelectionView, FetchSelectionChange> {}
  interface TypertRemoteNamespaceMap {
    fetchConnections: TypertRemoteNamespace<'fetchConnections'>
  }
  interface RemoteErrorDetailsMap extends ConnectionsRemoteErrors<'fetchConnections'> {}
}
