/**
 * Browser face of dsh-tool-web-enhanced-ui:
 * - webConnections browser service (registry for connection sections)
 * - conversation.input.right: single web connection button and dropdown menu
 * - plugins.bundle.activation: activation guidance modal for the profile bundle
 * - plugins.detail.section: profile bundle overview and upgrade preflight
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PluginDetailProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FETCH, PROFILE_PACKAGE, SEARCH, UI } from 'dsh-tool-web-enhanced-core/shared'
import { useObservable } from 'dsh-tool-web-enhanced-core/client'
import { ActivationPrompt } from './ActivationPrompt.tsx'
import { ComposerConnectionMenu, modelKeyOf } from './ComposerConnectionMenu.tsx'
import { en, NS, zh } from './locales.ts'
import { NATIVE_SEARCH_ROW } from './preflight.ts'
import { ProfileDetailSection } from './ProfileDetailSection.tsx'
import { createSnapshotStore, installWebConnectionsService } from './service.ts'

export const inject = ['slots', 'locale', 'configForms']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'tool-web-enhanced-ui: dictionaries')

  const webConnections = installWebConnectionsService(ctx)
  const webConfigForm = ctx.configForms.get<Record<string, unknown>>('web')

  let searchServed = false
  let fetchServed = false
  let nativeSearchServed = false

  const servedStore = createSnapshotStore({
    searchServed: false,
    fetchServed: false,
    nativeSearchServed: false,
  })

  const syncServed = (): void => {
    servedStore.set({ searchServed, fetchServed, nativeSearchServed })
  }

  // Check whileServed for search and fetch
  ctx.effect(
    () =>
      ctx.configForms.whileServed([SEARCH.rowId], () => {
        searchServed = true
        syncServed()
        return () => {
          searchServed = false
          syncServed()
        }
      }),
    'tool-web-enhanced-ui: whileServed search',
  )

  ctx.effect(
    () =>
      ctx.configForms.whileServed([FETCH.rowId], () => {
        fetchServed = true
        syncServed()
        return () => {
          fetchServed = false
          syncServed()
        }
      }),
    'tool-web-enhanced-ui: whileServed fetch',
  )

  ctx.effect(
    () =>
      ctx.configForms.whileServed([NATIVE_SEARCH_ROW], () => {
        nativeSearchServed = true
        syncServed()
        return () => {
          nativeSearchServed = false
          syncServed()
        }
      }),
    'tool-web-enhanced-ui: whileServed native search',
  )

  // The store holds an object, never the bare callback: `set(fn)` would run `fn` as an updater.
  const openPluginsStore = createSnapshotStore<{ readonly open: (() => void) | undefined }>({ open: undefined })
  ctx.inject(['pluginNavigation'], scope => {
    scope.effect(() => {
      openPluginsStore.set({ open: () => { scope.pluginNavigation.openBundle(PROFILE_PACKAGE) } })
      return () => {
        openPluginsStore.set({ open: undefined })
      }
    }, 'tool-web-enhanced-ui: pluginNavigation')
  })

  // 1. Composer connection button & menu
  function ComposerButtonSlot(
    props: PropsRuntime<'conversation.input.right'> & PropsLocale<typeof NS>,
  ) {
    const served = useObservable(servedStore)
    const webSnapshot = useObservable(webConfigForm)
    const onOpenPlugins = useObservable(openPluginsStore).open
    const modelKey = props.useProjection('modelSelection', modelKeyOf as (val: unknown) => unknown) as string

    return (
      <ComposerConnectionMenu
        sessionId={props.sessionId}
        modelKey={modelKey}
        webConnections={webConnections}
        searchServed={served.searchServed}
        fetchServed={served.fetchServed}
        webConfig={webSnapshot.value}
        onOpenPlugins={onOpenPlugins}
        t={props.t}
      />
    )
  }

  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.right',
        id: UI.rowId,
        order: 20,
        locale: NS,
      },
      ComposerButtonSlot,
    ),
  )

  // 2. Activation prompt
  ctx.slots.inject('plugins.bundle.activation', () =>
    ctx.slots.register(
      {
        name: 'plugins.bundle.activation',
        key: PROFILE_PACKAGE,
        locale: NS,
      },
      ActivationPrompt,
    ),
  )

  // 3. Profile detail overview section
  function DetailSectionSlot(props: PluginDetailProps & PropsLocale<typeof NS>) {
    const served = useObservable(servedStore)

    return (
      <ProfileDetailSection
        subject={props.subject}
        webConfigForm={webConfigForm}
        nativeSearchServed={served.nativeSearchServed}
        webConnections={webConnections}
        t={props.t}
      />
    )
  }

  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register(
      {
        name: 'plugins.detail.section',
        id: 'tool-web-enhanced-ui-overview',
        locale: NS,
      },
      DetailSectionSlot,
    ),
  )
}
