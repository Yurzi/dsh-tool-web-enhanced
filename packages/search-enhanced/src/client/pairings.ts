import { PairingsStatus as CorePairingsStatus } from 'dsh-tool-web-enhanced-core/client'
import type { SearchConnectionsRemote } from './selection.ts'
import type { Translate } from './connections.ts'
export class PairingsStatus extends CorePairingsStatus {
  constructor(remote: SearchConnectionsRemote, t: Translate) { super(remote, () => t('pairings.forgetFailed')) }
}
