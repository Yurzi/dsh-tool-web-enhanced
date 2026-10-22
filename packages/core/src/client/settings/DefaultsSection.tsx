import type { ReactNode } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { configurationState } from './ServicesSection.tsx'
import type { ClientTranslate } from '../command.ts'
import type { BuiltinAccess } from './model.ts'
import type { SettingsDoc, SettingsParts, WriteSettings, SelectOption } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'

export type DefaultsCopyKey = 'title' | 'connection' | 'connectionHint' | 'connectionUnset' | 'connectionMissing'
export interface DefaultsControls {
  readonly disabled: boolean
  readonly save: (path: string[], target: unknown, fallback?: unknown) => void
}

/** Default connection plus capability-owned controls sharing one write/error state. */
export function createDefaultsSection<K extends string>({ parts: { Section, SettingRow, SelectMenu, ErrorText, useWrite }, sparse, keys }: {
  parts: SettingsParts<K>
  sparse: SparseSettings
  keys: Readonly<Record<DefaultsCopyKey, K>>
}) {
  return function DefaultsSection({ doc, write, t, defaultConnection, defaultLabel, defaultAvailability, choices, children }: {
    doc: SettingsDoc
    write: WriteSettings
    t: ClientTranslate<K>
    defaultConnection: string | undefined
    defaultLabel: string
    defaultAvailability?: {
      readonly disabled: boolean
      readonly access: BuiltinAccess
      readonly credentialStatus: string | undefined
      readonly warning: string
    } | undefined
    choices: readonly SelectOption[]
    children?: (controls: DefaultsControls) => ReactNode
  }) {
    const action = useWrite(t)
    const disabled = !doc.editable || action.busy
    const save = (path: string[], target: unknown, fallback?: unknown) => {
      void action.run(() => write(layers => sparse.sparseSettingOperations(layers, path, target, fallback)))
    }
    const missing = defaultConnection !== undefined && !choices.some(choice => choice.id === defaultConnection)
    const warning = missing ? t(keys.connectionMissing, { id: defaultConnection })
      : defaultAvailability && (defaultAvailability.disabled || configurationState(true, defaultAvailability.access, defaultAvailability.credentialStatus) === 'warning')
        ? defaultAvailability.warning : undefined
    const connectionOptions = [
      { id: '', label: t(keys.connectionUnset, { name: defaultLabel }) },
      ...(missing ? [{ id: defaultConnection, label: t(keys.connectionMissing, { id: defaultConnection }) }] : []),
      ...choices,
    ]
    return (
      <Section title={t(keys.title)}>
        <SettingRow title={t(keys.connection)} hint={<>
          <span>{t(keys.connectionHint)}</span>
          {warning && <span role="status"><StateDot state="warning" />{warning}</span>}
        </>}>
          <SelectMenu label={t(keys.connection)} value={defaultConnection ?? ''} options={connectionOptions} disabled={disabled}
            onChange={next => { save(['defaultConnection'], next === '' ? undefined : next) }} />
        </SettingRow>
        {children?.({ disabled, save })}
        <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
      </Section>
    )
  }
}
