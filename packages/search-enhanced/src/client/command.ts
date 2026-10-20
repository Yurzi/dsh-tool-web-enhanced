import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseSelectionCommandOption, selectionCommand, type CommandOptions } from 'dsh-tool-web-enhanced-core/client'
import { FRESHNESS } from '../catalog.ts'
import type { SearchSelectionView } from '../contract.ts'
import { freshnessLabel, pickerGroups, describe, writeFailureText, type Translate } from './connections.ts'
import type { SearchSelectionStore, SelectionUpdate } from './selection.ts'

export const SEARCH_COMMAND = 'setup-search'
const FRESHNESS_PREFIX = 'freshness:'
const parseFreshness = (id: string): SelectionUpdate | undefined => {
  const freshness = FRESHNESS.find(mode => id === FRESHNESS_PREFIX + mode)
  return freshness === undefined ? undefined : { options: { freshness } }
}
export const parseCommandOption = (id: string): SelectionUpdate | undefined => parseSelectionCommandOption(id, parseFreshness)

export function searchCommand(selections: SearchSelectionStore, t: Translate) {
  const options: CommandOptions<SearchSelectionView> = {
    parse: parseFreshness,
    isCurrent: (update, selection) => update.options !== undefined && update.options.freshness === selection.options.freshness,
    choices(view, detail) {
      const selected = view.connections.find(connection => connection.id === view.selection.connectionId)
      if (selected === undefined || !selected.freshness) return []
      const group = { name: 'freshness', label: t('selector.freshness') }
      return FRESHNESS.map(mode => ({ id: FRESHNESS_PREFIX + mode, label: freshnessLabel(mode, t), group,
        ...detail(undefined, mode === view.selection.options.freshness) }))
    },
  }
  return selectionCommand(selections, {
    name: SEARCH_COMMAND, icon: IconGlobeOutlineRegular, t,
    keys: { label: 'command.label', description: 'command.description', placeholder: 'command.placeholder',
      empty: 'command.empty', noResults: 'command.noResults', readFailed: 'command.readFailed', current: 'command.current', off: 'selector.offRow' },
    groups: view => {
      const { services } = pickerGroups(view)
      return [
        { group: { name: 'services', label: t('selector.services') }, connections: services },
      ]
    },
    describe: connection => describe(connection, t),
    writeFailureText: error => writeFailureText(error, t),
    options,
  })
}
