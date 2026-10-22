/**
 * Custom connection form: a catalog adapter, or a model protocol the plugin
 * passes. Endpoint trust always comes from explicit consent, given for one
 * destination.
 */
import { CREDENTIAL_REF, CUSTOM_CONNECTION_ID, CUSTOM_PREFIX, type ProtocolDescriptor } from '../../shared/connections.ts'
import { singleLine } from '../../shared/settings.ts'
import { isEndpoint } from '../../shared/url.ts'
import { applyFields, conflictOf, fieldText, isValidText, type FieldTexts, type OptionField } from './fields.ts'
import { adapterKeys, catalogEntry, catalogFields, type AdapterKeyOf, type CustomConnection, type OptionCopyTable, type SettingsCatalog } from './model.ts'

/** What a custom connection talks to: a catalog adapter, or a model over one protocol. */
export type Format<A extends string = string, P extends string = string> =
  | { readonly kind: 'adapter'; readonly adapter: A }
  | { readonly kind: 'model'; readonly protocol: P }

interface FormFields {
  readonly id: string
  readonly label: string
  readonly credentialRef: string
  readonly options: FieldTexts
  readonly endpoint: string
}
export type ConnectionForm<A extends string = string, P extends string = string> =
  | FormFields & { readonly kind: 'adapter'; readonly adapter: A }
  | FormFields & { readonly kind: 'model'; readonly protocol: P; readonly model: string }

export type FormError = 'id' | 'duplicate' | 'label' | 'model' | 'credentialRef' | 'endpoint' | 'options' | 'trust'
export type BuildResult<A extends string = string, P extends string = string> =
  | { readonly ok: true; readonly id: string; readonly connection: CustomConnection<A, P> }
  | { readonly ok: false; readonly error: FormError }

/** The model protocols a capability offers to custom connections, with copy for their options. */
export interface ProtocolTable<P extends string, K extends string> {
  readonly catalog: Readonly<Record<P, ProtocolDescriptor>>
  readonly optionCopy: (protocol: P) => OptionCopyTable<K>
}

/** Same bound as the settings grammar: 1–200 characters, no control characters. */
const MODEL_ID = /^[^\p{Cc}]{1,200}$/u

export function emptyForm<A extends string, P extends string>(format: Format<A, P>): ConnectionForm<A, P> {
  const fields: FormFields = { id: CUSTOM_PREFIX, label: '', credentialRef: '', options: {}, endpoint: '' }
  return format.kind === 'adapter'
    ? { ...fields, kind: 'adapter', adapter: format.adapter }
    : { ...fields, kind: 'model', protocol: format.protocol, model: '' }
}

/** The form in another format: name, id, credential and endpoint stay; options belong to the format they were set for. */
export function withFormat<A extends string, P extends string>(form: ConnectionForm<A, P>, format: Format<A, P>): ConnectionForm<A, P> {
  const fields: FormFields = { id: form.id, label: form.label, credentialRef: form.credentialRef, endpoint: form.endpoint, options: {} }
  if (format.kind === 'adapter') return { ...fields, kind: 'adapter', adapter: format.adapter }
  return { ...fields, kind: 'model', protocol: format.protocol, model: form.kind === 'model' ? form.model : '' }
}

export function formatOf<A extends string, P extends string>(form: ConnectionForm<A, P> | CustomConnection<A, P>): Format<A, P> {
  return form.kind === 'adapter' ? { kind: 'adapter', adapter: form.adapter } : { kind: 'model', protocol: form.protocol }
}

/** A stable key of a format, unique across adapters and protocols. */
export function formatKey(format: Format): string {
  return format.kind === 'adapter' ? 'adapter:' + format.adapter : 'model:' + format.protocol
}

export function formOf<A extends string, P extends string>(id: string, connection: CustomConnection<A, P>): ConnectionForm<A, P> {
  const options = connection.options === undefined ? {} : connection.options
  const fields: FormFields = {
    id, label: singleLine(connection.label), credentialRef: connection.credentialRef,
    endpoint: connection.endpoint === undefined ? '' : connection.endpoint,
    options: Object.fromEntries(Object.entries(options).map(([name, value]) => [name, fieldText(value)])),
  }
  return connection.kind === 'adapter'
    ? { ...fields, kind: 'adapter', adapter: connection.adapter }
    : { ...fields, kind: 'model', protocol: connection.protocol, model: connection.model }
}

export function suggestCredentialRef(id: string): string {
  const name = id.slice(CUSTOM_PREFIX.length).toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return name === '' ? '' : 'CUSTOM_' + name + '_API_KEY'
}

/**
 * The form rules of one catalog: its adapter entries, then the protocols the
 * plugin passes, are the formats; options use the API-key route.
 */
export function createConnectionForm<T extends SettingsCatalog, K extends string, P extends string = never>({ catalog, optionCopy, protocols }: {
  catalog: T
  optionCopy: (key: AdapterKeyOf<T>) => OptionCopyTable<K>
  protocols?: ProtocolTable<P, K> | undefined
}) {
  type A = AdapterKeyOf<T>
  type Form = ConnectionForm<A, P>

  const protocolKeys = protocols === undefined ? [] : Object.keys(protocols.catalog) as P[]
  const formats: Format<A, P>[] = [
    ...adapterKeys(catalog).map(adapter => ({ kind: 'adapter', adapter }) as const),
    ...protocolKeys.map(protocol => ({ kind: 'model', protocol }) as const),
  ]

  function protocolEntry(protocol: P): { readonly info: ProtocolDescriptor; readonly copy: OptionCopyTable<K> } {
    if (protocols === undefined || !Object.hasOwn(protocols.catalog, protocol)) throw new Error('unknown protocol ' + protocol)
    return { info: protocols.catalog[protocol], copy: protocols.optionCopy(protocol) }
  }

  const formFields = (form: Form): OptionField<K>[] => {
    if (form.kind === 'adapter') {
      const entry = catalogEntry(catalog, form.adapter)
      return catalogFields(entry.options, 'api-key', optionCopy(form.adapter), entry.exclusive).fields
    }
    const { info, copy } = protocolEntry(form.protocol)
    return catalogFields(info.options, 'api-key', copy, info.exclusive).fields
  }

  const urlTexts = (form: Form): string[] =>
    formFields(form).filter(field => field.kind === 'url').map(field => textOf(form.options, field.name).trim())

  /**
   * Another endpoint, or a URL option off the catalog endpoint, sends the key
   * elsewhere. A model connection has no catalog endpoint to compare with: it
   * always needs trust.
   */
  function needsTrust(form: Form): boolean {
    if (form.kind === 'model') return true
    const official = catalogEntry(catalog, form.adapter).endpoint
    const differs = (text: string) => text !== '' && text !== official
    return [form.endpoint.trim(), ...urlTexts(form)].some(differs)
  }

  /** Everything that decides where the key goes; endpoint consent is given for one destination. */
  const destination = (form: Form): string => JSON.stringify([formatKey(formatOf(form)), form.endpoint.trim(), ...urlTexts(form)])

  function buildConnection(input: Form, consent: boolean, taken: readonly string[], previous?: CustomConnection<A, P>): BuildResult<A, P> {
    const fail = (error: FormError): BuildResult<A, P> => ({ ok: false, error })
    const form: Form = { ...input, id: input.id.trim(), label: singleLine(input.label), credentialRef: input.credentialRef.trim(), endpoint: input.endpoint.trim() }
    if (!CUSTOM_CONNECTION_ID.test(form.id)) return fail('id')
    if (taken.includes(form.id)) return fail('duplicate')
    if (form.label === '' || form.label.length > 200) return fail('label')
    const model = form.kind === 'model' ? form.model.trim() : ''
    if (form.kind === 'model' && !MODEL_ID.test(model)) return fail('model')
    if (!CREDENTIAL_REF.test(form.credentialRef) || form.credentialRef.length > 2000) return fail('credentialRef')
    const fields = formFields(form)
    const valid = (field: OptionField<K>) => isValidText(field, textOf(form.options, field.name)) && conflictOf(field, fields, form.options) === undefined
    if (!fields.every(valid)) return fail('options')
    // A model connection names its endpoint; an adapter one may leave it to the catalog.
    const endpointMissing = form.endpoint === '' && form.kind === 'model'
    if (endpointMissing || (form.endpoint !== '' && !isEndpoint(form.endpoint))) return fail('endpoint')
    const trusted = needsTrust(form)
    if (trusted && !consent) return fail('trust')
    const options = applyFields(fields, form.options, {})
    const common = {
      label: form.label, credentialRef: form.credentialRef,
      ...(previous === undefined || previous.disabled === undefined ? {} : { disabled: previous.disabled }),
      ...(Object.keys(options).length === 0 ? {} : { options }),
    }
    if (form.kind === 'model') {
      return { ok: true, id: form.id, connection: { ...common, kind: 'model', protocol: form.protocol, model, endpoint: form.endpoint, trustedEndpoint: true } }
    }
    return { ok: true, id: form.id, connection: {
      ...common, kind: 'adapter', adapter: form.adapter,
      ...(form.endpoint === '' ? {} : { endpoint: form.endpoint }),
      ...(trusted ? { trustedEndpoint: true } : {}),
    } }
  }

  return { formats, formFields, needsTrust, destination, buildConnection }
}
export type ConnectionFormRules<T extends SettingsCatalog, K extends string, P extends string = never> = ReturnType<typeof createConnectionForm<T, K, P>>

function textOf(texts: FieldTexts, name: string): string {
  return Object.hasOwn(texts, name) ? texts[name]! : ''
}
