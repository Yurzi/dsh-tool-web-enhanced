import { createElement, useEffect, useState, type ChangeEvent } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { useObservable, type ConnectionSection, type RouteStore } from 'dsh-tool-web-enhanced-core/client'
import { FRESHNESS, type Freshness } from '../catalog.ts'
import { describe, freshnessLabel, sourceText, writeFailureText, type Translate } from './connections.ts'
import type { SearchSelectionStore } from './selection.ts'

export function searchSection(selection: SearchSelectionStore, route: RouteStore, settings: ObservableSnapshot<(() => void) | undefined>, t: Translate): ConnectionSection {
  function Options({ sessionId }: { readonly sessionId: string }) {
    const state = useObservable(selection.source(sessionId))
    const [error, setError] = useState('')
    useEffect(() => { void selection.load(sessionId) }, [sessionId])
    const view = state.view
    if (view === undefined || view.selection.connectionId === null) return null
    const selected = view.connections.find(connection => connection.id === view.selection.connectionId)
    if (selected === undefined) return null
    if (!selected.freshness) return createElement('p', null, t('selector.freshnessIgnored', { name: describe(selected, t).label }))
    const onChange = async (event: ChangeEvent<HTMLSelectElement>) => {
      const freshness = event.target.value as Freshness
      const result = await selection.set(sessionId, { options: { freshness } })
      setError(result.ok ? '' : writeFailureText(result.error, t))
    }
    return createElement('div', null,
      createElement('label', null, t('selector.freshness'),
        createElement('select', { value: view.selection.options.freshness, disabled: state.saving, onChange },
          FRESHNESS.map(mode => createElement('option', { key: mode, value: mode }, freshnessLabel(mode, t))))),
      error === '' ? null : createElement('p', { role: 'alert' }, error))
  }
  return {
    capability: 'search', order: 10, title: () => t('section.title'), selection, route, settings, Options,
    describe: connection => describe(connection, t),
    sourceText: view => sourceText(view, t),
    writeFailureText: error => writeFailureText(error, t),
  }
}
