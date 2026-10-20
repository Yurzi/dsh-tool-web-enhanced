// @vitest-environment jsdom
/** Whether web_fetch reaches this plugin, judged the way ctx.web selects a provider. */
import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FETCH, type ProviderView } from 'dsh-tool-web-enhanced-core/shared'
import { FetchRouteStatus, type WebSelection } from '../src/client/route.ts'

function fixture(web: Partial<ConfigFormSnapshot<WebSelection>>, host: ProviderView = { providerId: FETCH.providerId, envProvider: null }) {
  let snapshot = { status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true, ...web } as ConfigFormSnapshot<WebSelection>
  const listeners = new Set<() => void>()
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  } as unknown as ConfigForm<WebSelection>
  const answer = { current: host }
  const reader = { provider: vi.fn(async () => ({ ok: true as const, value: answer.current })) }
  const status = new FetchRouteStatus(form)
  const detach = status.attach(reader)
  const editWeb = (value: WebSelection) => { snapshot = { ...snapshot, value }; for (const listener of listeners) listener() }
  const observe = () => status.source.subscribe(() => {})
  const route = () => status.source.getSnapshot()
  return { status, reader, answer, detach, editWeb, observe, route, listeners }
}

describe('fetch route on the settings page', () => {
  it('asks the Host only while the page observes it and follows web row edits', async () => {
    const h = fixture({ value: { fetchProvider: FETCH.providerId } })
    expect(h.reader.provider).not.toHaveBeenCalled()
    const stop = h.observe()
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'this' })
    h.editWeb({ fetchProvider: 'deepseek-fetch-api' })
    expect(h.route()).toEqual({ kind: 'other', provider: 'deepseek-fetch-api', providerId: FETCH.providerId })
    h.editWeb({})
    expect(h.route()).toEqual({ kind: 'auto', providerId: FETCH.providerId })
    stop()
    expect(h.listeners.size).toBe(0)
    h.status.refresh()
    expect(h.reader.provider).toHaveBeenCalledTimes(1)
  })

  it('lets the environment pick the provider only while the web row names none', async () => {
    const h = fixture({ value: {} }, { providerId: FETCH.providerId, envProvider: FETCH.providerId })
    h.observe()
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'this' })
    h.editWeb({ fetchProvider: 'another' })
    expect(h.route()).toEqual({ kind: 'other', provider: 'another', providerId: FETCH.providerId })
  })

  it('ignores late provider answers after detaching', async () => {
    const h = fixture({ value: { fetchProvider: FETCH.providerId } })
    let finish!: (value: { ok: true; value: ProviderView }) => void
    h.reader.provider.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const stop = h.observe()
    h.detach()
    finish({ ok: true, value: h.answer.current })
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'unknown' })
    stop()
  })

  it('rereads the Host after a refresh and says nothing it cannot judge', async () => {
    const h = fixture({ value: { fetchProvider: FETCH.providerId } }, { providerId: 'another', envProvider: null })
    h.observe()
    await Promise.resolve()
    expect(h.route()).toMatchObject({ kind: 'other' })
    h.answer.current = { providerId: FETCH.providerId, envProvider: null }
    h.status.refresh()
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'this' })
    h.detach()
    expect(h.route()).toEqual({ kind: 'unknown' })
    const unserved = fixture({ status: 'unavailable', value: undefined })
    unserved.observe()
    await Promise.resolve()
    expect(unserved.reader.provider).toHaveBeenCalled()
    expect(unserved.route()).toEqual({ kind: 'unknown' })
  })
})

