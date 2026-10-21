/**
 * Catalog-driven built-in connection controls. Every entry gets its access
 * switch, credential, URL options with endpoint trust and a self-saving option
 * form from its catalog facts; a plugin registers extra editors by catalog key.
 * An entry without an access route of its own (a `model` entry following the
 * Session model) gets only its switch and options; its plugin says who
 * receives the query in the entry's summary and note.
 */
import { useId, useState, type ComponentType } from 'react'
import { Button, IconChevronDownOutlineRegular, IconRightUpOutlineRegular, SegmentedControl, StateDot, Switch, Tag, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { builtinId, type AccessMode } from '../../shared/connections.ts'
import type { SettingsDescriptor } from '../../shared/settings.ts'
import type { CredentialStatusMap } from '../credentials.ts'
import type { ClientTranslate } from '../command.ts'
import type { CredentialEditorComponent, SaveCredential } from './CredentialEditor.tsx'
import type { OptionGroup, OptionsEditor } from './OptionsEditor.tsx'
import { builtinAccess, builtinCredential, builtinOverride, catalogFields, keylessRejected, type BuiltinAccess, type CatalogSettings, type OptionCopyTable } from './model.ts'
import { applyOps, classNames, type SettingsClasses, type SettingsParts, type SettingsDoc, type WriteSettings } from './parts.tsx'
import { createServiceFields, type ServiceFieldsCopyKey } from './ServiceFields.tsx'
import type { SparseSettings } from './sparse.ts'

/**
 * Configuration only, not service health or a conversation's account
 * availability; only an API-key route needs something here. An entry without
 * an access route has nothing on this page to configure: neutral, not done.
 */
export function configurationState(enabled: boolean, access: BuiltinAccess, status: string | undefined): StateDotState {
  if (!enabled || access === 'none') return 'idle'
  if (access === 'keyless' || status === 'configured') return 'done'
  return 'warning'
}

export interface ExtraEditorProps<S, K extends string> {
  doc: SettingsDoc<S>
  write: WriteSettings
  disabled: boolean
  t: ClientTranslate<K>
}

/** A capability's own editor for one catalog entry. */
export interface ExtraEditor<S, K extends string> {
  /** Options this editor owns; the shared option form leaves them out. */
  readonly options: readonly string[]
  readonly Editor: ComponentType<ExtraEditorProps<S, K>>
}

export type ServicesCopyKey = ServiceFieldsCopyKey | "services.title" | "options.hint" | "options.keylessMore" | "services.remoteNotice" | "services.off" | "services.configureLabel" | "services.configure" | "services.enable" | "services.access" | "services.accessKeyless" | "services.accessPersonal" | "services.accessHint.keyless" | "services.accessHint.apiKey" | "services.accountHint" | "services.getKey" | "options.title" | "services.keyless" | "services.account" | "services.personalKey" | "credential.set" | "credential.unset"
export function createServicesSection<S extends CatalogSettings, C extends string, K extends string>({
  classes: css, keys, parts, CredentialEditor, optionsEditor: { OptionsForm }, sparse,
  catalog, optionCopy, label, notes = {}, summaries = {}, optionGroups = {}, extras = {},
}: {
  classes: SettingsClasses
  keys: Readonly<Record<ServicesCopyKey, K>>
  parts: SettingsParts<K>
  CredentialEditor: CredentialEditorComponent<K>
  optionsEditor: OptionsEditor<K>
  sparse: SparseSettings
  catalog: Readonly<Record<C, SettingsDescriptor>>
  /** Copy for the options of each catalog entry. */
  optionCopy: (key: C) => OptionCopyTable<K>
  label?: (key: C, t: ClientTranslate<K>) => string
  /** A plain note per entry, such as how a remote service caches or keeps what it receives, or who receives the query of an entry without a catalog endpoint. */
  notes?: { readonly [Key in C]?: K }
  /** A fixed row summary per entry in place of the access summary, such as how a local connection reaches pages; an entry without an access route needs one. */
  summaries?: { readonly [Key in C]?: K }
  /** Titled option groups per entry, such as the options each model protocol applies. */
  optionGroups?: { readonly [Key in C]?: readonly OptionGroup[] }
  extras?: { readonly [Key in C]?: ExtraEditor<S, K> }
}) {
  const { Section, ErrorText, useWrite } = parts
  const { CredentialRefField, UrlOptionField } = createServiceFields({ classes: css, keys, parts, sparse })

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
    const override = builtinOverride(doc.config, catalogKey)
    const name = override.label ?? (label === undefined ? info.label : label(catalogKey, t))
    const access = builtinAccess(info, override)
    // The route options are checked on; without an access route of its own nothing narrows an entry's options.
    const route: AccessMode = access === 'keyless' ? 'keyless' : 'api-key'
    const credential = builtinCredential(info, override)
    const credentialRef = credential === undefined ? undefined : credential.ref
    const credentialStatus = credentialRef === undefined ? undefined : credentials[credentialRef]
    const enabled = override.disabled !== true
    const disabled = !doc.editable || action.busy

    const operations = (path: string[], target: unknown, fallback?: unknown) =>
      sparse.sparseSettingOperations(doc.layers, ['connections', connectionId, ...path], target, fallback)
    const save = (path: string[], target: unknown, fallback?: unknown) => action.run(() => write(operations(path, target, fallback)))
    const stored = override.options === undefined ? {} : override.options
    const saveOptions = (changes: Readonly<Record<string, unknown>>) => action.run(() => {
      let layers = doc.layers
      const optionOps = Object.entries(changes).flatMap(([option, value]) => {
        const next = sparse.sparseSettingOperations(layers, ['connections', connectionId, 'options', option], value)
        // A sparse unset may prune an empty parent; subsequent paths must see
        // that change before this one atomic write is validated and submitted.
        layers = { ...layers, user: applyOps(layers.user, next) }
        return next
      })
      return write(optionOps)
    })

    /** The keyless route takes only the options it accepts; the rest go in the same write. */
    const switchAccess = (next: AccessMode) => {
      if (next === 'api-key') return save(['access'], next, 'keyless')
      const rejected = keylessRejected(info.options, stored)
      const kept = Object.fromEntries(Object.entries(stored).filter(([option]) => !rejected.includes(option)))
      const optionOps = rejected.length === 0 ? [] : operations(['options'], Object.keys(kept).length === 0 ? undefined : kept)
      return action.run(() => write([...operations(['access'], next, 'keyless'), ...optionOps]))
    }

    const note = notes[catalogKey]
    const extra = extras[catalogKey]
    const owned: readonly string[] = extra === undefined ? [] : extra.options
    const options = catalogFields(info.options, route, optionCopy(catalogKey), info.exclusive)
    const shared = options.fields.filter(field => !owned.includes(field.name))
    const urlFields = shared.filter(field => field.kind === 'url')
    const formFields = shared.filter(field => field.kind !== 'url')
    const optionsHint = t(keys['options.hint']) + (options.restricted ? ' ' + t(keys['options.keylessMore']) : '')

    // The catalog service receives the query at its own endpoint; without one, the plugin's note names the recipient.
    const remoteNoticeText = info.remote && info.endpoint !== undefined ? t(keys['services.remoteNotice'], { name }) : undefined
    // The summary stays short; who receives what is said once, in the panel.
    const summary = summaries[catalogKey]
    const summaryText = summary === undefined ? accessSummary(info, access, credentialRef, credentialStatus, t) : t(summary)

    return (
      <li className={css.row}>
        <div className={css.rowLine}>
          <StateDot state={configurationState(enabled, access, credentialStatus)} />
          <div className={css.rowMain}>
            <span className={css.rowTitle}>
              {name}
              {enabled ? null : <Tag tone="neutral">{t(keys['services.off'])}</Tag>}
            </span>
            <span className={css.rowMeta}>{summaryText}</span>
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
        {open ? null : <ErrorText title={action.errorTitle}>{action.error}</ErrorText>}
        {open ? (
          <div className={css.panel} id={id}>
            {remoteNoticeText ? <p className={css.note}>{remoteNoticeText}</p> : null}
            {note === undefined ? null : <p className={css.note}>{t(note)}</p>}
            {info.access.keyless && info.access.apiKey ? (
              <div className={css.field}>
                <span className={css.fieldLabel}>{t(keys['services.access'])}</span>
                <SegmentedControl<AccessMode>
                  id={id + '-access'}
                  className={css.segmented}
                  label={t(keys['services.access'])}
                  value={route}
                  disabled={disabled}
                  options={[
                    { value: 'keyless', label: t(keys['services.accessKeyless']) },
                    { value: 'api-key', label: t(keys['services.accessPersonal']) },
                  ]}
                  onChange={next => void switchAccess(next)}
                />
                <p className={css.hint}>{t(keys[access === 'keyless' ? 'services.accessHint.keyless' : 'services.accessHint.apiKey'])}</p>
              </div>
            ) : null}
            {info.access.account ? <p className={css.note}>{t(keys['services.accountHint'])}</p> : null}
            {access === 'api-key' && credential !== undefined ? (
              <>
                <CredentialRefField
                  connectionId={connectionId}
                  credentialRef={credential.ref}
                  catalogRef={credential.catalogRef}
                  doc={doc}
                  write={write}
                  disabled={disabled}
                  t={t}
                />
                <CredentialEditor credentialRef={credential.ref} status={credentialStatus} save={saveCredential} t={t} />
                {info.homepage ? (
                  <a className={css.link} href={info.homepage} target="_blank" rel="noopener noreferrer">
                    {t(keys['services.getKey'])}
                    <IconRightUpOutlineRegular size={12} />
                  </a>
                ) : null}
              </>
            ) : null}
            {extra === undefined ? null : <extra.Editor doc={doc} write={write} disabled={disabled} t={t} />}
            {urlFields.map(field => (
              <UrlOptionField
                key={field.name}
                connectionId={connectionId}
                field={field}
                official={info.endpoint}
                override={override}
                urlOptions={urlFields.map(candidate => candidate.name)}
                doc={doc}
                write={write}
                disabled={disabled}
                t={t}
              />
            ))}
            {formFields.length === 0 && options.restricted ? <p className={css.hint}>{t(keys['options.keylessMore'])}</p> : null}
            <OptionsForm
              key={access}
              id={id + '-options'}
              title={t(keys['options.title'])}
              hint={optionsHint}
              fields={formFields}
              groups={optionGroups[catalogKey]}
              stored={stored}
              disabled={disabled}
              t={t}
              onCommit={saveOptions}
            />
            {/* With the panel open, a refused write is reported after the fields it most likely came from. */}
            <ErrorText title={action.errorTitle}>{action.error}</ErrorText>
          </div>
        ) : null}
      </li>
    )
  }

  function accessSummary(info: SettingsDescriptor, access: BuiltinAccess, ref: string | undefined, status: string | undefined, t: ClientTranslate<K>): string {
    if (access === 'none') return ''
    if (access === 'keyless' || ref === undefined) return t(keys['services.keyless'])
    const route = t(keys[info.access.account ? 'services.account' : 'services.personalKey'], { ref })
    if (status === 'configured') return route + ' · ' + t(keys['credential.set'])
    if (status === 'missing') return route + ' · ' + t(keys['credential.unset'])
    return route
  }
  return ServicesSection
}
