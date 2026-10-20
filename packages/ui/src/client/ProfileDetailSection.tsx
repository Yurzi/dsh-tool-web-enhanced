import { useState } from 'react'
import {
  Button,
  IconCheckOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
  StateDot,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginDetailProps, PluginsSubject } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { FETCH, PROFILE_PACKAGE, SEARCH, WEB_FIELD, isRouted, type Route } from 'dsh-tool-web-enhanced-core/shared'
import { useObservable, type CapabilityName, type WebConnectionsService } from 'dsh-tool-web-enhanced-core/client'
import { isCapabilityRowDisabled, routeFor } from './disabled.ts'
import type { NS } from './locales.ts'
import { buildUnsetOps, checkUpgradePreflight } from './preflight.ts'
import css from './ProfileDetailSection.module.css'

export type Translate = TranslateNS<typeof NS>

export interface ProfileDetailSectionProps extends PluginDetailProps, PropsLocale<typeof NS> {
  readonly webConfigForm: ConfigForm<Record<string, unknown>>
  readonly nativeSearchServed: boolean
  readonly webConnections: WebConnectionsService
}

export function ProfileDetailSection({
  subject,
  webConfigForm,
  nativeSearchServed,
  webConnections,
  t,
}: ProfileDetailSectionProps) {
  if (subject.kind !== 'bundle' || subject.pkg.name !== PROFILE_PACKAGE) {
    return null
  }

  return (
    <ProfileDetailSectionInner
      subject={subject}
      webConfigForm={webConfigForm}
      nativeSearchServed={nativeSearchServed}
      webConnections={webConnections}
      t={t}
    />
  )
}

function ProfileDetailSectionInner({
  subject,
  webConfigForm,
  nativeSearchServed,
  webConnections,
  t,
}: {
  readonly subject: Extract<PluginsSubject, { kind: 'bundle' }>
  readonly webConfigForm: ConfigForm<Record<string, unknown>>
  readonly nativeSearchServed: boolean
  readonly webConnections: WebConnectionsService
  readonly t: Translate
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null)

  const webSnapshot = useObservable(webConfigForm)
  const routes = useObservable(webConnections.routes)

  const preflight = checkUpgradePreflight({
    user: webSnapshot.user,
    nativeSearchServed,
  })

  const healthy = preflight.issues.length === 0
  const canFix = preflight.fieldsToUnset.length > 0
  const lastFixableIssue = preflight.issues.findLast(issue => issue.kind !== 'native-search-conflict')

  const onConfirmReset = async (): Promise<void> => {
    if (preflight.fieldsToUnset.length === 0) return
    setMutating(true)
    try {
      const ops = buildUnsetOps(preflight.fieldsToUnset)
      const ok = await webConfigForm.mutate(ops, webSnapshot.revision)
      setToast({
        text: t(ok ? 'preflight.action.success' : 'preflight.action.failed'),
        ok,
      })
    } finally {
      setMutating(false)
      setConfirmOpen(false)
    }
  }

  return (
    <section className={css.section} aria-label={t('overview.title')}>
      <div className={css.header}>
        <h3 className={css.title}>{t('overview.title')}</h3>
        <p className={css.description}>{t('overview.description')}</p>
      </div>

      <div className={css.container}>
        <CapabilityCard
          title={t('overview.search.title')}
          capability="search"
          providerId={SEARCH.providerId}
          rowDisabled={isCapabilityRowDisabled({ rowId: SEARCH.rowId, rows: subject.pkg.rows })}
          webSnapshot={webSnapshot}
          routes={routes}
          t={t}
        />
        <CapabilityCard
          title={t('overview.fetch.title')}
          capability="fetch"
          providerId={FETCH.providerId}
          rowDisabled={isCapabilityRowDisabled({ rowId: FETCH.rowId, rows: subject.pkg.rows })}
          webSnapshot={webSnapshot}
          routes={routes}
          t={t}
        />

        {/* Upgrade Preflight Row */}
        <div className={css.preflightBox}>
          <div className={css.preflightHeader}>
            <span className={css.preflightTitle}>{t('preflight.title')}</span>
          </div>

          {healthy ? (
            <div className={css.healthyText}>{t('preflight.healthy')}</div>
          ) : (
            <div className={css.issuesList}>
              {preflight.issues.map((issue, idx) => (
                <div key={idx} className={css.issueItem}>
                  <IconWarningOutlineRegular className={css.issueIcon} size={16} />
                  <div>
                    <span>
                      {issue.kind === 'user-override' &&
                        t('preflight.userOverride', {
                          tool: t(issue.field === 'searchProvider' ? 'overview.search.title' : 'overview.fetch.title'),
                          value: issue.value,
                        })}
                      {issue.kind === 'legacy-remnant' &&
                        t('preflight.legacyRemnant', {
                          tool: t(issue.field === 'searchProvider' ? 'overview.search.title' : 'overview.fetch.title'),
                          action:
                            issue.field === 'searchProvider'
                              ? t('preflight.action.searchAction')
                              : t('preflight.action.fetchAction'),
                        })}
                      {issue.kind === 'native-search-conflict' &&
                        t('preflight.nativeSearchConflict')}
                    </span>
                    {canFix && issue === lastFixableIssue && (
                      <div className={css.fixableActionRow}>
                        <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
                          {t('preflight.action.fix')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}


            </div>
          )}
        </div>
      </div>

      {confirmOpen && (
        <Modal
          open
          title={t('preflight.confirm.title')}
          closeLabel={t('preflight.confirm.close')}
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                {t('preflight.confirm.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={mutating}
                onClick={() => void onConfirmReset()}
              >
                {t('preflight.confirm.confirm')}
              </Button>
            </>
          }
        >
          <p>{t('preflight.confirm.body', { fields: preflight.fieldsToUnset.join(', ') })}</p>
        </Modal>
      )}

      {toast !== null && (
        <Toast
          text={toast.text}
          icon={toast.ok ? <IconCheckOutlineRegular /> : <IconWarningOutlineRegular />}
          holdMs={3000}
          onDone={() => setToast(null)}
        />
      )}
    </section>
  )
}

function RouteBadge({ capability, route, rowDisabled, t }: {
  readonly capability: 'search' | 'fetch'
  readonly route: Route
  readonly rowDisabled: boolean
  readonly t: Translate
}) {
  const routed = isRouted(route)
  const routedKey = capability === 'search' ? 'overview.status.routed' : 'overview.status.routedFetch'
  const notRoutedKey = capability === 'search' ? 'overview.status.notRouted' : 'overview.status.notRoutedFetch'
  const key = rowDisabled ? 'overview.status.rowDisabled' : routed ? routedKey : notRoutedKey
  const healthy = routed && !rowDisabled
  return (
    <span className={healthy ? css.routedBadge : css.notRoutedBadge}>
      <StateDot state={healthy ? 'done' : 'warning'} />
      {t(key)}
    </span>
  )
}

function renderProviderLine(labelTemplate: string, provider: string, noneText: string) {
  const parts = labelTemplate.split('{provider}')
  if (parts.length === 1) return <span>{labelTemplate}</span>
  return (
    <span>
      {parts[0]}
      {provider === noneText ? provider : <code>{provider}</code>}
      {parts[1]}
    </span>
  )
}

function CapabilityCard({
  title,
  capability,
  providerId,
  rowDisabled,
  webSnapshot,
  routes,
  t,
}: {
  readonly title: string
  readonly capability: CapabilityName
  readonly providerId: string
  readonly rowDisabled: boolean
  readonly webSnapshot: ConfigFormSnapshot<Record<string, unknown>>
  readonly routes: ReadonlyMap<CapabilityName, Route>
  readonly t: Translate
}) {
  const field = WEB_FIELD[capability]
  const webBase = (typeof webSnapshot.base === 'object' && webSnapshot.base !== null ? webSnapshot.base : {}) as Record<string, unknown>
  const webUser = (typeof webSnapshot.user === 'object' && webSnapshot.user !== null ? webSnapshot.user : {}) as Record<string, unknown>
  const currentRoute = routeFor(capability, routes, webSnapshot.value)

  const noneText = t('overview.status.none')

  const effectiveProvider = currentRoute.kind === 'this' ? providerId : currentRoute.kind === 'other' ? currentRoute.provider : noneText
  const baseProvider = typeof webBase[field] === 'string' ? webBase[field] : noneText
  const userProvider = typeof webUser[field] === 'string' ? webUser[field] : noneText

  return (
    <div className={css.card}>
      <div className={css.cardHeader}>
        <span className={css.cardTitle}>{title}</span>
        <RouteBadge
          capability={capability}
          route={currentRoute}
          rowDisabled={rowDisabled}
          t={t}
        />
      </div>

      <div className={css.statusList}>
        <div className={css.statusItem}>
          {renderProviderLine(t('overview.status.effective'), effectiveProvider, noneText)}
        </div>
        <div className={css.statusItem}>
          {renderProviderLine(t('overview.status.base'), baseProvider, noneText)}
        </div>
        <div className={css.statusItem}>
          {renderProviderLine(t('overview.status.user'), userProvider, noneText)}
        </div>
      </div>

      {rowDisabled && (
        <div className={css.warnBox}>
          <IconWarningOutlineRegular size={14} className={css.warnIcon} />
          <span>{t(field === 'searchProvider' ? 'disabled.search' : 'disabled.fetch')}</span>
        </div>
      )}
    </div>
  )
}
