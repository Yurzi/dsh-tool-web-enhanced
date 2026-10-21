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
  'connection.sessionModel': ['会话模型', 'Conversation model'],
  'status.sessionModelReady': ['{access} · 查询发送给会话模型的服务商', "{access} · sent to the conversation model's provider"],
  'status.modelReady': ['{access} · 模型搜索 · 查询发送给 {name}', '{access} · model search · sent to {name}'],
  'status.sessionModelNeedsKey': ['会话模型的 API Key 未设置', "The conversation model's API key isn't set"],
  'status.sessionModelNeedsSignIn': ['请重新登录 DeepSeek 账号', 'Sign in to the DeepSeek account again'],
  'status.reason.no-model': ['本会话还没有选择模型', 'No model chosen for this conversation yet'],
  'status.reason.unknown-route': ['无法读取会话模型服务商的设置', "Can't read the settings of this model's provider"],
  'status.reason.protocol': ['该路由在模型设置里没有声明支持的 api', 'Its route declares no supported api'],
  'status.reason.endpoint': ['该路由在模型设置里没有固定的接口地址', 'Its route has no fixed endpoint'],
  'status.reason.headers': ['该路由带自定义请求头，暂不支持', "Its route's custom headers aren't supported"],
  'status.short.needsSignIn': ['需要登录', 'Sign-in needed'],
  'options.exclusive': ['请先清空“{other}”：两项只能填一项', 'Clear “{other}” first: only one of the two lists can be set'],
  'option.model.maxTokens.anthropicHint': ['缺省 4096。', 'Defaults to 4096.'],
  'option.model.maxTokens.responsesHint': ['不设时不发送上限；至少为 16。', 'No limit is sent unless set; at least 16.'],
  'option.model.maxTokens.chatHint': ['不设时不发送上限。', 'No limit is sent unless set.'],
  'option.model.anthropicTool.fixedHint': ['缺省 web_search_20260318。DeepSeek 只接受 web_search_20250305 与 web_search_20260209。', 'Defaults to web_search_20260318. DeepSeek accepts only web_search_20250305 and web_search_20260209.'],
  'option.model.anthropicTool.hint': ['缺省 web_search_20260318；会话模型跟随 DeepSeek 路由时为 web_search_20250305。DeepSeek 只接受 web_search_20250305 与 web_search_20260209。', 'Defaults to web_search_20260318, or web_search_20250305 when the conversation model is on a DeepSeek route. DeepSeek accepts only web_search_20250305 and web_search_20260209.'],
  'model.idHint': ['服务方要求的模型 ID，例如 claude-sonnet-4-5 或 gpt-5-search-api。', 'The model ID the service expects, such as claude-sonnet-4-5 or gpt-5-search-api.'],
  'status.reason.credential': ['该路由没有指明唯一的 API Key 名称', "Its route doesn't name a single API key"],
  'services.sessionModel.summary': ['跟随会话模型 · 密钥或登录按会话检查', 'Follows the conversation model · key or sign-in is checked per conversation'],
  'option.model.responseInclusion.hint': ['只对 web_search_20260318 及以后的版本生效。选“不包含”时，已被代码执行消费的搜索结果不进回复，也就不进返回的来源；直接搜索的结果总会包含。', 'web_search_20260318 or later. Left out drops results that code execution already consumed from the reply, and so from the returned sources; direct searches always include them.'],
  'option.model.responsesTool.hint': ['缺省 web_search。web_search_preview 是旧版工具：不支持域名过滤与结果 Token 预算，忽略“实时访问网页”。', 'Defaults to web_search. web_search_preview is the older tool: no domain filters or result token budget, and it ignores Live web access.'],
  'option.model.maxTokens.hint': ['Anthropic Messages 缺省 4096；OpenAI 不设时不发送上限，Responses 至少为 16。', 'Anthropic Messages defaults to 4096; OpenAI sends no limit unless set, and Responses needs at least 16.'],
  'option.model.userCountry.placeholder': ['两位代码，如 CN', 'Two-letter code, e.g. US'],
  'editor.trust': ['我信任此地址：允许向它发送搜索查询与凭据 {ref}。', 'I trust this endpoint: send search queries and the credential {ref} to it.'],
  'editor.trustUnnamed': ['我信任此地址：允许向它发送搜索查询与此连接的凭据。', "I trust this endpoint: send search queries and this connection's credential to it."],
  'editor.credentialRef': ['凭据名称', 'Credential name'],
  'options.invalidItem': ['第 {line} 行（“{item}”）不是域名或域名加路径', 'Line {line} (“{item}”) is not a domain with an optional path'],
  'model.format': ['模型搜索 · {protocol}', 'Model search · {protocol}'],
  'options.invalidLine': ['第 {line} 行格式无效', 'Line {line} is not valid'],
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

  it('explains the conversation-model connection and tells DeepSeek users which protocol searches', () => {
    // The DeepSeek tool default yields to an explicit tool version (R1 P1-4).
    expect(zh['services.sessionModel.note']).toContain('除非这里设置了搜索工具版本')
    expect(en['services.sessionModel.note']).toContain('unless a search tool version is set here')
    expect(zh['services.sessionModel.note']).toContain('每项参数只在其分组标题列出的协议上生效')
    // OpenAI endpoints keep /v1; only Messages adds it.
    for (const protocol of ['openai-responses', 'openai-chat-completions'] as const) {
      expect(zh[`model.protocol.${protocol}`]).toContain('https://api.openai.com/v1')
      expect(en[`model.protocol.${protocol}`]).toContain('https://api.openai.com/v1')
    }
    expect(en['model.protocol.anthropic-messages']).toContain('https://api.anthropic.com (/v1 is added)')
    expect(zh['model.protocol.openai-chat-completions']).toContain('DeepSeek 的 Chat Completions 没有服务端网页搜索，DeepSeek 请用 Anthropic Messages')
    // One wording for server-side web search and for where the query goes.
    expect(Object.values(zh).join(' ')).not.toContain('服务端搜索')
    for (const key of ['status.modelReady', 'status.sessionModelReady'] as const) expect(zh[key]).toContain('查询发送给')
    expect(en['model.protocol.openai-chat-completions']).toContain('for DeepSeek use Anthropic Messages')
    for (const reason of ['no-model', 'unknown-route', 'protocol', 'endpoint', 'headers', 'credential']) {
      expect(zh).toHaveProperty('status.reason.' + reason)
      expect(en).toHaveProperty('status.reason.' + reason)
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
    ['zh', '用你选择的搜索后端提供 web_search：原生 DeepSeek 搜索、免密钥或个人密钥的搜索服务，或带服务端网页搜索的模型。'],
    ['en', 'Serves web_search from the search backend you choose: native DeepSeek search, keyless and API-key services, or a model with server-side search.'],
  ])('describes every backend kind in %s metadata', (language, description) => {
    const metadata: unknown = JSON.parse(readFileSync(new URL('../locale/' + language + '.json', import.meta.url), 'utf8'))
    expect(metadata).toHaveProperty('meta.description', description)
  })
})
