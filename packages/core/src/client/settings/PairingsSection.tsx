import { useState } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PairingsState } from '../pairings.ts'
import type { ClientTranslate } from '../command.ts'
import type { SettingsClasses, SettingsParts } from './parts.tsx'
export type PairingsCopyKey = "pairings.forgetFailed" | "pairings.title" | "pairings.hint" | "pairings.failed" | "pairings.loading" | "pairings.empty" | "connection.off" | "saving" | "pairings.forget"
export function createPairingsSection<S, K extends string>({ classes: css, keys, parts: { Section, ErrorText }, formatConnectionName }: {
  classes: SettingsClasses
  keys: Readonly<Record<PairingsCopyKey, K>>
  parts: SettingsParts<K>
  formatConnectionName: (id: string, config: S, t: ClientTranslate<K>) => string
}) {
  function PairingsSection({
    pairingsState,
    config,
    forgetPairing,
    t,
  }: {
    pairingsState: PairingsState
    config: S
    forgetPairing: (provider: string, model: string) => Promise<void>
    t: ClientTranslate<K>
  }) {
    const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set())
    const [error, setError] = useState<string | undefined>(undefined)
  
    const handleForget = async (provider: string, model: string) => {
      const key = `${provider}:${model}`
      setBusyKeys(prev => new Set(prev).add(key))
      setError(undefined)
      try {
        await forgetPairing(provider, model)
      } catch {
        setError(t(keys['pairings.forgetFailed']))
      } finally {
        setBusyKeys(prev => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    }
  
    const items = pairingsState.state === 'ready' ? pairingsState.pairings : []
  
    return (
      <Section title={t(keys['pairings.title'])}>
        <p className={css.hint}>{t(keys['pairings.hint'])}</p>
        <ErrorText>{error}</ErrorText>
        {pairingsState.state === 'failed' ? (
          <ErrorText title={pairingsState.message}>{t(keys['pairings.failed'])}</ErrorText>
        ) : pairingsState.state === 'loading' ? (
          <p className={css.status} role="status">
            <StateDot state="ongoing" />
            {t(keys['pairings.loading'])}
          </p>
        ) : items.length === 0 ? (
          <p className={css.empty}>{t(keys['pairings.empty'])}</p>
        ) : (
          <ul className={css.list}>
            {items.map(pairing => {
              const itemKey = `${pairing.provider}:${pairing.model}`
              const isBusy = busyKeys.has(itemKey)
              const targetText = pairing.connectionId === null
                ? t(keys['connection.off'])
                : formatConnectionName(pairing.connectionId, config, t)
  
              return (
                <li key={itemKey} className={css.row}>
                  <div className={css.rowLine}>
                    <StateDot state={pairing.connectionId === null ? 'idle' : 'done'} />
                    <div className={css.rowMain}>
                      <span className={css.rowTitle}>
                        {pairing.provider} / {pairing.model}
                      </span>
                      <span className={css.rowMeta}>{targetText}</span>
                    </div>
                    <div className={css.rowActions}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => { void handleForget(pairing.provider, pairing.model) }}
                      >
                        {isBusy ? t(keys['saving']) : t(keys['pairings.forget'])}
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    )
  }
  
  
  return PairingsSection
}
