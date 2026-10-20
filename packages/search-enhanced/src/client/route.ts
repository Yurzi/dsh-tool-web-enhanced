import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { RouteStatus, clientRoute, type WebSelection } from 'dsh-tool-web-enhanced-core/client'
import { WEB_FIELD, type ProviderView } from 'dsh-tool-web-enhanced-core/shared'
import type { SearchConnectionsRemote } from './selection.ts'
export type { WebSelection } from 'dsh-tool-web-enhanced-core/client'
export const searchRoute = (web: ConfigFormSnapshot<WebSelection>, host: ProviderView | undefined) => clientRoute(web, host, WEB_FIELD.search)
export class SearchRouteStatus extends RouteStatus {
  constructor(web: ConfigForm<WebSelection>) { super(web, WEB_FIELD.search) }
  override attach(reader: SearchConnectionsRemote): () => void { return super.attach(reader) }
}
