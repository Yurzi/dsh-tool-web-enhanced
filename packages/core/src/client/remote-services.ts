/**
 * The composer menu's "more services in settings" fact, derived from the row
 * settings by the same resolution the Host uses (docs/design.md, "远程服务缺省停用").
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { builtinId, type Descriptor } from '../shared/connections.ts'
import { effectiveDocument, editableSettings } from './settings/document.ts'

/** What the fact reads of a resolved document. */
export interface ResolvedConnections {
  readonly connections: ReadonlyMap<string, { readonly disabled: boolean }>
}

/** Whether the catalog has remote services and every one of them is off. */
export function remoteServicesOff(catalog: Readonly<Record<string, Descriptor>>, resolved: ResolvedConnections): boolean {
  const remote = Object.keys(catalog).filter(key => catalog[key]!.optIn)
  return remote.length > 0 && remote.every(key => resolved.connections.get(builtinId(key))!.disabled)
}

/** The fact for the current row settings, recomputed only when the settings snapshot changes. */
export function remoteServicesOffSource<S>(settings: ObservableSnapshot<ConfigFormSnapshot<S>>, catalog: Readonly<Record<string, Descriptor>>, resolve: (document: unknown) => ResolvedConnections): ObservableSnapshot<boolean> {
  let cached: { readonly source: ConfigFormSnapshot<S>; readonly off: boolean } | undefined
  const compute = (source: ConfigFormSnapshot<S>): boolean => {
    if (source.value === undefined) return false
    const view = editableSettings(effectiveDocument(source), source, false, resolve)
    return view.kind === 'ready' && remoteServicesOff(catalog, resolve(view.config))
  }
  return {
    getSnapshot() {
      const source = settings.getSnapshot()
      if (cached === undefined || cached.source !== source) cached = { source, off: compute(source) }
      return cached.off
    },
    subscribe: listener => settings.subscribe(listener),
  }
}
