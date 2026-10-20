/**
 * Whether the shared `web` row routes a capability to this plugin, judged the
 * way `WebRuntime` selects: the row's field, else the process environment
 * variable, else auto-selection. The Host reads the row through the public
 * Settings data; the browser reads it through `configForms.get('web')`. When
 * the row cannot be read, the answer is `unknown` and callers treat it as
 * "not routed".
 */

export type Route =
  /** The `web` row is not readable, or the Host has not answered yet. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'this' }
  /** Nothing pins a provider: `WebRuntime` auto-selects and fails while several are usable. */
  | { readonly kind: 'auto'; readonly providerId: string }
  /** Another provider serves the capability, so this plugin's settings have no effect. */
  | { readonly kind: 'other'; readonly provider: string; readonly providerId: string }

/** The two `web` row fields and the environment variables `WebRuntime` reads instead. */
export const WEB_ROW = 'web'
export const WEB_FIELD = { search: 'searchProvider', fetch: 'fetchProvider' } as const
export const WEB_ENV = { search: 'DSH_WEB_SEARCH_PROVIDER', fetch: 'DSH_WEB_FETCH_PROVIDER' } as const

/**
 * @param row - the `web` row's effective value, or undefined when it cannot be read.
 * @param field - which capability's field to judge.
 * @param envProvider - the process variable of that capability, or null when unset.
 * @param providerId - the id this plugin registered.
 */
export function routeOf(row: Readonly<Record<string, unknown>> | undefined, field: string, envProvider: string | null, providerId: string): Route {
  if (row === undefined) return { kind: 'unknown' }
  const configured = row[field]
  // Like `WebRuntime` (`config.searchProvider.get() ?? env`): only an absent field falls back to the variable.
  const pinned = typeof configured === 'string' ? configured : envProvider
  if (pinned === null) return { kind: 'auto', providerId }
  return pinned === providerId ? { kind: 'this' } : { kind: 'other', provider: pinned, providerId }
}

/** Whether the capability reaches this plugin; `unknown` and `auto` count as not routed. */
export const isRouted = (route: Route): boolean => route.kind === 'this'
