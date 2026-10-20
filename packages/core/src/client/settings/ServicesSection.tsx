/** Catalog-driven built-in connection controls; local-only editors slot into the panel. */
import { useId, useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutlineRegular, IconRightUpOutlineRegular, SegmentedControl, StateDot, Switch, Tag, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { builtinId, type AccessMode, type Descriptor } from '../../shared/connections.ts'
import type { CredentialStatusMap } from '../credentials.ts'
import type { ClientTranslate } from '../command.ts'
import type { CredentialEditorComponent, SaveCredential } from './CredentialEditor.tsx'
import type { OptionsEditor } from './OptionsEditor.tsx'
import type { OptionField } from './fields.ts'
import { classNames, type SettingsClasses, type SettingsParts, type SettingsDoc, type WriteSettings } from './parts.tsx'
import type { SparseSettings } from './sparse.ts'

/** Configuration only, not service health or a conversation's account availability. */
export function configurationState(enabled: boolean, access: AccessMode, status: string | undefined): StateDotState {
  if (!enabled) return 'idle'
  if (access === 'keyless' || status === 'configured') return 'done'
  return 'warning'
}

export interface BuiltinEditorOverride {
  readonly label?: string
  readonly disabled?: boolean
  readonly access?: AccessMode
  readonly credentialRef?: string
  readonly options?: Readonly<Record<string, unknown>>
}
export type ServicesCopyKey = "services.title" | "options.hint" | "options.keylessMore" | "services.remoteNotice" | "services.off" | "services.configureLabel" | "services.configure" | "services.enable" | "services.access" | "services.accessKeyless" | "services.accessPersonal" | "services.accessHint.keyless" | "services.accessHint.apiKey" | "services.accountHint" | "services.getKey" | "options.title" | "services.keyless" | "services.account" | "services.personalKey" | "credential.set" | "credential.unset"
export function createServicesSection<S, C extends string, K extends string>({
  classes: css, keys, parts: { Section, ErrorText, useWrite }, CredentialEditor, optionsEditor: { OptionsForm }, sparse,
  catalog, overrideOf, fields, summary, extra, label,
}: {
  classes: SettingsClasses
  keys: Readonly<Record<ServicesCopyKey, K>>
  parts: SettingsParts<K>
  CredentialEditor: CredentialEditorComponent<K>
  optionsEditor: OptionsEditor<K>
  sparse: SparseSettings
  catalog: Readonly<Record<C, Descriptor>>
  label?: (key: C, t: ClientTranslate<K>) => string
  overrideOf: (config: S, key: C) => BuiltinEditorOverride
  fields: (key: C, access: AccessMode) => { fields: OptionField<K>[]; restricted: boolean }
  summary?: (key: C, access: AccessMode, ref: string, status: string | undefined, t: ClientTranslate<K>) => string
  extra?: (props: { catalogKey: C; doc: SettingsDoc<S>; write: WriteSettings; disabled: boolean; t: ClientTranslate<K> }) => ReactNode
}) {
  interface ServiceProps {
    doc: SettingsDoc<S>
    write: WriteSettings
    credentials: CredentialStatusMap
    saveCredential: SaveCredential
    t: ClientTranslate<K>
  }
  
  function ServicesSection(props: ServiceProps) {
    const catalogKeys = Object.keys(catalog) as C[]
    return (
      <Section title={props.t(keys['services.title'])}>
        <ul className={css.list}>
          {catalogKeys.map(key => <ServiceRow key={key} catalogKey={key} {...props} />)}
        </ul>
      </Section>
    )
  }
  
  function ServiceRow({ catalogKey, doc, write, credentials, saveCredential, t }: ServiceProps & { catalogKey: C }) {
    const id = useId()
    const [open, setOpen] = useState(false)
    const action = useWrite(t)
    
    const info = catalog[catalogKey]
    const connectionId = builtinId(catalogKey)
    const override = overrideOf(doc.config, catalogKey)
    const name = override.label ?? (label === undefined ? info.label : label(catalogKey, t))
    const access = info.access.keyless ? (override.access ?? 'keyless') : 'api-key'
    const credentialRef = override.credentialRef ?? (info.access.apiKey ? info.access.apiKey.credentialRef : '')
    const credentialStatus = credentials[credentialRef]
    const enabled = override.disabled !== true
    const disabled = !doc.editable || action.busy
  
    const save = (path: string[], target: unknown, fallback?: unknown) =>
      action.run(() => write(sparse.sparseSettingOperations(doc.layers, ['connections', connectionId, ...path], target, fallback)))
  
    const options = fields(catalogKey, access)
    const optionsHint = t(keys['options.hint']) + (options.restricted ? ' ' + t(keys['options.keylessMore']) : '')
  
    const remoteNoticeText = info.remote ? t(keys['services.remoteNotice'], { name }) : undefined
    const summaryText = summary === undefined ? accessSummary(catalogKey, access, credentialRef, credentialStatus, t) : summary(catalogKey, access, credentialRef, credentialStatus, t)
    const metaText = remoteNoticeText ? `${summaryText} · ${remoteNoticeText}` : summaryText
  
    return (
      <li className={css.row}>
        <div className={css.rowLine}>
          <StateDot state={configurationState(enabled, access, credentialStatus)} />
          <div className={css.rowMain}>
            <span className={css.rowTitle}>
              {name}
              {enabled ? null : <Tag tone="neutral">{t(keys['services.off'])}</Tag>}
            </span>
            <span className={css.rowMeta}>{metaText}</span>
          </div>
          <div className={css.rowActions}>
            <Button
              variant="ghost"
              size="sm"
              className={css.disclosure}
              aria-expanded={open}
              aria-controls={id}
              aria-label={t(keys['services.configureLabel'], { name })}
              onClick={() => { setOpen(!open) }}
            >
              {t(keys['services.configure'])}
              <IconChevronDownOutlineRegular className={classNames(css.disclosureIcon, open && css.disclosureOpen)} />
            </Button>
            <Switch
              checked={enabled}
              label={t(keys['services.enable'], { name })}
              disabled={disabled}
              onChange={next => void save(['disabled'], !next, false)}
            />
          </div>
        </div>
        <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
        {open ? (
          <div className={css.panel} id={id}>
            {remoteNoticeText ? <p className={css.note}>{remoteNoticeText}</p> : null}
            {info.access.keyless && info.access.apiKey ? (
              <div className={css.field}>
                <span className={css.fieldLabel}>{t(keys['services.access'])}</span>
                <SegmentedControl<AccessMode>
                  id={id + '-access'}
                  className={css.segmented}
                  label={t(keys['services.access'])}
                  value={access}
                  disabled={disabled}
                  options={[
                    { value: 'keyless', label: t(keys['services.accessKeyless']) },
                    { value: 'api-key', label: t(keys['services.accessPersonal']) },
                  ]}
                  onChange={next => void save(['access'], next, 'keyless')}
                />
                <p className={css.hint}>{t(keys[access === 'keyless' ? 'services.accessHint.keyless' : 'services.accessHint.apiKey'])}</p>
              </div>
            ) : null}
            {info.access.account ? <p className={css.note}>{t(keys['services.accountHint'])}</p> : null}
            {access === 'api-key' ? (
              <>
                <CredentialEditor credentialRef={credentialRef} status={credentialStatus} save={saveCredential} t={t} />
                {info.homepage ? (
                  <a className={css.link} href={info.homepage} target="_blank" rel="noopener noreferrer">
                    {t(keys['services.getKey'])}
                    <IconRightUpOutlineRegular size={12} />
                  </a>
                ) : null}
              </>
            ) : null}
            {extra?.({ catalogKey, doc, write, disabled, t })}
            <OptionsForm
              key={access}
              id={id + '-options'}
              title={t(keys['options.title'])}
              hint={optionsHint}
              fields={options.fields}
              stored={override.options ?? {}}
              disabled={disabled}
              t={t}
              onCommit={(optionName, value) => save(['options', optionName], value)}
            />
          </div>
        ) : null}
      </li>
    )
  }
  
  function accessSummary(key: C, access: AccessMode, ref: string, status: string | undefined, t: ClientTranslate<K>): string {
    if (access === 'keyless') return t(keys['services.keyless'])
    const info = catalog[key]
    const route = t(keys[info.access.account ? 'services.account' : 'services.personalKey'], { ref })
    if (status === 'configured') return route + ' · ' + t(keys['credential.set'])
    if (status === 'missing') return route + ' · ' + t(keys['credential.unset'])
    return route
  }
  return ServicesSection
}
