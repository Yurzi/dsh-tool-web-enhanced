import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { RouteStatus, type WebSelection } from 'dsh-tool-web-enhanced-core/client'
export type { WebSelection } from 'dsh-tool-web-enhanced-core/client'
export class FetchRouteStatus extends RouteStatus {
  constructor(web: ConfigForm<WebSelection>) { super(web, 'fetchProvider') }
}
