import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

const copy = {
  'source.session': ['本会话', 'This conversation'],
  'source.inherited': ['来自父会话', 'Parent conversation'],
  'source.model': ['该模型上次的选择', "Model's last choice"],
  'source.default': ['默认连接', 'Default connection'],
  'access.apiKey': ['API Key', 'API key'],
  'access.account': ['DeepSeek 账号', 'DeepSeek account'],
  'freshness.fresh': ['24 小时内', 'Within 24 hours'],
  'freshness.realtime': ['实时', 'Live'],
  'status.unsupported': ['本版本不支持 {name}。', '{name} is not supported in this version.'],
  'status.short.unsupported': ['不支持', 'Not supported'],
  'status.needsAccount': ['需要 DeepSeek 账号或 API Key', 'Needs a DeepSeek account or API key'],
  'status.needsCredential': ['需要 API Key', 'Needs an API key'],
  'services.accountHint': ['使用 DeepSeek 账号模型的会话通过账号搜索；其他会话使用下方的 API Key。', 'Conversations using a DeepSeek account model search through the account; others use the API key below.'],
  'route.unknown': ['无法确认 web_search 是否由本插件提供。', 'Cannot confirm that web_search is served by this plugin.'],
  'route.auto': ['web 行没有指定搜索 provider，这里的设置可能不生效。请在插件页打开本组合包，改回 {id}。', 'The web row names no search provider, so these settings may not apply. Open this bundle on the Plugins page and switch back to {id}.'],
  'route.other': ['web_search 当前由 {provider} 提供，不是 {id}，这里的设置不会生效。请在插件页打开本组合包，改回 {id}。', 'web_search is served by {provider}, not {id}, so these settings have no effect. Open this bundle on the Plugins page and switch back to {id}.'],
  'pairings.hint': ['在会话里选择连接（包括关闭）时，会为该会话的模型记住这次选择，该模型的新会话会沿用它。清除后，还没有自行选择的会话改用默认连接。', "Choosing a connection in a conversation (including off) remembers it for that conversation's model; new conversations with that model start with it. After you clear it, conversations that have not chosen use the default connection."],
  'settings.invalid': ['设置无效，未保存。', 'Invalid settings; not saved.'],
  'defaults.connectionHint': ['未自行选择的会话依次使用：父会话的选择（仅限分叉出的会话）、该模型上次的选择、默认连接。', "A conversation that hasn't chosen uses, in order: its parent's choice (forked conversations only), the last choice for its model, then the default."],
  'services.title': ['搜索连接', 'Search connections'],
  'selector.services': ['搜索连接', 'Search connections'],
  'defaults.showSelector': ['在输入框菜单中显示搜索连接', 'Show search connections in the composer menu'],
  'settings.intro': ['每个会话通过地球按钮或 /setup-search 选择搜索连接。本页设置默认值及各连接的参数。状态点只反映配置，不代表额度或服务可用性。', 'Each conversation chooses a search connection with the globe button or /setup-search. Set the defaults and each connection below. Status dots show configuration only, not quota or service health.'],
  'services.keyless': ['无需密钥', 'No key needed'],
  'selector.offRow': ['关闭', 'Off'],
  'defaults.connectionUnset': ['默认（{name}）', 'Default ({name})'],
  'defaults.connectionMissing': ['不存在：{id}', 'Missing: {id}'],
  'command.label': ['搜索连接', 'Search connection'],
  'command.description': ['切换当前会话的搜索连接与内容实时性', 'Switch the search connection and freshness of this conversation'],
  'defaults.showSelectorHint': ['隐藏后可用 /setup-search 切换当前会话。', 'When hidden, switch the current conversation with /setup-search.'],
  'option.native.baseURL': ['API 基础地址', 'API base URL'],
  'option.native.maxUses': ['单次请求最多搜索次数', 'Max searches per request'],
  'option.native.count': ['每次搜索结果数', 'Results per search'],
  'option.native.sendOriginalQuestion': ['附带用户原始问题', "Include the user's question"],
  'value.ultra-fast': ['超快', 'Ultra-fast'],
} as const

const retired = [
  'status.missing', 'freshness.short.fresh', 'freshness.short.realtime',
  'selector.loading', 'selector.aria', 'selector.ariaFreshness', 'selector.menu',
  'selector.empty', 'selector.freshnessOff', 'selector.freshnessHint.auto',
  'selector.freshnessHint.fresh', 'selector.freshnessHint.realtime', 'selector.readFailed',
  'selector.readOnly', 'selector.manage', 'selector.openSettings', 'selector.rowToSettings',
  'credential.readOnly', 'options.true', 'options.false',
  'settings.migration', 'connection.followModel', 'selector.models', 'models.limits', 'custom.kindModel', 'models.title', 'models.followHint', 'models.options', 'models.optionsHint', 'models.protocol',
  'custom.addModel', 'activation.title', 'activation.body', 'activation.later',
  'activation.open', 'activation.close',
]

function placeholders(text: string): string[] {
  return [...text.matchAll(/[{]([^}]+)[}]/gu)].map(match => match[1]!).toSorted()
}

describe('search browser locale copy', () => {
  it.each(Object.entries(copy))('uses the requested zh/en copy for %s', (key, [chinese, english]) => {
    expect(zh).toHaveProperty(key, chinese)
    expect(en).toHaveProperty(key, english)
  })

  it('uses conversation consistently in English and the shared ellipsis character', () => {
    expect(Object.values(en).join(' ')).not.toMatch(/session/iu)
    for (const dictionary of [zh, en]) {
      expect(Object.values(dictionary).join(' ')).not.toContain('...')
      expect(dictionary.saving).toContain('…')
      expect(dictionary['settings.loading']).toContain('…')
    }
  })

  it('keeps the dictionaries and interpolation parameters in sync', () => {
    expect(Object.keys(zh).toSorted()).toEqual(Object.keys(en).toSorted())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('removes obsolete surface copy but retains error and unsupported-state messages', () => {
    for (const dictionary of [zh, en]) {
      for (const key of retired) expect(dictionary).not.toHaveProperty(key)
      for (const key of ['pairings.failed', 'selector.freshnessIgnored']) {
        expect(dictionary).toHaveProperty(key)
      }
    }
  })

  it.each([
    ['zh', '用你选择的搜索后端提供 web_search：原生 DeepSeek 搜索，或免 Key、个人 Key 的搜索服务。'],
    ['en', 'Serves web_search from the search backend you choose: native DeepSeek search, or keyless and API-key services.'],
  ])('does not advertise unsupported model search in %s metadata', (language, description) => {
    const metadata: unknown = JSON.parse(readFileSync(new URL('../locale/' + language + '.json', import.meta.url), 'utf8'))
    expect(metadata).toHaveProperty('meta.description', description)
  })
})
