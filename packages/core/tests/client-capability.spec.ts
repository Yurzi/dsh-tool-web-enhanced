// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SelectionView } from '../src/shared/selection.ts'
import { ConnectionSelectionStore, type SelectionRemote } from '../src/client/selection.ts'
import { clientRoute, type WebSelection } from '../src/client/route.ts'
import { CredentialStatus } from '../src/client/credentials.ts'
import { selectionCommand, type CommandOptions } from '../src/client/command.ts'

const keys = { label: 'fetch.label', description: 'fetch.description', placeholder: 'fetch.placeholder', empty: 'fetch.empty', noResults: 'fetch.noResults', readFailed: 'fetch.readFailed', current: 'fetch.current', off: 'fetch.off' } as const
const commandSpec = {
  name: 'setup-fetch', icon: () => null, t: (key: string) => key, keys,
  describe: (connection: SelectionView['connections'][number]) => ({ label: connection.label }),
  groups: (view: SelectionView) => [{ group: { name: 'connections', label: 'Fetch connections' }, connections: view.connections }],
  writeFailureText: () => 'Could not change selection',
}

function fixture<O extends Record<string, unknown>>(options: O) {
  let view: SelectionView<O> = {
    selection: { connectionId: 'builtin:local', revision: 2, options }, source: 'default',
    connections: [
      { id: 'builtin:local', kind: 'local', label: 'Local', remote: false, access: 'keyless', status: 'ready' },
      { id: 'builtin:remote', kind: 'native', label: 'Remote', remote: true, access: 'api-key', status: 'needs-credential' },
    ],
  }
  const writes: Parameters<SelectionRemote<SelectionView<O>>['set']>[0][] = []
  const remote: SelectionRemote<SelectionView<O>> = {
    get: async () => ({ ok: true, value: view }),
    set: async change => {
      writes.push(change)
      view = { ...view, source: 'session', selection: {
        connectionId: change.connectionId === undefined ? view.selection.connectionId : change.connectionId,
        revision: view.selection.revision + 1, options: { ...view.selection.options, ...change.options },
      } }
      return { ok: true, value: view }
    },
  }
  const store = new ConnectionSelectionStore(remote)
  return { store, writes }
}

const session = { sessionId: 'fetch-session' } as never

describe('capability-neutral browser state and command', () => {
  it('supports empty options and writes off through the shared store with its revision', async () => {
    const { store, writes } = fixture({})
    const command = selectionCommand(store, commandSpec)
    if (command.ui.kind !== 'popupSelect') throw new Error('popup expected')
    expect(command.label?.()).toBe('fetch.label')
    const options = await command.ui.options(session, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['off', 'connection:builtin:local'])
    expect(options[1]).toMatchObject({ active: true, detail: 'fetch.current' })
    await command.ui.onSelect({ id: 'off', label: '' }, session)
    expect(writes).toEqual([{ sessionId: 'fetch-session', connectionId: null, expectedRevision: 2 }])
    expect(store.source('fetch-session').getSnapshot().view?.selection).toEqual({ connectionId: null, revision: 3, options: {} })
  })

  it('lets a capability supply an unrelated option group, parser and equality rule', async () => {
    const { store, writes } = fixture({ depth: 'short' })
    const options: CommandOptions<SelectionView<{ depth: string }>> = {
      choices: (view, detail) => ['short', 'full'].map(depth => ({ id: 'depth:' + depth, label: depth, group: { name: 'depth', label: 'Depth' }, ...detail(undefined, view.selection.options.depth === depth) })),
      parse: id => id === 'depth:short' || id === 'depth:full' ? { options: { depth: id.slice(6) } } : undefined,
      isCurrent: (update, selection) => update.options?.depth === selection.options.depth,
    }
    const command = selectionCommand(store, { ...commandSpec, options })
    if (command.ui.kind !== 'popupSelect') throw new Error('popup expected')
    expect((await command.ui.options(session, new AbortController().signal)).map(option => option.id)).toEqual(['off', 'connection:builtin:local', 'depth:short', 'depth:full'])
    await command.ui.onSelect({ id: 'depth:short', label: '' }, session)
    expect(writes).toEqual([])
    await command.ui.onSelect({ id: 'depth:full', label: '' }, session)
    expect(writes).toEqual([{ sessionId: 'fetch-session', options: { depth: 'full' }, expectedRevision: 2 }])
  })

  it('judges the supplied route field rather than the search field', () => {
    const web: ConfigFormSnapshot<WebSelection> = { status: 'ready', value: { searchProvider: 'elsewhere', fetchProvider: 'fetch-enhanced' }, base: {}, user: {}, revision: 1, writable: true }
    const host = { providerId: 'fetch-enhanced', envProvider: null }
    expect(clientRoute(web, host, 'fetchProvider')).toEqual({ kind: 'this' })
    expect(clientRoute(web, host, 'searchProvider')).toEqual({ kind: 'other', provider: 'elsewhere', providerId: 'fetch-enhanced' })
    expect(clientRoute({ ...web, value: { fetchProvider: '' } }, { ...host, envProvider: 'fetch-enhanced' }, 'fetchProvider')).toEqual({ kind: 'other', provider: '', providerId: 'fetch-enhanced' })
  })

  it('describes exactly the supplied deduplicated credential refs, and never reads values', async () => {
    let config: { refs: string[] } | undefined = { refs: ['FETCH_KEY', 'FETCH_KEY'] }
    const described: string[][] = []
    const status = new CredentialStatus(() => config, {
      describe: async refs => {
        described.push(refs)
        return { ok: true, value: { FETCH_KEY: { configured: true, writable: true } } }
      },
    }, settings => settings.refs)
    status.refresh()
    expect(described).toEqual([])
    const stop = status.source.subscribe(() => {})
    await Promise.resolve()
    expect(described).toEqual([['FETCH_KEY']])
    expect(status.source.getSnapshot()).toEqual({ FETCH_KEY: 'configured' })
    config = { refs: ['OTHER_KEY'] }
    status.refresh()
    await Promise.resolve()
    expect(status.source.getSnapshot()).toEqual({ OTHER_KEY: 'unknown' })
    config = undefined
    status.refresh()
    expect(status.source.getSnapshot()).toEqual({})
    stop()
  })
})
