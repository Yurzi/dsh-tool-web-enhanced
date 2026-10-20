import { describe, expect, it } from 'vitest'
import { asksTrust, buildConnection, emptyForm, formOf, needsTrust, suggestCredentialRef, type ConnectionForm } from '../src/client/settings/connection-form.ts'
import { adapterFields, applyFields, connectionChoices, isValidText, type FieldSpec } from '../src/client/settings/model.ts'

describe('custom connection form', () => {
  const service = (patch: Partial<ConnectionForm> = {}) => ({ ...emptyForm(), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', ...patch }) as ConnectionForm

  it('saves a service on its official endpoint without trust', () => {
    expect(needsTrust(service())).toBe(false)
    expect(buildConnection(service({ label: '  Work  ' }), false, [])).toEqual({
      ok: true, id: 'custom:work', connection: { kind: 'adapter', label: 'Work', adapter: 'exa', credentialRef: 'WORK_KEY' },
    })
  })

  it('suggests a credential reference from the id and asks for trust once there is an address', () => {
    expect(suggestCredentialRef('custom:work-search.v2')).toBe('CUSTOM_WORK_SEARCH_V2_API_KEY')
    expect(suggestCredentialRef('custom:')).toBe('')
    expect(asksTrust(service({ endpoint: '' }))).toBe(false)
    expect(asksTrust(service({ endpoint: 'https://proxy.example/search' }))).toBe(true)
  })

  it('requires explicit trust for another endpoint', () => {
    const custom = service({ endpoint: 'https://proxy.example/search' })
    expect(buildConnection(custom, false, [])).toEqual({ ok: false, error: 'trust' })
    expect(buildConnection(custom, true, [])).toMatchObject({ ok: true, connection: { endpoint: 'https://proxy.example/search', trustedEndpoint: true } })

  })

  it.each(['?token=secret', '#fragment'])('rejects endpoint suffix %s consistently with the shared endpoint contract', suffix => {
    expect(buildConnection(service({ endpoint: 'https://api.example/search' + suffix }), true, [])).toEqual({ ok: false, error: 'endpoint' })
  })

  it('offers custom adapters as defaults', () => {
    const result = buildConnection(service(), false, [])
    if (!result.ok) throw new Error('expected an adapter fixture')
    expect(connectionChoices({ connections: { [result.id]: result.connection } }, key => key).some(choice => choice.id === result.id)).toBe(true)
  })

  it('reports the first invalid field by code', () => {
    expect(buildConnection(service({ id: 'builtin:exa' }), true, [])).toEqual({ ok: false, error: 'id' })
    expect(buildConnection(service(), true, ['custom:work'])).toEqual({ ok: false, error: 'duplicate' })
    expect(buildConnection(service({ label: ' ' }), true, [])).toEqual({ ok: false, error: 'label' })
    expect(buildConnection(service({ credentialRef: '' }), true, [])).toEqual({ ok: false, error: 'credentialRef' })
    expect(buildConnection(service({ credentialRef: '1KEY' }), true, [])).toEqual({ ok: false, error: 'credentialRef' })
    expect(buildConnection(service({ endpoint: 'ftp://x' }), true, [])).toEqual({ ok: false, error: 'endpoint' })
    expect(buildConnection(service({ options: { type: 'invalid' } }), true, [])).toEqual({ ok: false, error: 'options' })
  })

  it('round-trips through formOf', () => {
    const original = service({ endpoint: 'https://proxy.example/search', options: { type: 'instant' } })
    const { connection } = buildConnection(original, true, []) as { connection: any }
    expect(formOf('custom:work', connection)).toEqual({
      id: 'custom:work', kind: 'adapter', label: 'Work', adapter: 'exa', credentialRef: 'WORK_KEY',
      endpoint: 'https://proxy.example/search', options: { type: 'instant' },
    })
  })
})

describe('adapter field validation', () => {
  it('validates URL fields with the shared endpoint rules', () => {
    const field: FieldSpec = { name: 'baseURL', label: 'option.native.baseURL', kind: 'url', values: [], placeholder: () => undefined }
    expect(isValidText(field, 'https://api.example/v1')).toBe(true)
    for (const value of ['ftp://api.example', 'https://user:secret@api.example/v1', 'https://api.example?token=1', 'https://api.example#fragment']) {
      expect(isValidText(field, value)).toBe(false)
    }
  })

  it('identifies valid and invalid field values', () => {
    const { fields } = adapterFields('firecrawl', 'api-key')
    const countryField = fields.find(f => f.name === 'country')!
    expect(countryField).toBeDefined()
    expect(isValidText(countryField, 'us')).toBe(true)
    expect(isValidText(countryField, 'usa')).toBe(false)
    expect(isValidText(countryField, '')).toBe(true)

    const exaFields = adapterFields('exa', 'api-key').fields
    const typeField = exaFields.find(f => f.name === 'type')!
    expect(isValidText(typeField, 'fast')).toBe(true)
    expect(isValidText(typeField, 'slow')).toBe(false)
  })

  it('applies field values and removes empty options', () => {
    const { fields } = adapterFields('firecrawl', 'api-key')
    const texts = { country: 'us', location: '' }
    const applied = applyFields(fields, texts, { safe: true, location: 'old' })
    expect(applied).toEqual({ country: 'us', safe: true })
  })

})
