/**
 * The row's Enhanced tools switch (docs/design.md, "开关与同意"): what turning
 * it on lets the Agent do, and what the operator agrees to by doing so.
 */
import { useId } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientTranslate } from '../command.ts'
import type { SettingsClasses, SettingsDoc, SettingsParts, WriteSettings } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'

export type EnhancedToolsCopyKey = 'title' | 'description' | 'consent'

/** The document field this section edits; both capability documents have it. */
export interface EnhancedToolsSettings {
  readonly enhancedTools?: boolean | undefined
}

export function createEnhancedToolsSection<K extends string>({ classes: css, parts: { Section, ErrorText, useWrite }, sparse, keys }: {
  classes: SettingsClasses
  parts: SettingsParts<K>
  sparse: SparseSettings
  keys: Readonly<Record<EnhancedToolsCopyKey, K>>
}) {
  return function EnhancedToolsSection({ doc, write, t }: {
    doc: SettingsDoc<EnhancedToolsSettings>
    write: WriteSettings
    t: ClientTranslate<K>
  }) {
    const id = useId()
    const action = useWrite(t)
    const enabled = doc.config.enhancedTools ?? false
    // Off unless a layer turns it on: the user layer stores only a difference from the inherited value.
    const save = (next: boolean) => action.run(() => write(layers => sparse.sparseSettingOperations(layers, ['enhancedTools'], next, false)))
    return (
      <Section title={t(keys.title)} titleId={id + '-title'}>
        {/* A screen reader entering the switch hears what it does and what turning it on agrees to. */}
        <div className={css.settingRow} role="group" aria-labelledby={id + '-title'} aria-describedby={id + '-description ' + id + '-consent'}>
          <div className={css.settingText}>
            <p id={id + '-description'} className={css.settingLead}>{t(keys.description)}</p>
            <p id={id + '-consent'} className={css.hint}>{t(keys.consent)}</p>
          </div>
          <div className={css.settingControl}>
            <Switch checked={enabled} label={t(keys.title)} disabled={!doc.editable || action.busy} onChange={next => void save(next)} />
          </div>
        </div>
        <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
      </Section>
    )
  }
}
