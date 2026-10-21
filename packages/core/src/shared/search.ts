/** Search vocabulary shared by the catalog, settings, browser and the provider wires. */

/** Content-cache preference, not a publication-date filter. */
export const FRESHNESS = ['auto', 'fresh', 'realtime'] as const
export type Freshness = typeof FRESHNESS[number]
