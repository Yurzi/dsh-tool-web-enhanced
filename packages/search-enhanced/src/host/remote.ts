import type { ConnectionsService } from 'dsh-tool-web-enhanced-core/host'
import type { SearchConnectionView } from '../contract.ts'
import type { SearchOptions } from './options.ts'

export type SearchConnectionsService = ConnectionsService<SearchOptions, SearchConnectionView>
declare module '@deepseek-ai/cordis' {
  interface Context { searchConnections: SearchConnectionsService }
}
