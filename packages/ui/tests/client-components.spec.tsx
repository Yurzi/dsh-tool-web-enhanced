// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionSection, RouteStore } from 'dsh-tool-web-enhanced-core/client'
import type { ConnectionView, Route, SelectionView } from 'dsh-tool-web-enhanced-core/shared'
import { PROFILE_PACKAGE, SEARCH, FETCH } from 'dsh-tool-web-enhanced-core/shared'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { forwardRef } from 'react'
import { createSnapshotStore, createWebConnectionsService } from '../src/client/service.ts'
import { zh } from '../src/client/locales.ts'
import overviewCss from '../src/client/ProfileDetailSection.module.css'
import type { Translate } from '../src/client/ComposerConnectionMenu.tsx'
import menuCss from '../src/client/ComposerConnectionMenu.module.css'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => {
  // The capability tabs are DSH's own: their roles and keyboard walk are part of the menu's behaviour.
  const { SegmentedTabs } = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    SegmentedTabs,
    Button: ({ children, onClick, disabled, size, ...props }: any) => (
      <button type="button" onClick={onClick} disabled={disabled} data-size={size} {...props}>
        {children}
      </button>
    ),
    Modal: ({ open, title, closeLabel, onClose, footer, children }: any) =>
      open ? (
        <div role="dialog" aria-label={title}>
          <h3>{title}</h3>
          <div>{children}</div>
          <div>{footer}</div>
          <button type="button" aria-label={closeLabel} onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      ) : null,
    MenuGroup: ({ label, children }: any) => (
      <div role="group" aria-label={label}>
        <div>{label}</div>
        {children}
      </div>
    ),
    MenuSurface: forwardRef(({ children, ...props }: any, ref: any) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    )),
    StateDot: ({ state, ...props }: any) => <span data-state={state} {...props} />,
    Toast: ({ text, icon }: any) => (
      <div role="status">
        <span data-testid="toast-icon">{icon}</span>
        {text}
      </div>
    ),
    useAnchoredPosition: () => ({ top: 0, left: 0 }),
    useDismissOnOutsidePointer: () => {},
    IconGlobeOutlineRegular: (props: any) => <svg data-testid="icon-globe" {...props} />,
    IconChevronDownOutlineRegular: (props: any) => <svg data-testid="icon-chevron" {...props} />,
    IconChevronRightOutlineRegular: (props: any) => <svg data-testid="icon-chevron-right" {...props} />,
    IconCheckOutlineRegular: (props: any) => <svg data-testid="icon-check" {...props} />,
    IconSettingsOutlineRegular: (props: any) => <svg data-testid="icon-settings" {...props} />,
    IconWarningOutlineRegular: (props: any) => <svg data-testid="icon-warning" {...props} />,
  }
})

import { ComposerConnectionMenu, modelKeyOf } from '../src/client/ComposerConnectionMenu.tsx'
import { ActivationPrompt } from '../src/client/ActivationPrompt.tsx'
import { ProfileDetailSection } from '../src/client/ProfileDetailSection.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const t: Translate = (key, params) => {
  const template = (zh as Record<string, string>)[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

function mockConnection(
  id: string,
  label: string,
  status: 'ready' | 'disabled' | 'needs-credential' = 'ready',
): ConnectionView {
  return {
    id,
    label,
    kind: 'adapter',
    remote: true,
    access: 'api-key',
    status,
  }
}

interface MockSectionResult {
  readonly section: ConnectionSection
  readonly loadMock: ReturnType<typeof vi.fn>
  readonly setMock: ReturnType<typeof vi.fn>
}

function createMockSection(params: {
  capability: 'search' | 'fetch'
  order: number
  selectedId?: string | null
  view?: SelectionView | undefined
  readFailure?: 'invalid-settings' | 'failed'
  connections?: ConnectionView[]
  openSettings?: () => void
  remoteServicesOff?: boolean
  setFn?: (update: { connectionId?: string | null }) => Promise<{ ok: boolean; error?: { message: string } }>
}): MockSectionResult {
  const view =
    'view' in params
      ? params.view
      : params.readFailure !== undefined
        ? undefined
        : {
            selection: { connectionId: params.selectedId ?? null, revision: 1, options: {} },
            source: 'session' as const,
            connections: params.connections ?? [
              mockConnection('conn-1', 'Connection 1'),
              mockConnection('conn-2', 'Connection 2'),
            ],
          }
  const selectionStore = createSnapshotStore({
    view,
    saving: false,
    readFailure: params.readFailure,
  })
  const settingsStore = createSnapshotStore(params.openSettings)

  const loadMock = vi.fn().mockResolvedValue(undefined)
  const setMock = vi.fn().mockImplementation(async update => {
    if (params.setFn) return params.setFn(update)
    return { ok: true }
  })

  const section: ConnectionSection = {
    capability: params.capability,
    order: params.order,
    title: () => (params.capability === 'search' ? 'Web Search' : 'Web Fetch'),
    selection: {
      source: () => selectionStore,
      load: loadMock,
      set: setMock,
    },
    describe: conn => ({
      label: conn.label,
      ...(conn.status === 'ready' ? { caption: 'Ready' } : {}),
      ...(conn.status !== 'ready' ? { reason: 'API Key needed' } : {}),
    }),
    sourceText: () => 'Chosen for this conversation',
    writeFailureText: err => `Failed: ${err.message}`,
    settings: settingsStore,
    remoteServicesOff: createSnapshotStore(params.remoteServicesOff ?? false),
  }

  return { section, loadMock, setMock }
}

function mockConfigForm(userOverride?: Record<string, unknown>): {
  form: ConfigForm<Record<string, unknown>>
  mutateMock: ReturnType<typeof vi.fn>
} {
  const snapshot: ConfigFormSnapshot<Record<string, unknown>> = {
    status: 'ready',
    value: {
      searchProvider: userOverride?.searchProvider ?? SEARCH.providerId,
      fetchProvider: userOverride?.fetchProvider ?? FETCH.providerId,
    },
    base: {
      searchProvider: SEARCH.providerId,
      fetchProvider: FETCH.providerId,
    },
    user: userOverride ?? {},
    revision: 1,
    writable: true,
  }
  const store = createSnapshotStore(snapshot)
  const mutateMock = vi.fn().mockResolvedValue(true)

  const form: ConfigForm<Record<string, unknown>> = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: cb => store.subscribe(cb),
    mutate: mutateMock,
    set: vi.fn().mockResolvedValue(true),
    unset: vi.fn().mockResolvedValue(true),
  }

  return { form, mutateMock }
}

/** The composer button: its name states each side as "<title>：<state>". */
const trigger = () => screen.getByRole('button', { name: /^Web (Search|Fetch)：/ })

describe('ComposerConnectionMenu', () => {
  // jsdom does not lay out, so it has no scrollIntoView; record which rows were asked to scroll.
  let scrolled: { element: Element; options: unknown }[] = []
  beforeEach(() => {
    scrolled = []
    Element.prototype.scrollIntoView = function (this: Element, options?: unknown) {
      scrolled.push({ element: this, options })
    }
  })

  it('computes modelKeyOf correctly from session projection', () => {
    expect(modelKeyOf(undefined)).toBe('')
    expect(modelKeyOf({ next: { provider: 'deepseek-official', model: 'deepseek-chat' } })).toBe(
      'deepseek-official/deepseek-chat',
    )
  })

  it('renders nothing when there are 0 sections', () => {
    const webConnections = createWebConnectionsService()
    const { container } = render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders button showing search connection when 1 section (search) is registered and calls load with modelKey', () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection, loadMock } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'conn-1',
    })
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        modelKey="deepseek-official/deepseek-chat"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    const button = trigger()
    expect(button.getAttribute('aria-label')).toBe('Web Search：Connection 1')
    expect(button.textContent).toContain('Connection 1')

    expect(loadMock).toHaveBeenCalledWith('sess-1', 'deepseek-official/deepseek-chat')
  })

  it('renders button showing fetch connection when 1 section (fetch only) is registered', () => {
    const webConnections = createWebConnectionsService()
    const { section: fetchSection } = createMockSection({
      capability: 'fetch',
      order: 20,
      selectedId: 'conn-2',
    })
    webConnections.register(fetchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    const button = trigger()
    expect(button.getAttribute('aria-label')).toBe('Web Fetch：Connection 2')
    expect(button.textContent).toContain('Connection 2')
    expect(button.querySelector('[data-capability="search"]')).toBeNull()
  })

  it('shows both sides on the button, search first, and names each side', () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'conn-1',
    })
    const { section: fetchSection } = createMockSection({
      capability: 'fetch',
      order: 20,
      selectedId: 'conn-2',
    })
    webConnections.register(fetchSection)
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    const button = trigger()
    expect(button.getAttribute('aria-label')).toBe('Web Search：Connection 1 · Web Fetch：Connection 2')
    expect(button.getAttribute('title')).toBe('Web Search：Connection 1 · Web Fetch：Connection 2')
    const sides = [...button.querySelectorAll('[data-capability]')]
    expect(sides.map(side => [side.getAttribute('data-capability'), side.textContent])).toEqual([
      ['search', 'Connection 1'],
      ['fetch', 'Connection 2'],
    ])
    expect(button.querySelector('[data-state="warning"]')).toBeNull()
  })

  /** Which sides of the button carry a needs-attention mark, beside their labels and on the globe. */
  const markedSides = (button: HTMLElement) => {
    const labelled = [...button.querySelectorAll('[data-capability] [data-state="warning"]')]
      .map(mark => mark.closest('[data-capability]')!.getAttribute('data-capability'))
    const globe = [...button.querySelectorAll('[data-mark]')].map(mark => mark.getAttribute('data-mark'))
    expect(globe).toEqual(labelled)
    return labelled
  }

  it('marks only the side that needs attention and names a non-connection state with its side', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({
      capability: 'search', order: 10, selectedId: 'conn-1',
      connections: [mockConnection('conn-1', 'Connection 1', 'needs-credential')],
    }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, selectedId: null }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    const button = trigger()
    expect(button.getAttribute('aria-label')).toBe('Web Search：Connection 1（需要处理） · Web Fetch：已关闭')
    expect(button.querySelector('[data-capability="fetch"]')?.textContent).toBe('Web Fetch：已关闭')
    expect(markedSides(button)).toEqual(['search'])
  })

  it('marks a side whose capability the web row routes to another provider', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'search', order: 10, selectedId: 'conn-1' }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, selectedId: 'conn-2' }).section)
    webConnections.registerRoute('fetch', { source: createSnapshotStore<Route>({ kind: 'other', provider: 'http', providerId: FETCH.providerId }) })
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    const button = trigger()
    expect(button.getAttribute('aria-label')).toBe('Web Search：Connection 1 · Web Fetch：Connection 2（需要处理）')
    expect(markedSides(button)).toEqual(['fetch'])
  })

  it('marks a side that could not be read and a side whose connection was removed', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'search', order: 10, readFailure: 'failed' }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, selectedId: 'gone' }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    const button = trigger()
    expect(button.getAttribute('aria-label')).toBe('Web Search：读取失败（需要处理） · Web Fetch：连接已移除（需要处理）')
    expect(markedSides(button)).toEqual(['search', 'fetch'])
  })

  it('renders each side mark beside its label and again on the globe for the compact display', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'search', order: 10, readFailure: 'failed' }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, readFailure: 'failed' }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    const button = trigger()
    const labels = button.querySelector('.' + menuCss.labels)!
    const globe = button.querySelector('.' + menuCss.icon)!
    for (const side of button.querySelectorAll('[data-capability]')) {
      const label = side.querySelector('.' + menuCss.sideLabel)!
      const mark = side.querySelector('.' + menuCss.sideMark)!
      expect(labels.contains(side)).toBe(true)
      expect(label.contains(mark)).toBe(false)
      const capability = side.getAttribute('data-capability')
      expect(globe.querySelector('.' + menuCss.iconMarks + ' [data-mark="' + capability + '"] [data-state="warning"]')).not.toBeNull()
    }
    expect(labels.contains(globe)).toBe(false)
    expect(markedSides(button)).toEqual(['search', 'fetch'])
  })

  const dialog = () => screen.getByRole('dialog', { name: t('menu.aria') })
  const tab = (name: string) => screen.getByRole('tab', { name })
  const panel = (name: string) => screen.getByRole('tabpanel', { name })

  it('opens a dialog on the first capability tab, tabs in section order, triggering selection load', () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection, loadMock } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'conn-1',
    })
    const { section: fetchSection } = createMockSection({
      capability: 'fetch',
      order: 20,
      selectedId: 'conn-2',
    })
    webConnections.register(fetchSection)
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        modelKey="deepseek-official/deepseek-chat"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    const button = trigger()
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(button)

    expect(button.getAttribute('aria-controls')).toBe(dialog().id)
    const tablist = within(dialog()).getByRole('tablist', { name: t('menu.tabs') })
    expect(within(tablist).getAllByRole('tab').map(item => [item.textContent, item.getAttribute('aria-selected')])).toEqual([
      ['Web Search', 'true'],
      ['Web Fetch', 'false'],
    ])
    // The switch is the bottom layer, after the panels.
    expect(dialog().lastElementChild?.contains(tablist)).toBe(true)
    expect(panel('Web Search')).toBeDefined()

    expect(loadMock).toHaveBeenCalledWith('sess-1', 'deepseek-official/deepseek-chat')
  })

  it('shows one capability panel at a time and switches it from the tabs', () => {
    const webConnections = createWebConnectionsService()
    for (const [capability, order, label] of [
      ['search', 10, 'Search connection'],
      ['fetch', 20, 'Fetch connection'],
    ] as const) {
      const { section } = createMockSection({
        capability, order, selectedId: capability,
        connections: [mockConnection(capability, label)],
      })
      webConnections.register(section)
    }
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    fireEvent.click(trigger())

    const search = panel('Web Search')
    expect(tab('Web Search').getAttribute('aria-controls')).toBe(search.id)
    expect(document.getElementById(search.getAttribute('aria-describedby')!)?.textContent).toBe('Search connection·Chosen for this conversation')
    expect(within(search).getByRole('menuitemradio', { name: /Search connection/ })).toBeDefined()
    expect(screen.queryByRole('menuitemradio', { name: /Fetch connection/ })).toBeNull()
    expect(screen.queryByRole('tabpanel', { name: 'Web Fetch' })).toBeNull()

    fireEvent.click(tab('Web Fetch'))
    expect(tab('Web Fetch').getAttribute('aria-selected')).toBe('true')
    expect(tab('Web Search').getAttribute('aria-selected')).toBe('false')
    expect(within(panel('Web Fetch')).getByRole('menuitemradio', { name: /Fetch connection/ })).toBeDefined()
    expect(screen.queryByRole('menuitemradio', { name: /Search connection/ })).toBeNull()
  })

  it('keeps the hidden panel laid out in the same cell, out of reach, so switching keeps the menu size', () => {
    const webConnections = createWebConnectionsService()
    for (const [capability, order] of [['search', 10], ['fetch', 20]] as const) {
      webConnections.register(createMockSection({ capability, order }).section)
    }
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    fireEvent.click(trigger())

    const panels = screen.getAllByRole('tabpanel', { hidden: true })
    expect(panels).toHaveLength(2)
    expect(new Set(panels.map(element => element.parentElement))).toEqual(new Set([dialog().querySelector('.' + menuCss.panels)]))
    const fetch = panels.find(element => element.getAttribute('aria-labelledby') === tab('Web Fetch').id)!
    expect(fetch.getAttribute('aria-hidden')).toBe('true')
    expect(fetch.classList.contains(menuCss.panelInactive!)).toBe(true)
    expect(getComputedStyle(fetch).visibility).toBe('hidden')

    fireEvent.click(tab('Web Fetch'))
    expect(fetch.getAttribute('aria-hidden')).toBeNull()
    expect(getComputedStyle(fetch).visibility).not.toBe('hidden')
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toEqual(panels)
  })

  it('reopens on the first tab', () => {
    const webConnections = createWebConnectionsService()
    for (const [capability, order] of [['search', 10], ['fetch', 20]] as const) {
      webConnections.register(createMockSection({ capability, order }).section)
    }
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    const button = trigger()
    fireEvent.click(button)
    fireEvent.click(tab('Web Fetch'))
    expect(tab('Web Fetch').getAttribute('aria-selected')).toBe('true')

    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(button)
    expect(tab('Web Search').getAttribute('aria-selected')).toBe('true')
    expect(tab('Web Fetch').getAttribute('aria-selected')).toBe('false')
  })

  it('scrolls the selected row of a panel into view when it is shown', () => {
    const webConnections = createWebConnectionsService()
    const connections = ['A', 'B', 'C', 'D'].map(name => mockConnection('conn-' + name, 'Connection ' + name))
    webConnections.register(createMockSection({ capability: 'search', order: 10, selectedId: 'conn-B', connections }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, selectedId: 'conn-D', connections }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    fireEvent.click(trigger())

    expect(scrolled).toEqual([{ element: within(panel('Web Search')).getByRole('menuitemradio', { name: /Connection B/ }), options: { block: 'nearest' } }])

    scrolled = []
    fireEvent.click(tab('Web Fetch'))
    const selected = within(panel('Web Fetch')).getByRole('menuitemradio', { name: /Connection D/ })
    expect(selected.getAttribute('aria-checked')).toBe('true')
    expect(scrolled).toEqual([{ element: selected, options: { block: 'nearest' } }])
  })

  it('walks the tabs with the arrow, Home and End keys, keeping one tab stop, and closes on Escape', () => {
    const webConnections = createWebConnectionsService()
    for (const [capability, order] of [['search', 10], ['fetch', 20]] as const) {
      webConnections.register(createMockSection({ capability, order }).section)
    }
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    fireEvent.click(trigger())
    const search = tab('Web Search')
    const fetch = tab('Web Fetch')
    expect(search.tagName).toBe('BUTTON') // Native Enter/Space activation, no simulated button roles.
    expect([search.tabIndex, fetch.tabIndex]).toEqual([0, -1])
    // Opening the dialog moves focus into it, onto the selected tab.
    expect(document.activeElement).toBe(search)

    fireEvent.keyDown(search, { key: 'ArrowRight' })
    expect(fetch.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(fetch)
    expect([search.tabIndex, fetch.tabIndex]).toEqual([-1, 0])
    fireEvent.keyDown(fetch, { key: 'ArrowRight' })
    expect(search.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(search, { key: 'End' })
    expect(fetch.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(fetch, { key: 'Home' })
    expect(search.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(search)

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('marks a tab whose side needs attention and keeps the tab named by its title', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'search', order: 10, selectedId: 'conn-1' }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, readFailure: 'failed' }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    fireEvent.click(trigger())

    expect(tab('Web Search').querySelector('[data-state="warning"]')).toBeNull()
    expect(tab('Web Fetch').querySelector('[data-state="warning"]')).not.toBeNull()
    expect(tab('Web Fetch').querySelector('[title]')?.getAttribute('title')).toBe('Web Fetch：读取失败（需要处理）')
  })

  it('anchors the menu to the button and caps it to the content area on a 390px viewport', () => {
    vi.stubGlobal('innerWidth', 390)
    vi.stubGlobal('innerHeight', 900)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480)
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'search', order: 10 }).section)
    const { container } = render(<main data-conversation-session>
      <ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />
    </main>)
    vi.spyOn(container.querySelector('main')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(64, 0, 326, 900))
    const button = trigger()
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 700, 28, 28))
    fireEvent.click(button)
    const menu = dialog()
    expect(menu.style.maxWidth).toBe('314px')
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(64)
    expect(Number.parseFloat(menu.style.left) + Number.parseFloat(menu.style.maxWidth)).toBeLessThanOrEqual(378)
    expect(Number.parseFloat(menu.style.top)).toBe(212)
  })

  it('allows switching connection on click', async () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection, setMock } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'conn-1',
    })
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    fireEvent.click(trigger())

    const conn2Button = screen.getByRole('menuitemradio', { name: /Connection 2/ })
    await act(async () => {
      fireEvent.click(conn2Button)
    })

    expect(setMock).toHaveBeenCalledWith('sess-1', {
      connectionId: 'conn-2',
    })
  })

  it('allows turning off connection on click', async () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection, setMock } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'conn-1',
    })
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    fireEvent.click(trigger())

    const offButton = screen.getByRole('menuitemradio', { name: t('menu.offRow') })
    await act(async () => {
      fireEvent.click(offButton)
    })

    expect(setMock).toHaveBeenCalledWith('sess-1', {
      connectionId: null,
    })
  })

  it('does not render Off row or connections list while view is loading, shows loading row', () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection } = createMockSection({
      capability: 'search',
      order: 10,
      view: undefined,
    })
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    fireEvent.click(trigger())

    expect(screen.queryByRole('menuitemradio', { name: t('menu.offRow') })).toBeNull()
    // The panel summary and its body both say so.
    expect(within(dialog()).getAllByText(t('button.loading'))).toHaveLength(2)
  })

  it('does not render Off row or connections list when read fails, shows readFailed row and clicking it calls load', () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection, loadMock } = createMockSection({
      capability: 'search',
      order: 10,
      view: undefined,
      readFailure: 'failed',
    })
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    expect(trigger().getAttribute('aria-label')).toBe('Web Search：读取失败（需要处理）')
    fireEvent.click(trigger())

    expect(screen.queryByRole('menuitemradio', { name: t('menu.offRow') })).toBeNull()
    const failedBtn = screen.getByRole('button', { name: t('button.readFailed') })
    expect(failedBtn).toBeDefined()
    fireEvent.click(failedBtn)
    expect(loadMock).toHaveBeenCalledWith('sess-1')
  })

  it('displays button.missing when selected connection is removed from connections', () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'removed-conn',
      connections: [mockConnection('conn-1', 'Connection 1')],
    })
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    const button = trigger()
    expect(button.textContent).toContain(t('button.missing'))
  })

  it('explains invalid settings, offers the section settings and no retry, and marks that side', () => {
    const openSettings = vi.fn()
    const webConnections = createWebConnectionsService()
    const { section, loadMock } = createMockSection({ capability: 'fetch', order: 20, readFailure: 'invalid-settings', openSettings })
    webConnections.register(createMockSection({ capability: 'search', order: 10, selectedId: 'conn-1' }).section)
    webConnections.register(section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    const button = trigger()
    expect(button.getAttribute('aria-label')).toBe('Web Search：Connection 1 · Web Fetch：设置无效（需要处理）')
    expect(markedSides(button)).toEqual(['fetch'])

    fireEvent.click(button)
    fireEvent.click(tab('Web Fetch'))
    const group = panel('Web Fetch')
    // No source is named for settings that cannot be read.
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe(t('button.invalidSettings'))
    expect(within(group).getByText(t('menu.invalidSettings', { capability: 'Web Fetch' }))).toBeDefined()
    expect(within(group).queryByRole('button', { name: t('button.readFailed') })).toBeNull()
    expect(within(group).queryByRole('menuitemradio')).toBeNull()
    loadMock.mockClear()
    fireEvent.click(within(group).getByRole('button', { name: t('menu.settings') }))
    expect(openSettings).toHaveBeenCalledOnce()
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('lists only connections that are turned on, keeping a selected one that was turned off', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({
      capability: 'search', order: 10, selectedId: 'conn-off',
      connections: [mockConnection('conn-1', 'Connection 1'), mockConnection('conn-off', 'Chosen but off', 'disabled'), mockConnection('conn-other', 'Other off', 'disabled')],
    }).section)
    webConnections.register(createMockSection({
      capability: 'fetch', order: 20, selectedId: null,
      connections: [mockConnection('conn-gone', 'Off service', 'disabled')],
    }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    fireEvent.click(trigger())
    const search = within(panel('Web Search'))
    expect(search.getAllByRole('menuitemradio').map(row => row.textContent)).toEqual([t('menu.offRow'), 'Connection 1Ready', 'Chosen but offAPI Key needed'])
    expect(search.getByRole('menuitemradio', { name: /Chosen but off/u }).getAttribute('aria-checked')).toBe('true')
    expect(search.queryByText('Other off')).toBeNull()
    fireEvent.click(tab('Web Fetch'))
    const fetch = within(panel('Web Fetch'))
    expect(fetch.queryByText('Off service')).toBeNull()
    expect(fetch.getByText(t('menu.empty'))).toBeDefined()
  })

  it('says at the foot of a panel whose remote services are all off where to turn more on, and opens settings from it', () => {
    const openSettings = vi.fn()
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'search', order: 10, selectedId: 'conn-1', remoteServicesOff: true, openSettings }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, selectedId: 'conn-2', remoteServicesOff: false, openSettings }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    fireEvent.click(trigger())
    const hint = within(panel('Web Search')).getByRole('button', { name: t('menu.moreServices') })
    // A row-wide action that reads as one: the link colour and a trailing chevron (styles in the appearance spec).
    expect(hint.className).toBe(menuCss.footerAction)
    expect(within(hint).getByTestId('icon-chevron-right').getAttribute('aria-hidden')).toBe('true')
    // Below the list and its options, outside the part that scrolls.
    expect(hint.closest('.' + menuCss.panelBody)).toBeNull()
    expect(within(panel('Web Search')).getByRole('menu').compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(tab('Web Fetch'))
    expect(within(panel('Web Fetch')).queryByText(t('menu.moreServices'))).toBeNull()

    fireEvent.click(tab('Web Search'))
    fireEvent.click(within(panel('Web Search')).getByRole('button', { name: t('menu.moreServices') }))
    expect(openSettings).toHaveBeenCalledOnce()
    // The same action as the settings button: the menu closes and the button gets focus back.
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger())
  })

  it('shows the more-services hint for a lone fetch section, as text while settings cannot be opened', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, selectedId: 'conn-2', remoteServicesOff: true }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed={false} fetchServed t={t} />)

    fireEvent.click(trigger())
    const group = panel('Web Fetch')
    expect(within(group).getByText(t('menu.moreServices')).tagName).toBe('SPAN')
    expect(within(group).queryByRole('button', { name: t('menu.moreServices') })).toBeNull()
  })

  it('follows the remote services fact while the menu is open', () => {
    const webConnections = createWebConnectionsService()
    const { section } = createMockSection({ capability: 'search', order: 10, selectedId: 'conn-1', openSettings: vi.fn() })
    const fact = createSnapshotStore(false)
    webConnections.register({ ...section, remoteServicesOff: fact })
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    fireEvent.click(trigger())
    expect(screen.queryByText(t('menu.moreServices'))).toBeNull()
    act(() => { fact.set(true) })
    expect(within(panel('Web Search')).getByRole('button', { name: t('menu.moreServices') })).toBeDefined()
    act(() => { fact.set(false) })
    expect(screen.queryByText(t('menu.moreServices'))).toBeNull()
  })

  it('hides a list read before the settings became invalid', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({
      capability: 'search', order: 10, readFailure: 'invalid-settings',
      view: { selection: { connectionId: 'conn-1', revision: 1, options: {} }, source: 'session', connections: [mockConnection('conn-1', 'Connection 1')] },
    }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    expect(trigger().getAttribute('aria-label')).toBe('Web Search：设置无效（需要处理）')
    fireEvent.click(trigger())
    expect(screen.getByText(t('menu.invalidSettings', { capability: 'Web Search' }))).toBeDefined()
    expect(screen.queryByRole('menuitemradio')).toBeNull()
  })

  it('shows disabled capability warning when search row is disabled', () => {
    const webConnections = createWebConnectionsService()
    const { section: fetchSection } = createMockSection({
      capability: 'fetch',
      order: 20,
      selectedId: 'conn-2',
    })
    webConnections.register(fetchSection)

    const onOpenPlugins = vi.fn()

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={false}
        fetchServed={true}
        webConfig={{ searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId }}
        onOpenPlugins={onOpenPlugins}
        t={t}
      />,
    )

    fireEvent.click(trigger())

    expect(
      screen.getByText(t('disabled.search')),
    ).toBeDefined()

    const openBtn = screen.getByRole('button', { name: t('disabled.openPlugins') })
    fireEvent.click(openBtn)
    expect(onOpenPlugins).toHaveBeenCalled()
  })

  it('shows disabled capability warning when fetch row is disabled', () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'conn-1',
    })
    webConnections.register(searchSection)
    const onOpenPlugins = vi.fn()

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={false}
        webConfig={{ searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId }}
        onOpenPlugins={onOpenPlugins}
        t={t}
      />,
    )

    fireEvent.click(trigger())

    expect(
      screen.getByText(t('disabled.fetch')),
    ).toBeDefined()
  })

  it('shows toast when write fails', async () => {
    const webConnections = createWebConnectionsService()
    const { section: searchSection } = createMockSection({
      capability: 'search',
      order: 10,
      selectedId: 'conn-1',
      setFn: async () => ({ ok: false, error: { message: 'Write rejected' } }),
    })
    webConnections.register(searchSection)

    render(
      <ComposerConnectionMenu
        sessionId="sess-1"
        webConnections={webConnections}
        searchServed={true}
        fetchServed={true}
        t={t}
      />,
    )

    fireEvent.click(trigger())

    const conn2Button = screen.getByRole('menuitemradio', { name: /Connection 2/ })
    await act(async () => {
      fireEvent.click(conn2Button)
    })

    expect(screen.getByText('Failed: Write rejected')).toBeDefined()
  })

  it.each(['profile badge', 'composer menu'] as const)(
    'settles when the %s route publishes synchronously on first subscription',
    async surface => {
      const { form: webConfigForm } = mockConfigForm()
      const listeners = new Set<() => void>()
      let snapshot: Route = { kind: 'unknown' }
      const publish = (): void => {
        snapshot = { kind: 'this' }
        for (const listener of listeners) listener()
      }
      const subscribe = vi.fn((listener: () => void) => {
        listeners.add(listener)
        if (listeners.size === 1) publish()
        return () => { listeners.delete(listener) }
      })
      const route: RouteStore = {
        source: { getSnapshot: () => snapshot, subscribe },
      }
      const webConnections = createWebConnectionsService()
      const { section } = createMockSection({
        capability: 'search', order: 10, selectedId: 'conn-1',
      })
      webConnections.registerRoute('search', route)
      webConnections.register(section)
      const consoleError = vi.spyOn(console, 'error')
      try {
        await act(async () => {
          if (surface === 'profile badge') {
            render(
              <ProfileDetailSection
                subject={{
                  kind: 'bundle',
                  pkg: {
                    name: PROFILE_PACKAGE, installed: true, availability: 'installation',
                    official: false, enabled: true, rows: [],
                  },
                }}
                webConfigForm={webConfigForm}
                nativeSearchServed={false}
                webConnections={webConnections}
                t={t}
              />,
            )
          } else {
            render(
              <ComposerConnectionMenu
                sessionId="sess-1"
                webConnections={webConnections}
                searchServed={true}
                fetchServed={true}
                t={t}
              />,
            )
          }
        })
        if (surface === 'composer menu') {
          await act(async () => {
            fireEvent.click(trigger())
          })
        }
        if (surface === 'profile badge') {
          expect(screen.getAllByText(t('overview.status.routed')).length).toBeGreaterThan(0)
        } else {
          expect(screen.getByRole('tabpanel', { name: 'Web Search' })).toBeDefined()
        }
        expect(subscribe).toHaveBeenCalledTimes(1)
        await act(async () => { publish() })
        expect(subscribe).toHaveBeenCalledTimes(1)
        expect(consoleError).not.toHaveBeenCalled()
      } finally {
        consoleError.mockRestore()
      }
    },
  )
})

describe('ActivationPrompt', () => {
  it('renders guidance modal and handles later / open buttons', () => {
    const onDismiss = vi.fn()
    const onOpenDetails = vi.fn()

    render(
      <ActivationPrompt
        packageName={PROFILE_PACKAGE}
        webConfigForm={mockConfigForm().form}
        nativeSearchServed={false}
        onDismiss={onDismiss}
        onOpenDetails={onOpenDetails}
        t={t}
      />,
    )

    expect(screen.getByText(t('activation.title'))).toBeDefined()
    expect(screen.getByText(t('activation.body'))).toBeDefined()
    expect(screen.getByText(t('activation.remoteOff'))).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: t('activation.later') }))
    expect(onDismiss).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: t('activation.open') }))
    expect(onOpenDetails).toHaveBeenCalled()
  })

  it('replaces the guidance, remote services sentence included, when the upgrade check finds a problem', () => {
    render(
      <ActivationPrompt
        packageName={PROFILE_PACKAGE}
        webConfigForm={mockConfigForm({ searchProvider: 'web-search-deepseek' }).form}
        nativeSearchServed={false}
        onDismiss={vi.fn()}
        onOpenDetails={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText(t('activation.preflight'))).toBeDefined()
    expect(screen.queryByText(t('activation.body'))).toBeNull()
    expect(screen.queryByText(t('activation.remoteOff'))).toBeNull()
  })
})

describe('ProfileDetailSection', () => {
  it('renders null when subject is not bundle or not PROFILE_PACKAGE', () => {
    const { form: webConfigForm } = mockConfigForm()
    const webConnections = createWebConnectionsService()

    const { container } = render(
      <ProfileDetailSection
        subject={{ kind: 'item', id: 'some-item' }}
        webConfigForm={webConfigForm}
        nativeSearchServed={false}
        webConnections={webConnections}
        t={t}
      />,
    )
    expect(container.firstChild).toBeNull()

    const { container: container2 } = render(
      <ProfileDetailSection
        subject={{
          kind: 'bundle',
          pkg: {
            name: 'other-package',
            installed: true,
            availability: 'installation',
            official: false,
            enabled: true,
            rows: [],
          },
        }}
        webConfigForm={webConfigForm}
        nativeSearchServed={false}
        webConnections={webConnections}
        t={t}
      />,
    )
    expect(container2.firstChild).toBeNull()
  })

  it('renders overview and shows healthy when no issues exist', () => {
    const { form: webConfigForm } = mockConfigForm()
    const webConnections = createWebConnectionsService()
    const subject = {
      kind: 'bundle' as const,
      pkg: {
        name: PROFILE_PACKAGE,
        installed: true,
        availability: 'installation' as const,
        official: false,
        enabled: true,
        rows: [],
      },
    }

    render(
      <ProfileDetailSection
        subject={subject}
        webConfigForm={webConfigForm}
        nativeSearchServed={false}
        webConnections={webConnections}
        t={t}
      />,
    )

    expect(screen.getByText(t('overview.title'))).toBeDefined()
    expect(screen.getByText(t('preflight.healthy'))).toBeDefined()
  })

  it('shows preflight issues and handles "移除" button', async () => {
    const { form: webConfigForm, mutateMock } = mockConfigForm({ searchProvider: 'deepseek-official' })
    const webConnections = createWebConnectionsService()
    const subject = {
      kind: 'bundle' as const,
      pkg: {
        name: PROFILE_PACKAGE,
        installed: true,
        availability: 'installation' as const,
        official: false,
        enabled: true,
        rows: [],
      },
    }

    render(
      <ProfileDetailSection
        subject={subject}
        webConfigForm={webConfigForm}
        nativeSearchServed={false}
        webConnections={webConnections}
        t={t}
      />,
    )

    expect(
      screen.getByText(
        t('preflight.userOverride', { tool: t('overview.search.title'), value: 'deepseek-official' }),
      ),
    ).toBeDefined()

    const fixButton = screen.getByRole('button', { name: t('preflight.action.fix') })
    expect(fixButton).toBeDefined()

    fireEvent.click(fixButton)
    const dialog = screen.getByRole('dialog', { name: t('preflight.confirm.title') })
    expect(dialog).toBeDefined()
    expect(screen.getByText(t('preflight.confirm.body', { fields: 'searchProvider' }))).toBeDefined()

    const confirmButton = within(dialog).getByRole('button', { name: t('preflight.confirm.confirm') })
    await act(async () => {
      fireEvent.click(confirmButton)
    })

    expect(mutateMock).toHaveBeenCalledWith(
      [{ op: 'unset', path: ['searchProvider'] }],
      1,
    )
    expect(screen.getByText(t('preflight.action.success'))).toBeDefined()
    expect(screen.getByTestId('icon-check')).toBeDefined()
  })

  it('keeps the overview unboxed and places repair only beside a repairable issue', () => {
    const { form: webConfigForm } = mockConfigForm({ searchProvider: 'deepseek-official' })
    const { container } = render(
      <ProfileDetailSection
        subject={{ kind: 'bundle', pkg: { name: PROFILE_PACKAGE, installed: true, availability: 'installation', official: false, enabled: true, rows: [] } }}
        webConfigForm={webConfigForm}
        nativeSearchServed
        webConnections={createWebConnectionsService()}
        t={t}
      />,
    )
    const panel = container.querySelector('.' + overviewCss.container)!
    expect(getComputedStyle(panel).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(panel).borderTopWidth).toBe('')
    const stylesheet = [...document.styleSheets].find(sheet =>
      [...sheet.cssRules].some(rule => rule instanceof CSSStyleRule && rule.selectorText === '.' + overviewCss.container),
    )!
    const containerRule = [...stylesheet.cssRules].find(rule => rule instanceof CSSStyleRule && rule.selectorText === '.' + overviewCss.container) as CSSStyleRule
    expect(containerRule.style.getPropertyValue('background')).toBe('')
    expect(containerRule.style.getPropertyValue('border')).toBe('')
    const fix = screen.getByRole('button', { name: t('preflight.action.fix') })
    const issue = fix.closest('.' + overviewCss.issueItem)
    expect(issue).not.toBeNull()
    expect(issue?.textContent).toContain(t('preflight.userOverride', { tool: t('overview.search.title'), value: 'deepseek-official' }))
    expect(issue?.textContent).not.toContain(t('preflight.nativeSearchConflict'))
    expect(fix.getAttribute('data-size')).toBe('sm')
    for (const badge of container.querySelectorAll('.' + overviewCss.routedBadge + ', .' + overviewCss.notRoutedBadge)) {
      expect(badge.querySelector('[data-state]')).not.toBeNull()
      expect(getComputedStyle(badge).fontSize).toBe('12px')
      expect(getComputedStyle(badge).whiteSpace).toBe('nowrap')
    }
  })

  it('does not show repair beside the non-repairable native plugin conflict', () => {
    const { form: webConfigForm } = mockConfigForm()
    render(<ProfileDetailSection
      subject={{ kind: 'bundle', pkg: { name: PROFILE_PACKAGE, installed: true, availability: 'installation', official: false, enabled: true, rows: [] } }}
      webConfigForm={webConfigForm} nativeSearchServed webConnections={createWebConnectionsService()} t={t}
    />)
    expect(screen.getByText(t('preflight.nativeSearchConflict'))).toBeDefined()
    expect(screen.queryByRole('button', { name: t('preflight.action.fix') })).toBeNull()
  })

  it('shows error toast when mutate fails', async () => {
    const { form: webConfigForm, mutateMock } = mockConfigForm({ searchProvider: 'deepseek-official' })
    mutateMock.mockResolvedValueOnce(false)
    const webConnections = createWebConnectionsService()
    const subject = {
      kind: 'bundle' as const,
      pkg: {
        name: PROFILE_PACKAGE,
        installed: true,
        availability: 'installation' as const,
        official: false,
        enabled: true,
        rows: [],
      },
    }

    render(
      <ProfileDetailSection
        subject={subject}
        webConfigForm={webConfigForm}
        nativeSearchServed={false}
        webConnections={webConnections}
        t={t}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: t('preflight.action.fix') }))
    const dialog = screen.getByRole('dialog')
    const confirmButton = within(dialog).getByRole('button', { name: t('preflight.confirm.confirm') })
    await act(async () => {
      fireEvent.click(confirmButton)
    })

    expect(screen.getByText(t('preflight.action.failed'))).toBeDefined()
    expect(within(screen.getByRole('status')).getByTestId('icon-warning')).toBeDefined()
  })

  it('does not report fetch unavailable when fetch row is enabled even without settings form', () => {
    const { form: webConfigForm } = mockConfigForm()
    const webConnections = createWebConnectionsService()
    const subject = {
      kind: 'bundle' as const,
      pkg: {
        name: PROFILE_PACKAGE,
        installed: true,
        availability: 'installation' as const,
        official: false,
        enabled: true,
        rows: [
          { rowId: FETCH.rowId, moduleName: 'dsh-web-fetch-enhanced', enabled: true },
          { rowId: SEARCH.rowId, moduleName: 'dsh-web-search-enhanced', enabled: true },
        ],
      },
    }

    render(
      <ProfileDetailSection
        subject={subject}
        webConfigForm={webConfigForm}
        nativeSearchServed={false}
        webConnections={webConnections}
        t={t}
      />,
    )

    expect(screen.queryByText(t('disabled.fetch', { rowId: FETCH.rowId }))).toBeNull()
  })

  it('reports fetch unavailable when fetch row is enabled=false in bundle rows', () => {
    const { form: webConfigForm } = mockConfigForm()
    const webConnections = createWebConnectionsService()
    const subject = {
      kind: 'bundle' as const,
      pkg: {
        name: PROFILE_PACKAGE,
        installed: true,
        availability: 'installation' as const,
        official: false,
        enabled: true,
        rows: [
          { rowId: FETCH.rowId, moduleName: 'dsh-web-fetch-enhanced', enabled: false },
          { rowId: SEARCH.rowId, moduleName: 'dsh-web-search-enhanced', enabled: true },
        ],
      },
    }

    render(
      <ProfileDetailSection
        subject={subject}
        webConfigForm={webConfigForm}
        nativeSearchServed={false}
        webConnections={webConnections}
        t={t}
      />,
    )

    expect(screen.getByText(t('disabled.fetch', { rowId: FETCH.rowId }))).toBeDefined()
    // A switched-off row is never "served by this plugin", whatever the web row says.
    expect(screen.getByText(t('overview.status.rowDisabled'))).toBeDefined()
    expect(screen.getAllByText(t('overview.status.routed'))).toHaveLength(1)
  })
})
