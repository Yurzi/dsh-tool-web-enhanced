import type { TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { ConnectionSelectionStore, type SelectionState as CoreSelectionState } from 'dsh-tool-web-enhanced-core/client'
import type { SearchSelectionView } from '../contract.ts'
export type { SelectionUpdate, WriteResult } from 'dsh-tool-web-enhanced-core/client'
export type SearchConnectionsRemote = TypertRemoteNamespace<'searchConnections'>
export type SelectionState = CoreSelectionState<SearchSelectionView>
export class SearchSelectionStore extends ConnectionSelectionStore<SearchSelectionView> {
  constructor(remote: SearchConnectionsRemote, changed: () => void = () => {}) { super(remote, changed) }
}
