import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Route } from '../../shared/route.ts'
import type { CredentialStatusMap } from '../credentials.ts'
import type { PairingsState } from '../pairings.ts'

/** Shared with the settings UI; the browser never reads credential values. */
export interface SettingsPageInjected<S> {
  readonly hooks: {
    readonly settings: ConfigForm<S>
    readonly credentials: ObservableSnapshot<CredentialStatusMap>
    readonly route: ObservableSnapshot<Route>
    readonly pairings: ObservableSnapshot<PairingsState>
  }
  mutate(ops: SettingsPathOpView[], revision: number): Promise<boolean>
  saveCredential(ref: string, value: string): Promise<void>
  refreshPairings(): Promise<void>
  forgetPairing(provider: string, model: string): Promise<void>
}
