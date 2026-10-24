import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SEARCH, PROFILE_PACKAGE, WEB_ROW, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { contract } from '../contract.ts'
import { followHostCommand, remoteServicesOffSource, withRetiredSecretDiagnostics } from 'dsh-tool-web-enhanced-core/client'
import { CATALOG } from '../catalog.ts'
import { resolveSettings } from '../settings/resolve.ts'
import { RETIRED_FIELDS } from '../settings/retired.ts'
import type { SearchSettings } from '../settings/types.ts'
import { searchCommand } from './command.ts'
import { listText } from './connections.ts'
import { CredentialStatus } from './credentials.ts'
import type { SettingsPageInjected } from './injected.ts'
import { en, NS, zh } from './locales.ts'
import { PairingsStatus } from './pairings.ts'
import { SearchRouteStatus, type WebSelection } from './route.ts'
import { searchSection } from './section.ts'
import { SearchSelectionStore } from './selection.ts'
import { SettingsPage } from './settings/SettingsPage.tsx'

// rc.2 exports the public handle but does not augment its carrier service.
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle
  }
}

export const inject = ['connection', 'slots', 'locale', 'configForms', 'remote', 'remote.credentials']

export async function apply(ctx: Context): Promise<void> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'search: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = withRetiredSecretDiagnostics(ctx.configForms.get<SearchSettings>(SEARCH.rowId), ctx.configForms.describe(), SEARCH.rowId, RETIRED_FIELDS,
    fields => t('settings.retiredSecret', { fields: listText(fields, t) }))
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
    }, 'search: settings link')
  })
  const unmount = await ctx.remote.$mount(contract.remoteInfo)
  ctx.effect(() => unmount, 'search: remote')
  ctx.inject(['remote.searchConnections'], scope => {
    const remote = scope.remote.searchConnections
    const credentials = new CredentialStatus(() => settings.getSnapshot().value, scope.remote.credentials)
    const route = new SearchRouteStatus(scope.configForms.get<WebSelection>(WEB_ROW))
    scope.effect(() => route.attach(remote), 'search: provider facts')
    const pairings = new PairingsStatus(remote, t)
    const selection = new SearchSelectionStore(remote, () => { pairings.invalidate() })
    const page: SettingsPageInjected = {
      hooks: { settings, credentials: credentials.source, route: route.source, pairings: pairings.source },
      readSettings: () => settings.getSnapshot(),
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
    scope.effect(() => scope.configForms.whileServed([SEARCH.rowId], () => scope.slots.inject('plugins.row.config', () => scope.slots.register({
      name: 'plugins.row.config', key: rowConfigKey(SEARCH), locale: NS, inject: () => page,
    }, SettingsPage))), 'search: settings page')
    const section = searchSection(selection, navigation, remoteServicesOffSource(settings, CATALOG, resolveSettings), t)
    scope.inject(['webConnections'], ui => {
      ui.effect(() => ui.webConnections.registerRoute('search', route), 'search: route facts')
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
      }, 'search: composer section')
    })
    scope.inject(['commandUi'], command => {
      command.effect(() => command.commandUi.decorate(searchCommand(selection, t)), 'search: /setup-search')
      followHostCommand(command, SEARCH.command, sessionId => {
        selection.invalidateSession(sessionId)
        pairings.invalidate()
      })
    })
    const invalidate = () => {
      selection.invalidate()
      credentials.refresh()
      pairings.invalidate()
      route.refresh()
    }
    scope.effect(() => settings.subscribe(invalidate), 'search: row settings')
    scope.effect(() => scope.remote.$on('settings/document-updated', invalidate), 'search: settings updates')
    scope.effect(() => scope.remote.$on('credentials/reference-updated', invalidate), 'search: credential updates')
    scope.inject(['connection'], connected => {
      connected.effect(() => connected.connection.generation.subscribe(invalidate), 'search: connection updates')
    })
  })
}
