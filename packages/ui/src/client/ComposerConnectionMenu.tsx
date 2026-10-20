import {
  useEffect,
  useId,
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
import { useObservable, type ConnectionSection, type WebConnectionsService } from 'dsh-tool-web-enhanced-core/client'
import { checkDisabledCapabilities, type WebConfigSnapshot } from './disabled.ts'
import type { NS } from './locales.ts'
import css from './ComposerConnectionMenu.module.css'

function clsx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export type Translate = TranslateNS<typeof NS>

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

  if (sections.length === 0) {
    return null
  }

  return (
    <ComposerConnectionMenuInner
      sessionId={sessionId}
      modelKey={modelKey}
      sections={sections}
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
  searchServed,
  fetchServed,
  webConfig,
  onOpenPlugins,
  t,
}: {
  readonly sessionId: string
  readonly modelKey?: string | undefined
  readonly sections: readonly ConnectionSection[]
  readonly searchServed: boolean
  readonly fetchServed: boolean
  readonly webConfig?: WebConfigSnapshot | undefined
  readonly onOpenPlugins?: (() => void) | undefined
  readonly t: Translate
}) {
  const [open, setOpen] = useState(false)
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

  // Sections sorted by order, primary section is search if available
  const sortedSections = sections.toSorted((a, b) => a.order - b.order)
  const primarySection =
    sortedSections.find(s => s.capability === 'search') ??
    sortedSections[0]!

  const primaryState = useObservable(primarySection.selection.source(sessionId))

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

  let triggerLabel = t('button.loading')
  let triggerAttention = false

  if (primaryState.readFailed) {
    triggerLabel = t('button.readFailed')
    triggerAttention = true
  } else if (primaryState.view !== undefined) {
    const { connectionId } = primaryState.view.selection
    if (connectionId === null) {
      triggerLabel = t('button.off')
    } else {
      const conn = primaryState.view.connections.find(c => c.id === connectionId)
      if (conn !== undefined) {
        const text = primarySection.describe(conn)
        triggerLabel = text.label
        if (conn.status !== 'ready') {
          triggerAttention = true
        }
      } else {
        triggerLabel = t('button.missing')
        triggerAttention = true
      }
    }
  }

  const disabled = checkDisabledCapabilities({
    searchServed,
    fetchServed,
    webConfig,
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
        aria-label={t('button.aria')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={t('button.title')}
        onClick={onTriggerClick}
      >
        <IconGlobeOutlineRegular className={css.icon} size={16} />
        <span className={css.label}>{triggerLabel}</span>
        {triggerAttention ? <StateDot state="warning" className={css.attention} /> : null}
        {primaryState.saving ? (
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
            {sortedSections.map((section, idx) => (
              <SectionItem
                key={section.capability}
                section={section}
                sessionId={sessionId}
                initiallyExpanded={idx === 0}
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
  sessionId,
  initiallyExpanded,
  onChoose,
  onCloseMenu,
  t,
}: {
  readonly section: ConnectionSection
  readonly sessionId: string
  readonly initiallyExpanded: boolean
  readonly onChoose: (connectionId: string | null) => void
  readonly onCloseMenu: () => void
  readonly t: Translate
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const id = useId()
  const state = useObservable(section.selection.source(sessionId))
  const route = useObservable(section.route.source)
  const settingsFn = useObservable(section.settings)

  const view = state.view
  const source = view ? section.sourceText(view) : ''
  let current = t('button.loading')
  if (state.readFailed) {
    current = t('button.readFailed')
  } else if (view !== undefined) {
    const selected = view.connections.find(connection => connection.id === view.selection.connectionId)
    current = view.selection.connectionId === null ? t('button.off')
      : selected ? section.describe(selected).label : t('button.missing')
  }
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
        onClick={() => setExpanded(!expanded)}
        onKeyDown={event => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault()
            setExpanded(event.key === 'ArrowRight')
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
        <div className={css.sectionBody}>
          {route.kind === 'other' && (
            <div className={css.routeNotice} role="alert">
              <IconWarningOutlineRegular size={14} className={css.noticeIcon} />
              <span>{t('menu.routeWarning', { provider: route.provider })}</span>
            </div>
          )}

          {view === undefined ? (
            state.readFailed ? (
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
