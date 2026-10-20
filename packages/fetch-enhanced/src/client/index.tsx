import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { FETCH, PROFILE_PACKAGE, WEB_ROW, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { contract } from '../contract.ts'
import type { FetchSettings } from '../settings/types.ts'
import { fetchCommand } from './command.ts'
import { CredentialStatus, PairingsStatus, editableSettings } from 'dsh-tool-web-enhanced-core/client'
import { resolveSettings } from '../settings/resolve.ts'
import { credentialRefs } from './settings/model.ts'
import type { SettingsPageInjected } from './injected.ts'
import { en, NS, zh } from './locales.ts'
import { FetchRouteStatus, type WebSelection } from './route.ts'
import { fetchSection } from './section.ts'
import { FetchSelectionStore } from './selection.ts'
import { SettingsPage } from './settings/SettingsPage.tsx'

// rc.2 exports the public handle but does not augment its carrier service.
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle
  }
}

export const inject = ['connection', 'slots', 'locale', 'configForms', 'remote', 'remote.credentials']

export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fetch: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = ctx.configForms.get<FetchSettings>(FETCH.rowId)
  const navigationState = createSnapshotStore<{ open: (() => void) | undefined }>({ open: undefined })
  const navigation: ObservableSnapshot<(() => void) | undefined> = {
    getSnapshot: () => navigationState.getSnapshot().open,
    subscribe: listener => navigationState.subscribe(listener),
  }
  ctx.inject(['pluginNavigation'], scope => {
    scope.effect(() => {
      // rc.2 exposes openBundle only; do not inspect private navigation state.
      navigationState.set({ open: () => { scope.pluginNavigation.openBundle(PROFILE_PACKAGE) } })
      return () => { navigationState.set({ open: undefined }) }
    }, 'fetch: settings link')
  })
  const unmount = await ctx.remote.$mount(contract.remoteInfo)
  ctx.effect(() => unmount, 'fetch: remote')
  ctx.inject(['remote.fetchConnections'], scope => {
    const remote = scope.remote.fetchConnections
    const credentials = new CredentialStatus(() => {
      const config = settings.getSnapshot().value
      if (config === undefined) return undefined
      const view = editableSettings<FetchSettings>(config, {}, false, resolveSettings)
      return view.kind === 'ready' ? view.config : undefined
    }, scope.remote.credentials, credentialRefs)
    const route = new FetchRouteStatus(scope.configForms.get<WebSelection>(WEB_ROW))
    scope.effect(() => route.attach(remote), 'fetch: provider facts')
    const pairings = new PairingsStatus(remote, () => t('pairings.forgetFailed'))
    const selection = new FetchSelectionStore(remote, () => { pairings.invalidate() })
    const page: SettingsPageInjected = {
      hooks: { settings, credentials: credentials.source, route: route.source, pairings: pairings.source },
      async mutate(ops, revision) {
        return settings.mutate(ops, revision)
      },
      async saveCredential(ref, value) {
        const result = await scope.remote.credentials.set(ref, value)
        if (!result.ok) throw new Error(t('credential.failed'))
      },
      refreshPairings: () => pairings.refresh(),
      async forgetPairing(provider, model) {
        await pairings.forget(provider, model)
        selection.invalidate()
      },
    }
    scope.effect(() => scope.configForms.whileServed([FETCH.rowId], () => scope.slots.inject('plugins.row.config', () => scope.slots.register({
      name: 'plugins.row.config', key: rowConfigKey(FETCH), locale: NS, inject: () => page,
    }, SettingsPage))), 'fetch: settings page')
    const section = fetchSection(selection, navigation, t)
    scope.inject(['webConnections'], ui => {
      ui.effect(() => ui.webConnections.registerRoute('fetch', route), 'fetch: route facts')
      ui.effect(() => {
        let unregister: (() => void) | undefined
        const sync = () => {
          const visible = settings.getSnapshot().value?.showSelector !== false
          if (visible && unregister === undefined) unregister = ui.webConnections.register(section)
          if (!visible && unregister !== undefined) {
            unregister()
            unregister = undefined
          }
        }
        const unsubscribe = settings.subscribe(sync)
        sync()
        return () => {
          unsubscribe()
          if (unregister !== undefined) unregister()
        }
      }, 'fetch: composer section')
    })
    scope.inject(['commandUi'], command => {
      command.effect(() => command.commandUi.register(fetchCommand(selection, t)), 'fetch: /setup-fetch')
    })
    const invalidate = () => {
      selection.invalidate()
      credentials.refresh()
      pairings.invalidate()
      route.refresh()
    }
    scope.effect(() => settings.subscribe(invalidate), 'fetch: row settings')
    scope.effect(() => scope.remote.$on('settings/document-updated', invalidate), 'fetch: settings updates')
    scope.effect(() => scope.remote.$on('credentials/reference-updated', invalidate), 'fetch: credential updates')
    scope.inject(['connection'], connected => {
      connected.effect(() => connected.connection.generation.subscribe(invalidate), 'fetch: connection updates')
    })
  })
}
