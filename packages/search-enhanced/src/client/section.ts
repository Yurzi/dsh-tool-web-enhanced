import { createElement, useEffect, useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import { useObservable, type ConnectionSection } from 'dsh-tool-web-enhanced-core/client'
import { FRESHNESS, type Freshness } from '../catalog.ts'
import { describe, freshnessLabel, sourceText, writeFailureText, type Translate } from './connections.ts'
import type { SearchSelectionStore } from './selection.ts'
import css from './Section.module.css'

export function searchSection(selection: SearchSelectionStore, settings: ObservableSnapshot<(() => void) | undefined>, t: Translate): ConnectionSection {
  function Options({ sessionId }: { readonly sessionId: string }) {
    const state = useObservable(selection.source(sessionId))
    const [error, setError] = useState('')
    useEffect(() => { void selection.load(sessionId) }, [sessionId])
    const view = state.view
    if (view === undefined || view.selection.connectionId === null) return null
    const selected = view.connections.find(connection => connection.id === view.selection.connectionId)
    if (selected === undefined) return null
    if (!selected.freshness) return createElement('p', { className: css.caption }, t('selector.freshnessIgnored', { name: describe(selected, t).label }))
    const onChange = async (next: Freshness) => {
      const result = await selection.set(sessionId, { options: { freshness: next } })
      setError(result.ok ? '' : writeFailureText(result.error, t))
    }
    return createElement('div', { className: css.container },
      createElement('div', { className: css.label }, t('selector.freshness')),
      createElement(SegmentedControl<Freshness>, {
        id: `search-freshness-${sessionId}`,
        label: t('selector.freshness'),
        value: view.selection.options.freshness,
        disabled: state.saving,
        options: FRESHNESS.map(mode => ({
          value: mode,
          label: freshnessLabel(mode, t),
        })),
        onChange,
        className: css.segmented,
      }),
      error === '' ? null : createElement('p', { role: 'alert', className: css.error }, error))
  }
  return {
    capability: 'search', order: 10, title: () => t('section.title'), selection, settings, Options,
    describe: connection => describe(connection, t),
    sourceText: view => sourceText(view, t),
    writeFailureText: error => writeFailureText(error, t),
  }
}
