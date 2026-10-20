/** Custom adapter connection form; endpoint trust always comes from explicit consent. */
import { CREDENTIAL_REF, CUSTOM_CONNECTION_ID, CUSTOM_PREFIX } from '../../shared/connections.ts'
import { isEndpoint } from '../../shared/url.ts'
import { applyFields, fieldText, isValidText, type FieldTexts, type OptionField } from './fields.ts'
import { adapterKeys, catalogEntry, catalogFields, type AdapterKeyOf, type CustomConnection, type OptionCopyTable, type SettingsCatalog } from './model.ts'

export interface ConnectionForm<A extends string = string> {
  readonly kind: 'adapter'
  readonly id: string
  readonly label: string
  readonly credentialRef: string
  readonly options: FieldTexts
  readonly adapter: A
  readonly endpoint: string
}
export type FormError = 'id' | 'duplicate' | 'label' | 'credentialRef' | 'endpoint' | 'options' | 'trust'
export type BuildResult<A extends string = string> =
  | { readonly ok: true; readonly id: string; readonly connection: CustomConnection<A> }
  | { readonly ok: false; readonly error: FormError }

export function emptyForm<A extends string>(adapter: A): ConnectionForm<A> {
  return { kind: 'adapter', id: CUSTOM_PREFIX, label: '', credentialRef: '', options: {}, adapter, endpoint: '' }
}

export function formOf<A extends string>(id: string, connection: CustomConnection<A>): ConnectionForm<A> {
  const options = connection.options === undefined ? {} : connection.options
  return {
    id, kind: 'adapter', label: connection.label, adapter: connection.adapter, credentialRef: connection.credentialRef,
    endpoint: connection.endpoint === undefined ? '' : connection.endpoint,
    options: Object.fromEntries(Object.entries(options).map(([name, value]) => [name, fieldText(value)])),
  }
}

export function suggestCredentialRef(id: string): string {
  const name = id.slice(CUSTOM_PREFIX.length).toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return name === '' ? '' : 'CUSTOM_' + name + '_API_KEY'
}

/** The form rules of one catalog: its adapter entries are the formats, options use the API-key route. */
export function createConnectionForm<T extends SettingsCatalog, K extends string>({ catalog, optionCopy }: {
  catalog: T
  optionCopy: (key: AdapterKeyOf<T>) => OptionCopyTable<K>
}) {
  type A = AdapterKeyOf<T>

  const formFields = (form: ConnectionForm<A>): OptionField<K>[] =>
    catalogFields(catalogEntry(catalog, form.adapter).options, 'api-key', optionCopy(form.adapter)).fields

  const urlTexts = (form: ConnectionForm<A>): string[] =>
    formFields(form).filter(field => field.kind === 'url').map(field => textOf(form.options, field.name).trim())

  /** Another endpoint, or a URL option off the catalog endpoint, sends the key elsewhere. */
  function needsTrust(form: ConnectionForm<A>): boolean {
    const official = catalogEntry(catalog, form.adapter).endpoint
    const differs = (text: string) => text !== '' && text !== official
    return [form.endpoint.trim(), ...urlTexts(form)].some(differs)
  }

  /** Everything that decides where the key goes; endpoint consent is given for one destination. */
  const destination = (form: ConnectionForm<A>): string => JSON.stringify([form.adapter, form.endpoint.trim(), ...urlTexts(form)])

  function buildConnection(input: ConnectionForm<A>, consent: boolean, taken: readonly string[], previous?: CustomConnection<A>): BuildResult<A> {
    const fail = (error: FormError): BuildResult<A> => ({ ok: false, error })
    const form = { ...input, id: input.id.trim(), label: input.label.trim(), credentialRef: input.credentialRef.trim(), endpoint: input.endpoint.trim() }
    if (!CUSTOM_CONNECTION_ID.test(form.id)) return fail('id')
    if (taken.includes(form.id)) return fail('duplicate')
    if (form.label === '' || form.label.length > 200) return fail('label')
    if (!CREDENTIAL_REF.test(form.credentialRef) || form.credentialRef.length > 2000) return fail('credentialRef')
    const fields = formFields(form)
    if (!fields.every(field => isValidText(field, textOf(form.options, field.name)))) return fail('options')
    if (form.endpoint !== '' && !isEndpoint(form.endpoint)) return fail('endpoint')
    const trusted = needsTrust(form)
    if (trusted && !consent) return fail('trust')
    const options = applyFields(fields, form.options, {})
    return { ok: true, id: form.id, connection: {
      kind: 'adapter', label: form.label, adapter: form.adapter, credentialRef: form.credentialRef,
      ...(form.endpoint === '' ? {} : { endpoint: form.endpoint }),
      ...(trusted ? { trustedEndpoint: true } : {}),
      ...(previous === undefined || previous.disabled === undefined ? {} : { disabled: previous.disabled }),
      ...(Object.keys(options).length === 0 ? {} : { options }),
    } }
  }

  return { adapters: adapterKeys(catalog), formFields, needsTrust, destination, buildConnection }
}
export type ConnectionFormRules<T extends SettingsCatalog, K extends string> = ReturnType<typeof createConnectionForm<T, K>>

function textOf(texts: FieldTexts, name: string): string {
  return Object.hasOwn(texts, name) ? texts[name]! : ''
}
