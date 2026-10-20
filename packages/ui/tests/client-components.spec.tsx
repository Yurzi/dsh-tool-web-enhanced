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

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  return {
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
    ...(status !== 'ready' ? { detail: 'Missing API key' } : {}),
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

  /** Which sides of the button carry a needs-attention mark. */
  const markedSides = (button: HTMLElement) =>
    [...button.querySelectorAll('[data-state="warning"]')].map(mark => mark.closest('[data-capability]')?.getAttribute('data-capability'))

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

  it('keeps each side mark outside its label so a narrow composer can hide the labels and keep the marks', () => {
    const webConnections = createWebConnectionsService()
    webConnections.register(createMockSection({ capability: 'search', order: 10, readFailure: 'failed' }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, readFailure: 'failed' }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)

    for (const side of trigger().querySelectorAll('[data-capability]')) {
      const label = side.querySelector('.' + menuCss.sideLabel)!
      const mark = side.querySelector('.' + menuCss.sideMark)!
      expect(label).not.toBeNull()
      expect(mark).not.toBeNull()
      expect(label.contains(mark)).toBe(false)
    }
    const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
    // jsdom parses @container rules but does not expose CSSContainerRule as a global.
    const container = (width: string) => rules.find(rule => rule.cssText.startsWith('@container') && rule.cssText.includes(width)) as CSSGroupingRule
    const hidden = (rule: CSSGroupingRule) => [...rule.cssRules]
      .filter(inner => inner instanceof CSSStyleRule && inner.style.getPropertyValue('display') === 'none')
      .flatMap(inner => (inner as CSSStyleRule).selectorText.split(',').map(selector => selector.trim()))
    for (const width of ['460px', '380px']) {
      expect(hidden(container(width))).not.toContain('.' + menuCss.sideMark)
    }
    expect(hidden(container('460px'))).toEqual(expect.arrayContaining(['.' + menuCss.sideLabel, '.' + menuCss.sideSeparator]))
  })

  it('opens menu on click and displays both sections in order, triggering selection load', () => {
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
    fireEvent.click(button)

    expect(screen.getByRole('menu')).toBeDefined()
    expect(screen.getByText(/^Web Search\b/)).toBeDefined()
    expect(screen.getByText(/^Web Fetch\b/)).toBeDefined()

    expect(loadMock).toHaveBeenCalledWith('sess-1', 'deepseek-official/deepseek-chat')
  })

  it('keeps both section headers available and expands only the first list by default', () => {
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

    const search = screen.getByRole('button', { name: 'Web Search · Search connection · Chosen for this conversation' })
    const fetch = screen.getByRole('button', { name: 'Web Fetch · Fetch connection · Chosen for this conversation' })
    expect(search.getAttribute('aria-expanded')).toBe('true')
    expect(fetch.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('menuitemradio', { name: /Search connection/ })).toBeDefined()
    expect(screen.queryByRole('menuitemradio', { name: /Fetch connection/ })).toBeNull()
    expect(document.getElementById(fetch.getAttribute('aria-controls')!)?.hidden).toBe(true)

    fireEvent.click(fetch)
    expect(fetch.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: /Fetch connection/ })).toBeDefined()
  })

  it('keeps at most one section open, collapses the open one on its own heading, and reopens on the first', () => {
    const webConnections = createWebConnectionsService()
    for (const [capability, order] of [['search', 10], ['fetch', 20]] as const) {
      webConnections.register(createMockSection({ capability, order }).section)
    }
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    const button = trigger()
    fireEvent.click(button)
    const search = screen.getByRole('button', { name: /^Web Search ·/ })
    const fetch = screen.getByRole('button', { name: /^Web Fetch ·/ })

    fireEvent.click(fetch)
    expect(fetch.getAttribute('aria-expanded')).toBe('true')
    expect(search.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(search.getAttribute('aria-controls')!)?.hidden).toBe(true)

    fireEvent.click(fetch)
    expect(fetch.getAttribute('aria-expanded')).toBe('false')
    expect(search.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(search)
    fireEvent.click(fetch)
    expect(search.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: /^Web Search ·/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /^Web Fetch ·/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('scrolls the selected row of a section into view when it opens', () => {
    const webConnections = createWebConnectionsService()
    const connections = ['A', 'B', 'C', 'D'].map(name => mockConnection('conn-' + name, 'Connection ' + name))
    webConnections.register(createMockSection({ capability: 'search', order: 10, selectedId: 'conn-B', connections }).section)
    webConnections.register(createMockSection({ capability: 'fetch', order: 20, selectedId: 'conn-D', connections }).section)
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    fireEvent.click(trigger())

    const searchGroup = screen.getByRole('group', { name: 'Web Search' })
    expect(scrolled).toEqual([{ element: within(searchGroup).getByRole('menuitemradio', { name: /Connection B/ }), options: { block: 'nearest' } }])

    scrolled = []
    fireEvent.click(screen.getByRole('button', { name: /^Web Fetch ·/ }))
    const fetchGroup = screen.getByRole('group', { name: 'Web Fetch' })
    const selected = within(fetchGroup).getByRole('menuitemradio', { name: /Connection D/ })
    expect(selected.getAttribute('aria-checked')).toBe('true')
    expect(scrolled).toEqual([{ element: selected, options: { block: 'nearest' } }])
  })

  it('exposes keyboard-focusable disclosure buttons and opens them with arrow keys', () => {
    const webConnections = createWebConnectionsService()
    for (const [capability, order] of [['search', 10], ['fetch', 20]] as const) {
      webConnections.register(createMockSection({ capability, order }).section)
    }
    render(<ComposerConnectionMenu sessionId="sess-1" webConnections={webConnections} searchServed fetchServed t={t} />)
    fireEvent.click(trigger())
    const fetch = screen.getByRole('button', { name: /^Web Fetch ·/ })
    expect(fetch.tagName).toBe('BUTTON') // Native Enter/Space activation, no simulated button roles.
    fetch.focus()
    expect(document.activeElement).toBe(fetch)
    const search = screen.getByRole('button', { name: /^Web Search ·/ })
    fireEvent.keyDown(fetch, { key: 'ArrowRight' })
    expect(fetch.getAttribute('aria-expanded')).toBe('true')
    expect(search.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(search, { key: 'ArrowLeft' })
    expect(fetch.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(fetch, { key: 'ArrowLeft' })
    expect(fetch.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(fetch, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger())
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
    const menu = screen.getByRole('menu')
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
    expect(within(screen.getByRole('menu')).getAllByText(t('button.loading'))).toHaveLength(2)
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
    fireEvent.click(screen.getByRole('button', { name: /^Web Fetch ·/ }))
    const group = screen.getByRole('group', { name: 'Web Fetch' })
    expect(within(group).getByRole('button', { name: 'Web Fetch · 设置无效' })).toBeDefined()
    expect(within(group).getByText(t('menu.invalidSettings', { capability: 'Web Fetch' }))).toBeDefined()
    expect(within(group).queryByRole('button', { name: t('button.readFailed') })).toBeNull()
    expect(within(group).queryByRole('menuitemradio')).toBeNull()
    loadMock.mockClear()
    fireEvent.click(within(group).getByRole('menuitem', { name: t('menu.settings') }))
    expect(openSettings).toHaveBeenCalledOnce()
    expect(loadMock).not.toHaveBeenCalled()
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
          expect(screen.getByRole('group', { name: /^Web Search\b/ })).toBeDefined()
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

    fireEvent.click(screen.getByRole('button', { name: t('activation.later') }))
    expect(onDismiss).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: t('activation.open') }))
    expect(onOpenDetails).toHaveBeenCalled()
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