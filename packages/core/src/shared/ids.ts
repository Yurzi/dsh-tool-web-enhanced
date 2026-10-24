/**
 * Identities that bind the profile bundle, its rows, and both faces together.
 * The profile's patch writes these ids, the plugins register them, and the
 * browser faces key their slots by them; tests assert all three agree.
 * Nothing here imports Node, the browser, or a Host package.
 */

/** npm name of the profile bundle users install; the Plugins page keys bundle and row pages by it. */
export const PROFILE_PACKAGE = 'dsh-tool-web-enhanced-profile'

/** A package the profile mounts as one row. */
export interface RowIdentity {
  /** npm package name; the profile bundle depends on it and names it in its row. */
  readonly packageName: string
  /** Row id the profile patch inserts; also the Settings namespace and the Cordis plugin name. */
  readonly rowId: string
}

/**
 * The two model-facing tools a capability registers while the operator has
 * them turned on and the `web` row routes the capability to this plugin.
 * Model-facing text calls a connection a "provider".
 */
export interface EnhancedToolNames {
  /** Runs one request on a provider the Agent names. */
  readonly action: string
  /** Lists the providers the Agent may name in this conversation. */
  readonly list: string
}

/** A row that serves one web capability. */
export interface PluginIdentity extends RowIdentity {
  /** Provider id registered in `ctx.web`; the profile writes it into the `web` row. */
  readonly providerId: string
  readonly tools: EnhancedToolNames
  /** Host command, without the slash, that shows or changes the Session's connection. */
  readonly command: string
}

export const SEARCH: PluginIdentity = {
  packageName: 'dsh-web-search-enhanced',
  rowId: 'web-search-enhanced',
  providerId: 'search-enhanced',
  tools: { action: 'web_search_enhanced', list: 'list_web_search_providers' },
  command: 'setup-search',
}

export const FETCH: PluginIdentity = {
  packageName: 'dsh-web-fetch-enhanced',
  rowId: 'web-fetch-enhanced',
  providerId: 'fetch-enhanced',
  tools: { action: 'web_fetch_enhanced', list: 'list_web_fetch_providers' },
  command: 'setup-fetch',
}

/** The browser-only row holding the shared composer connection menu. */
export const UI: RowIdentity = {
  packageName: 'dsh-tool-web-enhanced-ui',
  rowId: 'tool-web-enhanced-ui',
}

/**
 * Key of a row's configuration page on the Plugins page (`plugins.row.config`).
 * @param row - the row the page configures.
 * @returns `<profile package>#<row id>`.
 */
export function rowConfigKey(row: RowIdentity): string {
  return `${PROFILE_PACKAGE}#${row.rowId}`
}
