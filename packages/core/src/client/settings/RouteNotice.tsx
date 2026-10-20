import type { Route } from '../../shared/route.ts'
import type { ClientTranslate } from '../command.ts'
import type { SettingsClasses } from './parts.tsx'
export function createRouteNotice<K extends string>({ classes: css, keys, other }: {
  classes: SettingsClasses
  keys: Readonly<Record<'unknown' | 'auto' | 'other', K>>
  other?: (route: Extract<Route, { kind: 'other' }>, t: ClientTranslate<K>) => string | undefined
}) {
  return function RouteNotice({ route, t }: { route: Route; t: ClientTranslate<K> }) {
    let text: string | undefined
    switch (route.kind) {
      case 'this': return null
      case 'unknown': text = t(keys.unknown); break
      case 'auto': text = t(keys.auto, { id: route.providerId }); break
      case 'other': text = other?.(route, t) ?? t(keys.other, { provider: route.provider, id: route.providerId }); break
    }
    return <p className={css.warning} role="status">{text}</p>
  }
}
