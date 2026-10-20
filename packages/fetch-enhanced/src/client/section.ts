import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConnectionSection, RouteStore } from 'dsh-tool-web-enhanced-core/client'
import { describe, sourceText, writeFailureText, type Translate } from './connections.ts'
import type { FetchSelectionStore } from './selection.ts'

export function fetchSection(selection: FetchSelectionStore, route: RouteStore, settings: ObservableSnapshot<(() => void) | undefined>, t: Translate): ConnectionSection {
  return {
    capability: 'fetch', order: 20, title: () => t('section.title'), selection, route, settings,
    describe: connection => describe(connection, t),
    sourceText: view => sourceText(view, t),
    writeFailureText: error => writeFailureText(error, t),
  }
}
