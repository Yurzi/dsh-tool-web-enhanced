import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'
import { describe as connectionText } from '../src/client/connections.ts'
import { SERVICE_NOTES } from '../src/client/settings/model.ts'
import { ADAPTER_KEYS } from '../src/catalog.ts'

const copy = {
  // docs/design.md, "远程服务缺省停用" and "开关与同意": verbatim.
  'services.optInNotice': ['远程服务默认关闭。', 'Remote services are off by default.'],
  'enhanced.title': ['增强工具', 'Enhanced tools'],
  'services.off': ['未启用', 'Off'],
  'write.unavailable': ['该连接未启用或已移除。', "That connection is turned off or was removed."],
  'status.disabled': ['{name} 未在设置中启用。', '{name} is turned off in settings.'],
  'enhanced.description': ['让 Agent 用 web_fetch_enhanced 在已启用的服务中自行选择本次获取用哪个，并用 list_web_fetch_providers 查看可选项。只影响之后新建的会话。', 'Lets the Agent pick which enabled service fetches a URL with web_fetch_enhanced, and see the choices with list_web_fetch_providers. Applies to conversations started afterwards.'],
  'enhanced.consent': ['打开即表示同意：Agent 选用某个服务时，URL 会发送给该服务。', 'Turning this on means you agree that when the Agent picks a service, the URL is sent to that service.'],
  'services.keyless': ['无需密钥', 'No key needed'],
  'selector.offRow': ['关闭', 'Off'],
  'settings.intro': ['每个会话通过地球按钮或 /setup-fetch 选择网页获取连接。本页设置默认连接及各连接的参数。状态点只反映配置，不代表服务可用性。', 'Each conversation chooses a fetch connection with the globe button or /setup-fetch. Set the default and each connection below. Status dots show configuration only, not service health.'],
  'source.session': ['本会话', 'This conversation'],
  'source.inherited': ['来自父会话', 'Parent conversation'],
  'source.model': ['该模型上次的选择', "Model's last choice"],
  'source.default': ['默认连接', 'Default connection'],
  'status.needsAccount': ['需要 DeepSeek 账号或 API Key', 'Needs a DeepSeek account or API key'],
  'status.needsCredential': ['需要 API Key', 'Needs an API key'],
  'defaults.showSelector': ['在输入框菜单中显示网页获取连接', 'Show fetch connections in the composer menu'],
  'route.unknown': ['无法确认网页获取是否经过本插件。', "Can't confirm that web fetch goes through this plugin."],
  'route.auto': ['尚未指定网页获取服务，这里的设置可能不生效。请在插件页打开本组合包修复。', 'No fetch service is selected, so these settings may not apply. Open this bundle on the Plugins page to fix it.'],
  'route.other': ['网页获取当前由 {provider} 提供，这里的设置不生效。请在插件页查看本组合包。', "Web fetch currently uses {provider}, so these settings don't apply. Check this bundle on the Plugins page."],
  'defaults.connectionHint': ['未自行选择的会话依次使用：父会话的选择（仅限分叉出的会话）、该模型上次的选择、默认连接。', "A conversation that hasn't chosen uses, in order: its parent's choice (forked conversations only), the last choice for its model, then the default."],
  'services.remoteNotice': ['URL 会发送给 {name}，能否访问目标由对方决定。', 'The URL is sent to {name}, which decides what it can reach.'],
  'allowlist.description': ['列表为空时，直连只能访问公网地址。设置了代理时，域名由代理解析，公网限制和这里的规则都管不到它们。', 'With an empty list, direct connections reach public addresses only. With a proxy, hostnames are resolved by the proxy, and neither that limit nor these rules apply to them.'],
  'option.local.userAgentHint': ['留空会发送空的 User-Agent；点“恢复默认 User-Agent”改回默认值。', 'Leaving it empty sends an empty User-Agent. Use "Restore User-Agent" to go back to the default.'],
  'settings.unsupported': ['无法读取这些设置，可能来自 0.1.x 或更新的版本。请在下方恢复默认设置，或升级插件。', "These settings can't be read. They may be from 0.1.x or a newer version. Restore the defaults below, or upgrade the plugin."],
} satisfies Partial<Record<LocaleKey, readonly [string, string]>>

describe('fetch browser copy', () => {
  it.each(Object.entries(copy))('uses final copy for %s', (key, [chinese, english]) => {
    expect(zh).toHaveProperty(key, chinese)
    expect(en).toHaveProperty(key, english)
  })
  it('keeps keys and placeholders paired without exposing tool identifiers or obsolete bundle names', () => {
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    for (const key of Object.keys(en) as LocaleKey[]) {
      const placeholders = (value: string) => [...value.matchAll(/[{]([^}]+)[}]/gu)].map(match => match[1]!).toSorted()
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]))
    }
    // Only the Enhanced tools copy names tools: the two it turns on (docs/design.md, "开关与同意").
    const text = (dictionary: Record<LocaleKey, string>) => Object.entries(dictionary)
      .map(([key, value]) => key.startsWith('enhanced.') ? value.replaceAll(/web_fetch_enhanced|list_web_fetch_providers/gu, '') : value)
      .join(' ')
    for (const dictionary of [zh, en]) expect(text(dictionary)).not.toMatch(/web_search|web_fetch|profile|配置包|抓取/)
  })
  it.each([
    ['zh', '增强网页获取', '用你选择的网页获取连接提供 web_fetch：本机获取（可选内网放行规则）、DeepSeek Fetch API，或远程读取服务（Exa、Firecrawl、Tavily、Tinyfish）。'],
    ['en', 'Web Fetch Enhanced', 'Serves web_fetch from the fetch connection you choose: local fetching (with optional private-network rules), the DeepSeek Fetch API, or remote reading services (Exa, Firecrawl, Tavily, Tinyfish).'],
  ])('names every kind of connection in the %s Plugins-page metadata', (language, title, description) => {
    const metadata: unknown = JSON.parse(readFileSync(new URL('../locale/' + language + '.json', import.meta.url), 'utf8'))
    expect(metadata).toEqual({ meta: { title, description } })
  })
  it('describes the package with every kind of connection', () => {
    const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest).toHaveProperty('description', 'web_fetch provider for DeepSeek Harness with switchable fetch connections: local fetching with optional private-network access, the DeepSeek Fetch API, or remote reading services (Exa, Firecrawl, Tavily, Tinyfish); installed through dsh-tool-web-enhanced-profile')
  })
  it('has a plain note for every remote adapter service', () => {
    for (const key of ADAPTER_KEYS) expect(SERVICE_NOTES).toHaveProperty(key)
  })
})

describe('fetch connections in the composer menu', () => {
  const t = (key: LocaleKey, params: Record<string, string | number> = {}) => zh[key].replace(/[{](\w+)[}]/gu, (_match, name: string) => String(params[name]))
  const view = { remote: true, access: 'api-key', status: 'ready' } as const

  it('says which service receives the URL of a ready remote connection', () => {
    expect(connectionText({ ...view, id: 'builtin:tavily', label: 'Tavily', kind: 'adapter', access: 'keyless' }, t).caption).toBe('无需密钥 · URL 会发送给 Tavily')
    expect(connectionText({ ...view, id: 'custom:team', label: 'Team reader', kind: 'adapter' }, t).caption).toBe('API Key · URL 会发送给 Team reader')
    expect(connectionText({ ...view, id: 'builtin:deepseek-fetch-api', label: 'DeepSeek Fetch API', kind: 'native', access: 'account' }, t).caption).toBe('DeepSeek 账号 · URL 会发送给 DeepSeek Fetch API')
    expect(connectionText({ id: 'builtin:local', label: 'Local HTTP', kind: 'local', remote: false, access: 'keyless', status: 'ready' }, t)).toEqual({ label: zh['connection.local'], caption: zh['access.local'] })
  })

  it('tells a missing key apart from a missing account or key, and from off or unsupported', () => {
    expect(connectionText({ ...view, id: 'builtin:tinyfish', label: 'Tinyfish', kind: 'adapter', status: 'needs-credential' }, t).reason).toBe('需要 API Key')
    expect(connectionText({ ...view, id: 'builtin:deepseek-fetch-api', label: 'DeepSeek Fetch API', kind: 'native', status: 'needs-credential' }, t).reason).toBe('需要 DeepSeek 账号或 API Key')
    expect(connectionText({ ...view, id: 'builtin:exa', label: 'Exa', kind: 'adapter', status: 'disabled' }, t).reason).toBe(t('status.disabled', { name: 'Exa' }))
    expect(connectionText({ ...view, id: 'custom:x', label: 'X', kind: 'adapter', status: 'unsupported' }, t).reason).toBe(t('status.unsupported', { name: 'X' }))
  })
})
