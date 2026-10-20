import type { ConfigForm, ConfigFormSnapshot, SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'

export type SettingsDocumentSnapshot<S> = ConfigFormSnapshot<S> & { readonly diagnostic?: string }

/** Add public secret-presence diagnostics without guessing which redacted layer owns a secret. */
export function withRetiredSecretDiagnostics<S>(form: ConfigForm<S>, describe: SettingsDescribeFace, namespace: string, retiredFields: readonly string[], formatDiagnostic: (fields: readonly string[]) => string): ConfigForm<S> {
  let cached: { source: ConfigFormSnapshot<S>; diagnostic: string | undefined; snapshot: SettingsDocumentSnapshot<S> } | undefined
  const getSnapshot = (): SettingsDocumentSnapshot<S> => {
    const source = form.getSnapshot()
    const row = describe.getSnapshot().view?.namespaces.find(entry => entry.ns === namespace)
    const fields = row === undefined ? [] : row.secrets.filter(secret => secret.set && secret.path.length === 1 && retiredFields.includes(secret.path[0]!)).map(secret => secret.path[0]!)
    const diagnostic = fields.length === 0 ? undefined : formatDiagnostic(fields)
    if (cached === undefined || cached.source !== source || cached.diagnostic !== diagnostic) {
      cached = { source, diagnostic, snapshot: diagnostic === undefined ? source : { ...source, diagnostic } }
    }
    return cached.snapshot
  }
  return {
    getSnapshot,
    subscribe(listener) {
      let previous = getSnapshot()
      const notify = () => {
        const next = getSnapshot()
        if (next === previous) return
        previous = next
        listener()
      }
      const stopForm = form.subscribe(notify)
      const stopDescribe = describe.subscribe(notify)
      return () => { stopForm(); stopDescribe() }
    },
    mutate: (operations, revision) => form.mutate(operations, revision),
    set: (field, value) => form.set(field, value),
    unset: field => form.unset(field),
  }
}
