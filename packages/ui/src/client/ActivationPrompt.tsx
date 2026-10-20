import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginActivationOwnerProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

export type ActivationPromptProps = PluginActivationOwnerProps & PropsLocale<typeof NS>

export function ActivationPrompt({ onDismiss, onOpenDetails, t }: ActivationPromptProps) {
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
      <p>{t('activation.body')}</p>
    </Modal>
  )
}
