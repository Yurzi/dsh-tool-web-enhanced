// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { fetchCommand, parseCommandOption } from '../src/client/command.ts'
import { FetchSelectionStore, type FetchConnectionsRemote } from '../src/client/selection.ts'
import { describe as connectionText, sourceText, writeFailureText, type Translate } from '../src/client/connections.ts'
import { en, zh } from '../src/client/locales.ts'
import type { FetchSelectionView } from '../src/contract.ts'

const t: Translate = (key, params = {}) => zh[key].replace(/[{]([^}]+)[}]/gu, (_, name: string) => String(params[name]))
function fixture() {
  let view: FetchSelectionView = { selection: { connectionId: 'builtin:local', revision: 4, options: {} }, source: 'default', connections: [
    { id: 'builtin:local', label: 'Local HTTP', kind: 'local', remote: false, access: 'keyless', status: 'ready' },
    { id: 'builtin:deepseek-fetch-api', label: 'DeepSeek', kind: 'native', remote: true, access: 'api-key', status: 'needs-credential' },
  ] }
  const remote = {
    get: vi.fn(async () => ({ ok: true as const, value: view })),
    set: vi.fn(async (change: { connectionId?: string | null }) => {
      view = { ...view, selection: { ...view.selection, connectionId: change.connectionId === undefined ? view.selection.connectionId : change.connectionId, revision: view.selection.revision + 1 } }
      return { ok: true as const, value: view }
    }),
  }
  const store = new FetchSelectionStore(remote as unknown as FetchConnectionsRemote)
  const command = fetchCommand(store, t)
  if (command.ui.kind !== 'popupSelect') throw new Error('expected a popup command')
  return { remote, store, command, ui: command.ui, session: { sessionId: 's1' } as never }
}

describe('/setup-fetch', () => {
  it('offers only off and ready connections, without a conversation parameter group', async () => {
    const { command, ui, session } = fixture()
    expect(command.name).toBe('setup-fetch')
    expect(command.label?.()).toBe(zh['command.label'])
    const options = await ui.options(session, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['off', 'connection:builtin:local'])
    expect(options[1]).toMatchObject({ active: true, label: zh['connection.local'], group: { name: 'services' } })
  })
  it('preserves a custom label for the local connection', () => {
    expect(connectionText({ id: 'builtin:local', label: 'My network', kind: 'local', remote: false, access: 'keyless', status: 'ready' }, t).label).toBe('My network')
  })

  it('shares the revision-checked store and skips an unchanged choice', async () => {
    const { remote, ui, session, store } = fixture()
    await ui.onSelect({ id: 'connection:builtin:local', label: '' }, session)
    expect(remote.set).not.toHaveBeenCalled()
    await ui.onSelect({ id: 'off', label: '' }, session)
    expect(remote.set).toHaveBeenCalledWith({ sessionId: 's1', connectionId: null, expectedRevision: 4 })
    expect(store.source('s1').getSnapshot().view?.selection.connectionId).toBeNull()
  })
  it('localizes a refused write without exposing Host diagnostics', async () => {
    const { remote, ui, session } = fixture()
    remote.set.mockResolvedValueOnce({ ok: false, error: new RemoteError('fetchConnections/conflict', 'private diagnostic', {}) } as never)
    await expect(ui.onSelect({ id: 'off', label: '' }, session)).rejects.toThrow(zh['write.conflict'])
  })
  it('parses only connection choices, with no search-specific options', () => {
    expect(parseCommandOption('off')).toEqual({ connectionId: null })
    expect(parseCommandOption('connection:builtin:local')).toEqual({ connectionId: 'builtin:local' })
    expect(parseCommandOption('freshness:auto')).toBeUndefined()
  })
  it('localizes unavailable facts, sources and transport failures', () => {
    expect(connectionText({ id: 'builtin:deepseek-fetch-api', label: 'DeepSeek', kind: 'native', remote: true, access: 'api-key', status: 'needs-credential' }, t).reason).toBe('需要 DeepSeek 账号或 API Key')
    expect(sourceText({ selection: { connectionId: null, options: {}, revision: 0 }, source: 'model', connections: [] }, t)).toBe(zh['source.model'])
    expect(writeFailureText(new RemoteError('gateway/internal', 'secret', {}), t)).toBe(zh['write.failed'])
    expect(Object.keys(en)).toEqual(Object.keys(zh))
    expect(Object.values(en).join(' ')).not.toMatch(/session/i)
  })
})
