import { describe, expect, it } from 'vitest'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'

const copy = {
  'disabled.search': ['网页搜索暂不可用：增强网页搜索已停用，请在上方启用。', "Web search isn't available because Web Search Enhanced is off. Turn it on above."],
  'disabled.fetch': ['网页获取暂不可用：增强网页获取已停用，请在上方启用。', "Web fetch isn't available because Web Fetch Enhanced is off. Turn it on above."],
  'activation.body': ['网页搜索和网页获取现在由本组合包的插件提供。点输入框右侧的地球按钮为每个会话选择连接；连接、密钥和默认值在插件设置里配置。', "Web search and web fetch now go through this bundle's plugins. Pick a connection for each conversation with the globe button in the composer; set up connections, keys and defaults in the plugin settings."],
  'menu.moreServices': ['更多服务可在设置中打开', 'More services can be turned on in settings'],
  'activation.remoteOff': ['远程服务默认关闭，需要时也在那里打开。', 'Remote services are off by default; turn them on there when you need them.'],
  'overview.description': ['网页搜索与网页获取由谁提供，以及从 0.1.x 升级后遗留的设置。', 'Which service handles web search and web fetch, and settings left over from 0.1.x.'],
} satisfies Partial<Record<LocaleKey, readonly [string, string]>>

describe('bundle browser copy', () => {
  it.each(Object.entries(copy))('uses final copy for %s', (key, [chinese, english]) => {
    expect(zh).toHaveProperty(key, chinese)
    expect(en).toHaveProperty(key, english)
  })
  it('uses 网页获取 and 组合包 consistently and hides tool identifiers', () => {
    expect(zh['overview.fetch.title']).toBe('网页获取')
    expect(zh['overview.status.routedFetch']).toBe('由增强网页获取提供')
    expect(zh['overview.status.notRoutedFetch']).toBe('未由增强网页获取提供')
    expect(zh['preflight.action.fetchAction']).toBe('获取网页')
    expect(zh['overview.status.base']).toBe('组合包默认：{provider}')
    for (const dictionary of [zh, en]) expect(Object.values(dictionary).join(' ')).not.toMatch(/web_search|web_fetch|profile|配置包|抓取/)
  })
  it('keeps keys and interpolation parameters paired', () => {
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    for (const key of Object.keys(zh) as LocaleKey[]) {
      const parameters = (text: string) => [...text.matchAll(/[{]([^}]+)[}]/gu)].map(match => match[1]!).toSorted()
      expect(parameters(zh[key]), key).toEqual(parameters(en[key]))
    }
  })
})
