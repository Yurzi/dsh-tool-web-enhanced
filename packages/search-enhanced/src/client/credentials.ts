import { CredentialStatus as CoreCredentialStatus, editableSettings, type CredentialDescriber } from 'dsh-tool-web-enhanced-core/client'
import { resolveSettings } from '../settings/resolve.ts'
import type { Connection } from '../settings/resolve.ts'
import type { SearchSettings } from '../settings/types.ts'
export type { CredentialDescriber } from 'dsh-tool-web-enhanced-core/client'

/** The DSH credential a connection names; the Session-model connection uses the Session route's own. */
export function credentialRefsOf(connection: Connection): string[] {
  if (connection.kind !== 'model') return [connection.credentialRef]
  return connection.route.kind === 'fixed' ? [connection.route.credentialRef] : []
}

export class CredentialStatus extends CoreCredentialStatus<SearchSettings> {
  constructor(settings: () => SearchSettings | undefined, credentials: CredentialDescriber) {
    super(() => {
      const config = settings()
      if (config === undefined) return undefined
      const view = editableSettings<SearchSettings>(config, {}, false, resolveSettings)
      // The settings page presents this same validation diagnostic; invalid documents have no credential queries.
      return view.kind === 'ready' ? view.config : undefined
    }, credentials, config => [...resolveSettings(config).connections.values()].flatMap(credentialRefsOf))
  }
}
