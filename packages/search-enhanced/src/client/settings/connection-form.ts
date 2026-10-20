/** Custom adapter editor; endpoint trust always comes from explicit consent. */
import { CREDENTIAL_REF, CUSTOM_CONNECTION_ID, CUSTOM_PREFIX, isEndpoint } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, type AdapterKey } from '../../catalog.ts'
import type { CustomConnection } from '../../settings/types.ts'
import { adapterFields, applyFields, fieldText, isValidText, type FieldSpec, type FieldTexts } from './model.ts'

export interface ConnectionForm {
  readonly kind: 'adapter'
  readonly id: string
  readonly label: string
  readonly credentialRef: string
  readonly options: FieldTexts
  readonly adapter: AdapterKey
  readonly endpoint: string
}
export type ConnectionKind = ConnectionForm['kind']
export type FormError = 'id' | 'duplicate' | 'label' | 'credentialRef' | 'endpoint' | 'options' | 'trust'
export type BuildResult =
  | { readonly ok: true; readonly id: string; readonly connection: CustomConnection }
  | { readonly ok: false; readonly error: FormError }

export function emptyForm(): ConnectionForm {
  return { kind: 'adapter', id: CUSTOM_PREFIX, label: '', credentialRef: '', options: {}, adapter: 'exa', endpoint: '' }
}
export function formOf(id: string, connection: CustomConnection): ConnectionForm {
  return { id, kind: 'adapter', label: connection.label, adapter: connection.adapter, credentialRef: connection.credentialRef,
    endpoint: connection.endpoint ?? '', options: Object.fromEntries(Object.entries(connection.options ?? {}).map(([name, value]) => [name, fieldText(value)])) }
}
export const formFields = (form: ConnectionForm): FieldSpec[] => adapterFields(form.adapter, 'api-key').fields
export function needsTrust(form: ConnectionForm): boolean {
  return form.endpoint.trim() !== '' && form.endpoint.trim() !== CATALOG[form.adapter].endpoint
}
export const asksTrust = needsTrust

export function suggestCredentialRef(id: string): string {
  const name = id.slice(CUSTOM_PREFIX.length).toUpperCase().replace(/[^A-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
  return name === '' ? '' : 'CUSTOM_' + name + '_API_KEY'
}

export function buildConnection(input: ConnectionForm, consent: boolean, taken: readonly string[], previous?: CustomConnection): BuildResult {
  const fail = (error: FormError): BuildResult => ({ ok: false, error })
  const form = { ...input, id: input.id.trim(), label: input.label.trim(), credentialRef: input.credentialRef.trim(), endpoint: input.endpoint.trim() }
  if (!CUSTOM_CONNECTION_ID.test(form.id)) return fail('id')
  if (taken.includes(form.id)) return fail('duplicate')
  if (form.label === '' || form.label.length > 200) return fail('label')
  if (!CREDENTIAL_REF.test(form.credentialRef) || form.credentialRef.length > 2000) return fail('credentialRef')
  const fields = formFields(form)
  if (!fields.every(field => isValidText(field, form.options[field.name] ?? ''))) return fail('options')
  if (form.endpoint !== '' && !isEndpoint(form.endpoint)) return fail('endpoint')
  const trusted = needsTrust(form)
  if (trusted && !consent) return fail('trust')
  const options = applyFields(fields, form.options, {})
  return { ok: true, id: form.id, connection: {
    kind: 'adapter', label: form.label, adapter: form.adapter, credentialRef: form.credentialRef,
    ...(form.endpoint === '' ? {} : { endpoint: form.endpoint }),
    ...(trusted ? { trustedEndpoint: true } : {}),
    ...(previous?.disabled === undefined ? {} : { disabled: previous.disabled }),
    ...(Object.keys(options).length === 0 ? {} : { options }),
  } }
}
