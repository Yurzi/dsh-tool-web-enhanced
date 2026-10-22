import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginActivationOwnerProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useObservable } from 'dsh-tool-web-enhanced-core/client'
import { checkUpgradePreflight } from './preflight.ts'

export type ActivationPromptProps = PluginActivationOwnerProps & PropsLocale<typeof NS> & {
  readonly webConfigForm: ConfigForm<Record<string, unknown>>
  readonly nativeSearchServed: boolean
}

export function ActivationPrompt({ onDismiss, onOpenDetails, webConfigForm, nativeSearchServed, t }: ActivationPromptProps) {
  const web = useObservable(webConfigForm)
  const preflight = checkUpgradePreflight({ user: web.user, nativeSearchServed })
  const hasIssues = preflight.issues.length > 0
  return (
    <Modal
      open
      title={t('activation.title')}
      closeLabel={t('activation.close')}
      onClose={onDismiss}
      footer={
        <>
          <Button variant="ghost" onClick={onDismiss}>
            {t('activation.later')}
          </Button>
          <Button variant="primary" data-modal-autofocus onClick={onOpenDetails}>
            {t('activation.open')}
          </Button>
        </>
      }
    >
      {hasIssues ? <p>{t('activation.preflight')}</p> : <>
        <p>{t('activation.body')}</p>
        <p>{t('activation.remoteOff')}</p>
      </>}
    </Modal>
  )
}
