import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconGlobeOutlineRegular,
  IconSettingsOutlineRegular,
  IconWarningOutlineRegular,
  MenuSurface,
  StateDot,
  Toast,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { useObservable, type CapabilityName, type ConnectionSection, type SelectionState, type WebConnectionsService } from 'dsh-tool-web-enhanced-core/client'
import { checkDisabledCapabilities, routeFor, type WebConfigSnapshot } from './disabled.ts'
import type { NS } from './locales.ts'
import type { Route } from 'dsh-tool-web-enhanced-core/shared'
import css from './ComposerConnectionMenu.module.css'

function clsx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export type Translate = TranslateNS<typeof NS>

/** What one capability's side of the button and its section heading show. */
type SideState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'read-failed' }
  | { readonly kind: 'invalid-settings' }
  | { readonly kind: 'off' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'connection'; readonly label: string; readonly ready: boolean }

function sideState(section: ConnectionSection, state: SelectionState): SideState {
  if (state.readFailure === 'invalid-settings') return { kind: 'invalid-settings' }
  if (state.readFailure === 'failed') return { kind: 'read-failed' }
  const { view } = state
  if (view === undefined) return { kind: 'loading' }
  const { connectionId } = view.selection
  if (connectionId === null) return { kind: 'off' }
  const selected = view.connections.find(connection => connection.id === connectionId)
  if (selected === undefined) return { kind: 'missing' }
  return { kind: 'connection', label: section.describe(selected).label, ready: selected.status === 'ready' }
}

function sideText(side: SideState, t: Translate): string {
  switch (side.kind) {
    case 'loading': return t('button.loading')
    case 'read-failed': return t('button.readFailed')
    case 'invalid-settings': return t('button.invalidSettings')
    case 'off': return t('button.off')
    case 'missing': return t('button.missing')
    case 'connection': return side.label
  }
}

/** Whether the side needs the user: it cannot serve as shown, or the web row sends the capability elsewhere. */
function needsAttention(side: SideState, route: Route): boolean {
  if (route.kind === 'other') return true
  switch (side.kind) {
    case 'loading':
    case 'off': return false
    case 'read-failed':
    case 'invalid-settings':
    case 'missing': return true
    case 'connection': return !side.ready
  }
}

/** One snapshot of several sources; the array stays the same while none of them changes. */
function combineSnapshots<T>(sources: readonly ObservableSnapshot<T>[]): ObservableSnapshot<readonly T[]> {
  let last: readonly T[] = []
  return {
    getSnapshot() {
      const next = sources.map(source => source.getSnapshot())
      if (next.length !== last.length || next.some((value, index) => value !== last[index])) last = next
      return last
    },
    subscribe(listener) {
      const unsubscribes = sources.map(source => source.subscribe(listener))
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
  }
}

export interface ModelSelectionProjection {
  readonly next?: { readonly provider: string; readonly model: string } | undefined
}

export function modelKeyOf(projection: ModelSelectionProjection | undefined): string {
  const model = projection?.next
  return model ? `${model.provider}/${model.model}` : ''
}

function useMenuPosition({
  open,
  anchorRef,
  panelRef,
  rootRef,
}: {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  panelRef: React.RefObject<HTMLElement | null>
  rootRef: React.RefObject<HTMLElement | null>
}): { left: number; top: number; maxWidth: number } | null {
  const [rawPosition, setRawPosition] = useState<{ left: number; top: number; maxWidth: number } | null>(null)

  useEffect(() => {
    if (!open) return

    const place = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const panel = panelRef.current
      const measuredWidth = panel?.offsetWidth ?? 0
      const height = panel?.offsetHeight ?? 0

      // Main content area left boundary (e.g. conversation session container)
      const mainArea =
        rootRef.current?.closest('[data-conversation-session]') ??
        document.querySelector('[data-conversation-session]') ??
        document.querySelector('main')
      const mainLeft = mainArea ? mainArea.getBoundingClientRect().left : 12
      const minLeft = Math.min(Math.max(12, mainLeft), window.innerWidth - 12)
      const maxWidth = Math.max(0, window.innerWidth - minLeft - 12)
      const width = Math.min(measuredWidth, maxWidth)

      let left = rect.right - width
      // If overflowing left boundary, check if flipping to start fits better
      if (left < minLeft && rect.left + width <= window.innerWidth - 12) {
        left = rect.left
      }
      if (width > 0) {
        const maxLeft = Math.max(minLeft, window.innerWidth - width - 12)
        left = Math.min(Math.max(left, minLeft), maxLeft)
      }

      // Vertical placement: side='top', gap=8
      let top = rect.top - 8 - height
      if (top < 12 && rect.bottom + 8 + height <= window.innerHeight - 12) {
        top = rect.bottom + 8
      }
      if (height > 0) {
        top = Math.min(Math.max(top, 12), Math.max(12, window.innerHeight - height - 12))
      }

      setRawPosition({ left, top, maxWidth })
    }

    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && panelRef.current) {
      observer = new ResizeObserver(place)
      observer.observe(panelRef.current)
    }

    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, panelRef, rootRef])

  return open ? rawPosition : null
}

export interface ComposerConnectionMenuProps {
  readonly sessionId: string
  readonly modelKey?: string | undefined
  readonly webConnections: WebConnectionsService
  readonly searchServed: boolean
  readonly fetchServed: boolean
  readonly webConfig?: WebConfigSnapshot | undefined
  readonly onOpenPlugins?: (() => void) | undefined
  readonly t: Translate
}

export function ComposerConnectionMenu({
  sessionId,
  modelKey,
  webConnections,
  searchServed,
  fetchServed,
  webConfig,
  onOpenPlugins,
  t,
}: ComposerConnectionMenuProps) {
  const sections = useObservable(webConnections.sections)
  const routes = useObservable(webConnections.routes)

  if (sections.length === 0) {
    return null
  }

  return (
    <ComposerConnectionMenuInner
      sessionId={sessionId}
      modelKey={modelKey}
      sections={sections}
      routes={routes}
      searchServed={searchServed}
      fetchServed={fetchServed}
      webConfig={webConfig}
      onOpenPlugins={onOpenPlugins}
      t={t}
    />
  )
}

function ComposerConnectionMenuInner({
  sessionId,
  modelKey,
  sections,
  routes,
  searchServed,
  fetchServed,
  webConfig,
  onOpenPlugins,
  t,
}: {
  readonly sessionId: string
  readonly modelKey?: string | undefined
  readonly sections: readonly ConnectionSection[]
  readonly routes: ReadonlyMap<CapabilityName, Route>
  readonly searchServed: boolean
  readonly fetchServed: boolean
  readonly webConfig?: WebConfigSnapshot | undefined
  readonly onOpenPlugins?: (() => void) | undefined
  readonly t: Translate
}) {
  const [open, setOpen] = useState(false)
  // Accordion: at most one section is open, so the open list gets the whole menu height.
  const [expanded, setExpanded] = useState<CapabilityName | null>(null)
  const [notice, setNotice] = useState<{ seq: number; text: string } | null>(null)
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const seqRef = useRef(0)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const id = useId()

  const position = useMenuPosition({
    open,
    anchorRef: triggerRef,
    panelRef: menuRef,
    rootRef,
  })
  useDismissOnOutsidePointer(rootRef, open, setOpen, menuRef)

  const sortedSections = useMemo(() => sections.toSorted((a, b) => a.order - b.order), [sections])
  const states = useObservable(useMemo(
    () => combineSnapshots(sortedSections.map(section => section.selection.source(sessionId))),
    [sortedSections, sessionId],
  ))

  useEffect(() => {
    for (const section of sections) {
      void section.selection.load(sessionId, modelKey)
    }
  }, [sections, sessionId, modelKey])

  const close = (): void => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const onTriggerClick = (): void => {
    if (open) {
      close()
    } else {
      setOpen(true)
      setExpanded(sortedSections[0]!.capability)
      for (const section of sections) {
        void section.selection.load(sessionId, modelKey)
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const choose = async (section: ConnectionSection, connectionId: string | null): Promise<void> => {
    const currentView = section.selection.source(sessionId).getSnapshot().view
    if (currentView?.selection.connectionId === connectionId) {
      close()
      return
    }

    const res = await section.selection.set(sessionId, { connectionId })
    if (!res.ok) {
      setNotice({ seq: seqRef.current++, text: section.writeFailureText(res.error) })
    } else {
      close()
    }
  }

  // Each side shows its connection; other states name their side, since "Off" alone does not say which.
  const sides = sortedSections.map((section, index) => {
    const side = sideState(section, states[index]!)
    const state = sideText(side, t)
    const capability = section.title()
    const attention = needsAttention(side, routeFor(section.capability, routes, webConfig))
    return {
      capability: section.capability,
      label: side.kind === 'connection' ? state : t('button.side', { capability, state }),
      name: t(attention ? 'button.sideAttention' : 'button.side', { capability, state }),
      attention,
    }
  })
  const triggerName = sides.map(side => side.name).join(' · ')
  const saving = states.some(state => state.saving)

  const disabled = checkDisabledCapabilities({
    searchServed,
    fetchServed,
    webConfig,
    routes,
  })

  return (
    <div
      ref={el => {
        rootRef.current = el
        setRootEl(el)
      }}
      className={css.root}
      onKeyDown={onKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerName}
        onClick={onTriggerClick}
      >
        <IconGlobeOutlineRegular className={css.icon} size={16} />
        <span className={css.sides}>
          {sides.map((side, index) => (
            <Fragment key={side.capability}>
              {index > 0 && <span className={css.sideSeparator} aria-hidden="true">·</span>}
              <span className={css.side} data-capability={side.capability}>
                <span className={css.sideLabel}>{side.label}</span>
                {side.attention && <StateDot state="warning" className={css.sideMark} />}
              </span>
            </Fragment>
          ))}
        </span>
        {saving ? (
          <StateDot state="ongoing" className={css.busy} />
        ) : (
          <IconChevronDownOutlineRegular
            size={12}
            className={clsx(css.chevron, open && css.chevronOpen)}
          />
        )}
      </button>

      {open &&
        createPortal(
          <MenuSurface
            ref={menuRef}
            id={`${id}-menu`}
            className={css.menu}
            style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
            role="menu"
            aria-label={t('menu.aria')}
          >
            {sortedSections.map(section => (
              <SectionItem
                key={section.capability}
                section={section}
                route={routeFor(section.capability, routes, webConfig)}
                sessionId={sessionId}
                expanded={expanded === section.capability}
                onExpandedChange={next => {
                  setExpanded(current => next ? section.capability : current === section.capability ? null : current)
                }}
                onChoose={connId => void choose(section, connId)}
                onCloseMenu={close}
                t={t}
              />
            ))}

            {disabled.searchDisabled && (
              <>
                <div className={css.separator} role="separator" />
                <div className={css.disabledNotice} role="status">
                  <IconWarningOutlineRegular size={14} className={css.noticeIcon} />
                  <div>
                    <div>{t('disabled.search')}</div>
                    {onOpenPlugins !== undefined && (
                      <button
                        type="button"
                        className={css.linkAction}
                        onClick={() => {
                          close()
                          onOpenPlugins()
                        }}
                      >
                        {t('disabled.openPlugins')}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {disabled.fetchDisabled && (
              <>
                <div className={css.separator} role="separator" />
                <div className={css.disabledNotice} role="status">
                  <IconWarningOutlineRegular size={14} className={css.noticeIcon} />
                  <div>
                    <div>{t('disabled.fetch')}</div>
                    {onOpenPlugins !== undefined && (
                      <button
                        type="button"
                        className={css.linkAction}
                        onClick={() => {
                          close()
                          onOpenPlugins()
                        }}
                      >
                        {t('disabled.openPlugins')}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </MenuSurface>,
          document.body,
        )}

      {notice !== null && (
        <Toast
          key={notice.seq}
          text={notice.text}
          icon={<IconWarningOutlineRegular />}
          holdMs={4000}
          anchor={rootEl}
          onDone={() => setNotice(null)}
        />
      )}
    </div>
  )
}

function SectionItem({
  section,
  route,
  sessionId,
  expanded,
  onExpandedChange,
  onChoose,
  onCloseMenu,
  t,
}: {
  readonly section: ConnectionSection
  readonly route: Route
  readonly sessionId: string
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly onChoose: (connectionId: string | null) => void
  readonly onCloseMenu: () => void
  readonly t: Translate
}) {
  const id = useId()
  const state = useObservable(section.selection.source(sessionId))
  const settingsFn = useObservable(section.settings)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const view = state.view
  const loaded = view !== undefined

  // Opening a section, or its list arriving while open, brings the chosen row into view.
  useEffect(() => {
    if (!expanded || !loaded) return
    bodyRef.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [expanded, loaded])
  const source = view ? section.sourceText(view) : ''
  const current = sideText(sideState(section, state), t)
  const groupLabel = [section.title(), current, source].filter(Boolean).join(' · ')

  return (
    <div className={clsx(css.sectionBlock, expanded && css.sectionExpanded)} role="group" aria-label={section.title()}>
      <button
        type="button"
        id={id + '-heading'}
        className={css.sectionHeading}
        aria-expanded={expanded}
        aria-controls={id + '-content'}
        title={groupLabel}
        aria-label={groupLabel}
        onClick={() => onExpandedChange(!expanded)}
        onKeyDown={event => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault()
            onExpandedChange(event.key === 'ArrowRight')
          }
        }}
      >
        <span className={css.sectionSummary}>
          <span className={css.sectionTitle}>{section.title()}</span>
          <span aria-hidden="true">·</span>
          <span className={css.sectionCurrent}>{current}</span>
          {source && <><span aria-hidden="true">·</span><span className={css.sectionSource}>{source}</span></>}
        </span>
        <IconChevronDownOutlineRegular size={12} className={clsx(css.chevron, expanded && css.chevronOpen)} />
      </button>
      <div id={id + '-content'} className={css.sectionContents} hidden={!expanded}>
        <div ref={bodyRef} className={css.sectionBody}>
          {route.kind === 'other' && (
            <div className={css.routeNotice} role="alert">
              <IconWarningOutlineRegular size={14} className={css.noticeIcon} />
              <span>{t('menu.routeWarning', { provider: route.provider })}</span>
            </div>
          )}

          {state.readFailure === 'invalid-settings' ? (
            // Retrying cannot help: the settings must be fixed, through the settings entry below.
            <div className={css.routeNotice} role="alert">
              <IconWarningOutlineRegular size={14} className={css.noticeIcon} />
              <span>{t('menu.invalidSettings', { capability: section.title() })}</span>
            </div>
          ) : view === undefined ? (
            state.readFailure === 'failed' ? (
              <button
                type="button"
                className={css.row}
                onClick={() => {
                  void section.selection.load(sessionId)
                }}
              >
                <span className={clsx(css.rowLabel, css.rowCaptionWarn)}>
                  {t('button.readFailed')}
                </span>
              </button>
            ) : (
              <div className={css.empty}>{t('button.loading')}</div>
            )
          ) : (
            <>

              {/* "Off" row */}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={view.selection.connectionId === null}
                className={css.row}
                disabled={state.saving}
                onClick={() => onChoose(null)}
              >
                <span className={css.rowLabel}>{t('menu.offRow')}</span>
                <span className={css.check}>
                  {view.selection.connectionId === null && <IconCheckOutlineRegular size={14} />}
                </span>
              </button>

              {/* Connections list */}
              {view.connections.length > 0 ? (
                view.connections.map(conn => {
                  const text = section.describe(conn)
                  const isSelected = conn.id === view.selection.connectionId
                  const isReady = conn.status === 'ready'
                  const canOpenSettings = !isReady && settingsFn !== undefined

                  const onClick = () => {
                    if (canOpenSettings) {
                      onCloseMenu()
                      settingsFn()
                    } else if (isReady) {
                      onChoose(conn.id)
                    }
                  }

                  return (
                    <button
                      key={conn.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      className={css.row}
                      disabled={isReady ? state.saving : !canOpenSettings}
                      title={text.reason ?? text.label}
                      onClick={onClick}
                    >
                      <div className={css.rowContent}>
                        <span className={css.rowLabel}>{text.label}</span>
                        {text.caption && !text.reason && (
                          <span className={css.rowCaption}>{text.caption}</span>
                        )}
                        {text.reason && (
                          <span className={clsx(css.rowCaption, css.rowCaptionWarn)}>
                            <span className={css.warnDot} aria-hidden="true" />
                            <span>{text.reason}</span>
                          </span>
                        )}
                      </div>
                      <span className={css.check}>
                        {isSelected && <IconCheckOutlineRegular size={14} />}
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className={css.empty}>{t('menu.empty')}</div>
              )}

              {/* Options component */}
              {section.Options && (
                <div className={css.optionsWrapper}>
                  <section.Options sessionId={sessionId} />
                </div>
              )}
            </>
          )}

        </div>

        {/* Settings entry */}
        {settingsFn !== undefined && (
          <div className={css.sectionFooter}>
            <button
              type="button"
              role="menuitem"
              className={css.settingsButton}
              onClick={() => {
                onCloseMenu()
                settingsFn()
              }}
            >
              <IconSettingsOutlineRegular size={14} />
              <span>{t('menu.settings')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
