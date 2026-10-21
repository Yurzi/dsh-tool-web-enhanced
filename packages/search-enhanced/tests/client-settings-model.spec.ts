import { describe, expect, it } from 'vitest'
import { catalogFields } from 'dsh-tool-web-enhanced-core/client'
import { CATALOG, MODEL_OPTIONS, MODEL_PROTOCOLS, type ModelProtocol } from '../src/catalog.ts'
import { connectionChoices, connectionName, localLabel, optionCopy, protocolCopy, SESSION_MODEL_GROUPS } from '../src/client/settings/model.ts'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'

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

  it('labels and explains every option of every model protocol, with the domain rule of that protocol', () => {
    for (const protocol of Object.keys(MODEL_PROTOCOLS) as ModelProtocol[]) {
      for (const field of catalogFields(MODEL_PROTOCOLS[protocol].options, 'api-key', protocolCopy(protocol)).fields) {
        expect(field.label, protocol + '.' + field.name).not.toBe('options.title')
        // The location is explained once, on the city.
        if (!['userRegion', 'userCountry', 'userTimezone'].includes(field.name)) expect(field.hint, protocol + '.' + field.name).toBeDefined()
        else expect(field.hint, protocol + '.' + field.name).toBeUndefined()
      }
    }
    expect(protocolCopy('anthropic-messages').options.allowedDomains?.hint).toBe('option.model.domains.exclusiveHint')
    // A fixed connection's hints speak of its own protocol only.
    expect(['anthropic-messages', 'openai-responses', 'openai-chat-completions'].map(protocol => protocolCopy(protocol as ModelProtocol).options.maxTokens?.hint))
      .toEqual(['option.model.maxTokens.anthropicHint', 'option.model.maxTokens.responsesHint', 'option.model.maxTokens.chatHint'])
    expect(protocolCopy('anthropic-messages').options.anthropicTool?.hint).toBe('option.model.anthropicTool.fixedHint')
    expect(en['option.model.anthropicTool.fixedHint']).not.toMatch(/conversation|OpenAI/u)
    expect(optionCopy('session-model').options.maxTokens?.hint).toBe('option.model.maxTokens.hint')
    // The catalog declares the exclusive pair on Messages and on the conversation model only.
    const exclusive = (fields: ReturnType<typeof catalogFields>['fields']) => fields.find(field => field.name === 'allowedDomains')?.exclusive
    expect(exclusive(catalogFields(MODEL_PROTOCOLS['anthropic-messages'].options, 'api-key', protocolCopy('anthropic-messages'), MODEL_PROTOCOLS['anthropic-messages'].exclusive).fields)).toEqual(['blockedDomains'])
    expect(exclusive(catalogFields(CATALOG['session-model'].options, 'api-key', optionCopy('session-model'), CATALOG['session-model'].exclusive).fields)).toEqual(['blockedDomains'])
    expect('exclusive' in MODEL_PROTOCOLS['openai-responses']).toBe(false)
    expect(protocolCopy('openai-responses').options.blockedDomains?.hint).toBe('option.model.domains.bothHint')
    expect(optionCopy('session-model').options.allowedDomains?.hint).toBe('option.model.domains.sessionHint')
    expect(zh['option.model.domains.exclusiveHint']).toContain('二选一')
    expect(en['option.model.returnTokenBudget.hint']).toContain('GPT-5')
    // Group titles and the fixed protocol say where an option applies; hints do not repeat it.
    for (const key of Object.keys(en).filter(name => name.startsWith('option.model.') && name.endsWith('.hint')) as LocaleKey[]) {
      expect(en[key], key).not.toMatch(/^(?:All protocols|Anthropic Messages only|OpenAI Responses only)/u)
      expect(zh[key], key).not.toMatch(/^只对 (?:Anthropic Messages|OpenAI Responses) 生效/u)
    }
  })

  it('shows every option of the conversation-model connection once, in groups named by the protocols that apply them', () => {
    const grouped = SESSION_MODEL_GROUPS.flatMap(group => group.options)
    expect(grouped.toSorted()).toEqual(Object.keys(MODEL_OPTIONS).toSorted())
    expect(new Set(grouped).size).toBe(grouped.length)
    expect(SESSION_MODEL_GROUPS.find(group => group.options.includes('maxUses'))?.title).toBe('Anthropic Messages')
    expect(SESSION_MODEL_GROUPS.find(group => group.options.includes('searchContextSize'))?.title).toBe('OpenAI Responses / OpenAI Chat Completions')
    expect(SESSION_MODEL_GROUPS.find(group => group.options.includes('maxTokens'))?.options).toEqual(['maxTokens', 'userCity', 'userRegion', 'userCountry', 'userTimezone'])
  })

  it('names the conversation-model connection in the reader\'s language', () => {
    const t = (key: string) => zh[key as LocaleKey]
    expect(localLabel('session-model', t)).toBe('会话模型')
    expect(localLabel('exa', t)).toBe('Exa')
    expect(connectionChoices({}, t)).toContainEqual({ id: 'builtin:session-model', label: '会话模型' })
  })

  it('offers custom adapters as defaults and names them by their label', () => {
    const config = { connections: { 'custom:work': { kind: 'adapter' as const, label: 'Work', adapter: 'exa' as const, credentialRef: 'WORK_KEY' } } }
    expect(connectionChoices(config, key => key).at(-1)).toEqual({ id: 'custom:work', label: 'Work' })
    const t = (key: string) => zh[key as LocaleKey]
    expect(connectionName('custom:work', config, t)).toBe('Work')
    expect(connectionName('builtin:exa', config, t)).toBe(CATALOG.exa.label)
    expect(connectionName('builtin:session-model', config, t)).toBe('会话模型')
  })
})
