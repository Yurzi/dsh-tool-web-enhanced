import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientTranslate } from '../command.ts'
import type { SettingsClasses, SettingsParts, SettingsDoc, WriteSettings } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'
export type ResetCopyKey = "reset.confirm" | "reset.confirmButton" | "confirm.cancel" | "reset.hint" | "reset.button"
export function createResetSection<K extends string>({ classes: css, keys, parts: { ConfirmRow, ErrorText, useWrite }, sparse }: {
  classes: SettingsClasses
  keys: Readonly<Record<ResetCopyKey, K>>
  parts: SettingsParts<K>
  sparse: SparseSettings
}) {
  return function ResetSection({ doc, write, t }: { doc: SettingsDoc; write: WriteSettings; t: ClientTranslate<K> }) {
    const [confirming, setConfirming] = useState(false)
    const action = useWrite(t)
    const disabled = !doc.editable || action.busy
  
    const reset = async () => {
      if (await action.run(() => write(sparse.resetSettingsOperations(doc.layers)))) {
        setConfirming(false)
      }
    }
  
    return (
      <div className={css.reset}>
        {confirming ? (
          <ConfirmRow
            message={t(keys['reset.confirm'])}
            confirmLabel={t(keys['reset.confirmButton'])}
            cancelLabel={t(keys['confirm.cancel'])}
            disabled={disabled}
            onConfirm={() => { void reset() }}
            onCancel={() => { setConfirming(false) }}
          />
        ) : (
          <div className={css.confirmRow}>
            <span className={css.confirmText}>{t(keys['reset.hint'])}</span>
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => { setConfirming(true) }}>
              {t(keys['reset.button'])}
            </Button>
          </div>
        )}
        <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
      </div>
    )
  }
}
