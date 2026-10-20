import { describe, expect, it } from 'vitest'
import { catalogFields } from 'dsh-tool-web-enhanced-core/client'
import { CATALOG } from '../src/catalog.ts'
import { connectionChoices, connectionName, optionCopy } from '../src/client/settings/model.ts'

describe('search catalog on the settings page', () => {
  it('offers the Exa search type only with a personal key', () => {
    const keyless = catalogFields(CATALOG.exa.options, 'keyless', optionCopy('exa'))
    expect(keyless.fields.map(field => field.name)).not.toContain('type')
    expect(keyless.restricted).toBe(true)
    const keyed = catalogFields(CATALOG.exa.options, 'api-key', optionCopy('exa')).fields.find(field => field.name === 'type')!
    expect(keyed).toMatchObject({ kind: 'enum', label: 'option.exa.type' })
    expect(keyed.values).toContain('fast')
  })

  it('labels every option of every entry with its own copy', () => {
    for (const key of Object.keys(CATALOG) as (keyof typeof CATALOG)[]) {
      for (const access of ['keyless', 'api-key'] as const) {
        for (const field of catalogFields(CATALOG[key].options, access, optionCopy(key)).fields) expect(field.label, key + '.' + field.name).not.toBe('options.title')
      }
    }
  })

  it('offers custom adapters as defaults and names them by their label', () => {
    const config = { connections: { 'custom:work': { kind: 'adapter' as const, label: 'Work', adapter: 'exa' as const, credentialRef: 'WORK_KEY' } } }
    expect(connectionChoices(config, key => key).at(-1)).toEqual({ id: 'custom:work', label: 'Work' })
    expect(connectionName('custom:work', config)).toBe('Work')
    expect(connectionName('builtin:exa', config)).toBe(CATALOG.exa.label)
  })
})
