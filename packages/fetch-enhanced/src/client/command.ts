import { IconGlobeOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { selectionCommand, parseSelectionCommandOption } from 'dsh-tool-web-enhanced-core/client'
import { describe, writeFailureText, type Translate } from './connections.ts'
import type { FetchSelectionStore } from './selection.ts'

export const FETCH_COMMAND = 'setup-fetch'
export const parseCommandOption = parseSelectionCommandOption

export function fetchCommand(selections: FetchSelectionStore, t: Translate) {
  return selectionCommand(selections, {
    name: FETCH_COMMAND, icon: IconGlobeOutlineRegular, t,
    keys: { label: 'command.label', description: 'command.description', placeholder: 'command.placeholder',
      empty: 'command.empty', noResults: 'command.noResults', readFailed: 'command.readFailed', current: 'command.current', off: 'selector.offRow' },
    groups: view => [{ group: { name: 'services', label: t('selector.services') }, connections: view.connections }],
    describe: connection => describe(connection, t),
    writeFailureText: error => writeFailureText(error, t),
  })
}
