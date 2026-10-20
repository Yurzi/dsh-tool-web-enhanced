import { useId, useState } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { CREDENTIAL_REF, isEndpoint } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, DEFAULT_LOCAL_SETTINGS, USER_AGENT_PATTERN, type CatalogKey } from '../../catalog.ts'
import type { Translate } from '../connections.ts'
import { AllowlistEditor } from './AllowlistEditor.tsx'
import { builtinOverride } from './model.ts'
import { ErrorText, useWrite, type SettingsDoc, type WriteSettings } from './parts.tsx'
import { sparseSettingOperations } from './sparse.ts'
import css from './Settings.module.css'

interface ExtraProps { catalogKey: CatalogKey; doc: SettingsDoc; write: WriteSettings; disabled: boolean; t: Translate }

export function ConnectionExtras(props: ExtraProps) {
  return props.catalogKey === 'local' ? <LocalExtras {...props} /> : <NativeExtras {...props} />
}

function LocalExtras({ doc, write, disabled, t }: ExtraProps) {
  const stored = builtinOverride(doc.config, 'local').options ?? {}
  return <>
    <AllowlistEditor allowCidrs={(stored.allowCidrs ?? []) as string[]} allowHostnames={(stored.allowHostnames ?? []) as string[]} disabled={disabled} revision={doc.revision} write={write} t={t} />
    <UserAgentEditor doc={doc} write={write} disabled={disabled} t={t} />
  </>
}

function UserAgentEditor({ doc, write, disabled, t }: Omit<ExtraProps, 'catalogKey'>) {
  const id = useId()
  const stored = builtinOverride(doc.config, 'local').options ?? {}
  const inherited = typeof stored.userAgent === 'string' ? stored.userAgent : DEFAULT_LOCAL_SETTINGS.userAgent
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const action = useWrite(t)
  const text = draft === undefined ? inherited : draft
  const valid = USER_AGENT_PATTERN.test(text)
  const commit = async (value: string | undefined) => {
    if (value !== undefined && !USER_AGENT_PATTERN.test(value)) return
    if (value === inherited) { setDraft(undefined); return }
    const ops = sparseSettingOperations(doc.layers, ['connections', 'builtin:local', 'options', 'userAgent'], value, DEFAULT_LOCAL_SETTINGS.userAgent)
    if (await action.run(() => write(ops))) setDraft(undefined)
  }
  return <div className={css.formField}>
    <label className={css.fieldLabel} htmlFor={id}>{t('option.local.userAgent')}</label>
    <div className={css.inline}>
      <Input id={id} className={css.input as string} value={text} disabled={disabled || action.busy} aria-invalid={!valid}
        onChange={event => { setDraft(event.target.value) }} onBlur={() => { void commit(text) }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void commit(text) } }} />
      <Button variant="ghost" disabled={disabled || action.busy} onClick={() => { void commit(undefined) }}>{t('option.local.userAgentReset')}</Button>
    </div>
    <p className={css.hint}>{t('option.local.userAgentHint')}</p>
    {valid ? null : <p className={css.fieldError}>{t('options.invalid')}</p>}
    <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
  </div>
}

function NativeExtras({ doc, write, disabled, t }: ExtraProps) {
  const id = useId()
  const override = builtinOverride(doc.config, 'deepseek-fetch-api')
  const storedURL = override.options?.baseURL
  const ref = override.credentialRef ?? CATALOG['deepseek-fetch-api'].access.apiKey.credentialRef
  const [refDraft, setRefDraft] = useState<string | undefined>(undefined)
  const [urlDraft, setUrlDraft] = useState<string | undefined>(undefined)
  const [trustDraft, setTrustDraft] = useState<boolean | undefined>(undefined)
  const action = useWrite(t)
  const reference = refDraft === undefined ? ref : refDraft
  const url = urlDraft === undefined ? (typeof storedURL === 'string' ? storedURL : '') : urlDraft
  const trusted = trustDraft === undefined ? override.trustedEndpoint === true : trustDraft
  const refValid = reference === '' || CREDENTIAL_REF.test(reference)
  const urlValid = url === '' || isEndpoint(url)
  const needsTrust = url !== '' && url !== CATALOG['deepseek-fetch-api'].endpoint
  const saveRef = async () => {
    if (!refValid || reference === ref) return
    const ops = sparseSettingOperations(doc.layers, ['connections', 'builtin:deepseek-fetch-api', 'credentialRef'], reference === '' ? undefined : reference, CATALOG['deepseek-fetch-api'].access.apiKey.credentialRef)
    if (await action.run(() => write(ops))) setRefDraft(undefined)
  }
  const saveEndpoint = async (trust: boolean) => {
    if (!urlValid || (needsTrust && !trust)) return
    const path = ['connections', 'builtin:deepseek-fetch-api']
    const ops = [
      ...sparseSettingOperations(doc.layers, [...path, 'options', 'baseURL'], url === '' ? undefined : url, CATALOG['deepseek-fetch-api'].endpoint),
      ...sparseSettingOperations(doc.layers, [...path, 'trustedEndpoint'], trust ? true : undefined),
    ]
    if (await action.run(() => write(ops))) { setUrlDraft(undefined); setTrustDraft(undefined) }
  }
  return <div className={css.formGrid}>
    <div className={css.formField}>
      <label className={css.fieldLabel} htmlFor={id + '-ref'}>{t('credential.reference')}</label>
      <Input id={id + '-ref'} value={reference} disabled={disabled || action.busy} aria-invalid={!refValid} spellCheck={false}
        onChange={event => { setRefDraft(event.target.value) }} onBlur={() => { void saveRef() }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveRef() } }} />
      <p className={css.hint}>{t('credential.referenceHint')}</p>
      {refValid ? null : <p className={css.fieldError}>{t('options.invalid')}</p>}
    </div>
    <div className={css.formField}>
      <label className={css.fieldLabel} htmlFor={id + '-url'}>{t('option.native.baseURL')}</label>
      <Input id={id + '-url'} type="url" value={url} placeholder={CATALOG['deepseek-fetch-api'].endpoint} disabled={disabled || action.busy} aria-invalid={!urlValid} spellCheck={false}
        onChange={event => { setUrlDraft(event.target.value) }} onBlur={() => { void saveEndpoint(trusted) }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveEndpoint(trusted) } }} />
      {urlValid ? null : <p className={css.fieldError}>{t('options.invalid')}</p>}
    </div>
    <div className={css.formWide}>
      <Switch checked={trusted} disabled={disabled || action.busy} label={t('option.native.trust')}
        onChange={next => { setTrustDraft(next); void saveEndpoint(next) }} />
    </div>
    <div className={css.formWide}><ErrorText title={action.errorTitle}>{action.error}</ErrorText></div>
  </div>
}
