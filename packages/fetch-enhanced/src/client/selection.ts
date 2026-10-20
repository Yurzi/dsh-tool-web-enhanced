import type { TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { ConnectionSelectionStore } from 'dsh-tool-web-enhanced-core/client'
import type { FetchSelectionView } from '../contract.ts'
export type { SelectionUpdate } from 'dsh-tool-web-enhanced-core/client'
export type FetchConnectionsRemote = TypertRemoteNamespace<'fetchConnections'>

export class FetchSelectionStore extends ConnectionSelectionStore<FetchSelectionView> {
  constructor(remote: FetchConnectionsRemote, changed: () => void = () => {}) {
    super(remote, changed)
  }
}
