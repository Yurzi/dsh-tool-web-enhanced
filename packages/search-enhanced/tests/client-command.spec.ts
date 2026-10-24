// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SearchSelectionView as SelectionView } from '../src/contract.ts'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { parseCommandOption, searchCommand, SEARCH_COMMAND } from '../src/client/command.ts'
import { SearchSelectionStore, type SearchConnectionsRemote } from '../src/client/selection.ts'
import { zh, type LocaleKey } from '../src/client/locales.ts'
import { describe as describeConnection, sourceText, writeFailureText, type Translate } from '../src/client/connections.ts'
const tZh: Translate = (key, params = {}) => (zh[key as LocaleKey]).replace(/[{]([^}]+)[}]/gu, (_, name: string) => String(params[name]))

const connections: SelectionView['connections'] = [
  { id: 'builtin:exa', label: 'Exa', kind: 'adapter', remote: true, access: 'keyless', status: 'ready', freshness: false },
  { id: 'builtin:tavily', label: 'Tavily', kind: 'adapter', remote: true, access: 'keyless', status: 'disabled', freshness: false },
  { id: 'builtin:semanticscholar', label: 'Semantic Scholar', kind: 'adapter', remote: true, access: 'api-key', status: 'needs-credential', freshness: false },
]

function fixture(connectionId: string | null = 'builtin:exa', freshness = true, listed: SelectionView['connections'] = connections) {
  let current: SelectionView = { selection: { connectionId, options: { freshness: 'realtime' }, revision: 3 }, source: 'session', connections: listed.map(connection => ({ ...connection, freshness })) }
  const remote = {
    get: vi.fn(async () => ({ ok: true as const, value: current })),
    set: vi.fn(async (request: { connectionId?: string | null; options?: Record<string, unknown> }) => {
      current = { ...current, selection: { ...current.selection, ...request, revision: current.selection.revision + 1 } as SelectionView['selection'] }
      return { ok: true as const, value: current }
    }),
  }
  const selections = new SearchSelectionStore(remote as unknown as SearchConnectionsRemote)
  const command = searchCommand(selections, tZh)
  if (command.ui.kind !== 'popupSelect') throw new Error('expected a popup command')
  return { remote, selections, command, ui: command.ui, session: { sessionId: 'session-1' } as never }
}

const ids = (options: readonly SelectOption[]) => options.map(option => option.id)
const signal = new AbortController().signal

describe('/setup-search', () => {
  it('is a localized popup command', () => {
    const { command, ui } = fixture()
    expect(command.name).toBe(SEARCH_COMMAND)
    expect(SEARCH_COMMAND).toBe(SEARCH.command)
    // A decoration of the Host command: the menu row is the Host command's own.
    expect(Object.keys(command).toSorted()).toEqual(['available', 'name', 'ui'])
    expect(ui.searchLabels?.()).toEqual({ placeholder: tZh('command.placeholder'), empty: tZh('command.empty'), noResults: tZh('command.noResults') })
  })

  it('mirrors the composer menu: off, ready connections by group, then freshness', async () => {
    const { ui, session } = fixture()
    const options = await ui.options(session, signal)
    expect(ids(options)).toEqual([
      'off', 'connection:builtin:exa', 'freshness:auto', 'freshness:fresh', 'freshness:realtime',
    ])
    // Like the composer menu, a ready remote connection says who receives the query.
    expect(options[1]).toMatchObject({ label: 'Exa', active: true, detail: `${tZh('status.remoteReady', { access: tZh('access.keyless'), name: 'Exa' })} · ${tZh('command.current')}`, group: { name: 'services' } })
    expect(options.at(-1)).toMatchObject({ label: tZh('freshness.realtime'), detail: tZh('command.current') })
    expect(options.filter(option => option.active)).toHaveLength(1)
  })

  it('omits freshness when the selected connection ignores it', async () => {
    const { ui, session } = fixture('builtin:exa', false)
    expect(ids(await ui.options(session, signal))).toEqual(['off', 'connection:builtin:exa'])
  })

  it('omits freshness while search is off', async () => {
    const { ui, session } = fixture(null)
    expect(ids(await ui.options(session, signal))).toEqual(['off', 'connection:builtin:exa'])
  })

  it('writes the picked change with the observed revision and skips the current value', async () => {
    const { ui, session, remote } = fixture()
    await ui.onSelect({ id: 'connection:builtin:exa', label: 'Exa' }, session)
    await ui.onSelect({ id: 'freshness:realtime', label: '' }, session)
    expect(remote.set).not.toHaveBeenCalled()
    await ui.onSelect({ id: 'freshness:fresh', label: '' }, session)
    expect(remote.set).toHaveBeenLastCalledWith({ sessionId: 'session-1', options: { freshness: 'fresh' }, expectedRevision: 3 })
    await ui.onSelect({ id: 'off', label: '' }, session)
    expect(remote.set).toHaveBeenLastCalledWith({ sessionId: 'session-1', connectionId: null, expectedRevision: 4 })
  })

  it('reports a refused write in the popup with localized text', async () => {
    const { ui, session, remote } = fixture()
    remote.set.mockResolvedValueOnce({ ok: false, error: new RemoteError('searchConnections/unavailable', 'gone', { connectionId: 'builtin:exa' }) } as never)
    await expect(ui.onSelect({ id: 'off', label: '' }, session)).rejects.toThrow(tZh('write.unavailable'))
  })

  it('localizes source and unavailable facts instead of displaying Host diagnostics', () => {
    const connection = connections[2]
    if (connection === undefined) throw new Error('missing fixture connection')
    expect(describeConnection(connection, tZh)).toMatchObject({ label: 'Semantic Scholar', caption: tZh('status.short.needsCredential') })
    for (const source of ['session', 'inherited', 'model', 'default'] as const) {
      const view: SelectionView = { selection: { connectionId: null, revision: 0, options: { freshness: 'auto' } }, source, connections }
      expect(sourceText(view, tZh)).toBe(tZh(('source.' + source) as LocaleKey))
    }
    expect(writeFailureText(new RemoteError('gateway/internal', 'upstream secret', {}), tZh)).toBe(tZh('write.failed'))
  })

  it('rejects a failed read even when a cached selection exists', async () => {
    const { ui, session, remote } = fixture()
    await ui.options(session, signal)
    remote.get.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'network', {}) } as never)
    await expect(ui.options(session, signal)).rejects.toThrow(tZh('command.readFailed'))
  })

  it('describes model connections: who receives the query, and why one cannot serve', async () => {
    const model = { kind: 'model', remote: true, freshness: false } as const
    const listed: SelectionView['connections'] = [
      { ...model, id: 'builtin:session-model', label: 'Session model', access: 'account', status: 'ready' },
      { ...model, id: 'custom:claude', label: 'Claude', access: 'api-key', status: 'ready' },
      { ...model, id: 'custom:off', label: 'Off model', access: 'api-key', status: 'disabled' },
    ]
    const [session, fixed] = listed as [SelectionView['connections'][number], SelectionView['connections'][number]]
    expect(describeConnection(session, tZh)).toEqual({ label: tZh('connection.sessionModel'), caption: tZh('status.sessionModelReady', { access: tZh('access.account') }) })
    expect(describeConnection(session, tZh).caption).toBe('DeepSeek 账号 · 查询发送给会话模型的服务商')
    expect(describeConnection({ ...session, label: 'Team model' }, tZh).label).toBe('Team model')
    expect(describeConnection(fixed, tZh).caption).toBe(tZh('status.modelReady', { access: tZh('access.apiKey'), name: 'Claude' }))
    // The conversation model names its own key; on the account route only a fresh sign-in helps.
    expect(describeConnection({ ...session, access: 'api-key', status: 'needs-credential' }, tZh).reason).toBe('会话模型的 API Key 未设置')
    expect(describeConnection({ ...session, status: 'needs-credential' }, tZh)).toMatchObject({ caption: '需要登录', reason: '请重新登录 DeepSeek 账号' })
    expect(describeConnection({ ...session, access: 'api-key', status: 'needs-credential' }, tZh).caption).toBe(tZh('status.short.needsCredential'))
    expect(describeConnection({ ...fixed, status: 'needs-credential' }, tZh).reason).toBe(tZh('status.needsCredential'))
    for (const reason of ['no-model', 'unknown-route', 'protocol', 'endpoint', 'headers', 'credential'] as const) {
      const text = describeConnection({ ...session, status: 'unsupported', reason }, tZh)
      expect(text).toEqual({ label: tZh('connection.sessionModel'), caption: tZh('status.short.unsupported'), reason: tZh(('status.reason.' + reason) as LocaleKey) })
    }
    expect(describeConnection({ ...session, status: 'unsupported', reason: 'protocol' }, tZh).reason).toBe('该路由在模型设置里没有声明支持的 api')

    const { ui, session: popup } = fixture('custom:claude', false, [...listed, { ...model, id: 'builtin:x', label: 'X', access: 'api-key', status: 'unsupported', reason: 'headers' }])
    const options = await ui.options(popup, signal)
    expect(ids(options)).toEqual(['off', 'connection:builtin:session-model', 'connection:custom:claude'])
    expect(options[2]).toMatchObject({ active: true, detail: tZh('status.modelReady', { access: tZh('access.apiKey'), name: 'Claude' }) + ' · ' + tZh('command.current') })
  })

  it('parses only the option ids it issues', () => {
    expect(parseCommandOption('off')).toEqual({ connectionId: null })
    expect(parseCommandOption('connection:custom:a')).toEqual({ connectionId: 'custom:a' })
    expect(parseCommandOption('freshness:fresh')).toEqual({ options: { freshness: 'fresh' } })
    for (const id of ['connection:', 'freshness:weekly', 'other']) expect(parseCommandOption(id)).toBeUndefined()
  })
})
