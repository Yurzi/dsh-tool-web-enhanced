import { describe, expect, it } from 'vitest'
import { en, zh, type LocaleKey } from '../src/client/locales.ts'

const copy = {
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
    for (const dictionary of [zh, en]) expect(Object.values(dictionary).join(' ')).not.toMatch(/web_search|web_fetch|profile|配置包|抓取/)
  })
})
