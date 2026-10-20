import type { ConnectionsService } from 'dsh-tool-web-enhanced-core/host'
import type { FetchConnectionView } from '../contract.ts'
import type { FetchOptions } from './options.ts'

export type FetchConnectionsService = ConnectionsService<FetchOptions, FetchConnectionView>
declare module '@deepseek-ai/cordis' {
  interface Context { fetchConnections: FetchConnectionsService }
}
