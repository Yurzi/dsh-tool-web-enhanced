import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { useCallback, useSyncExternalStore } from 'react'

/**
 * Read an observable snapshot in a component. The subscribe and getSnapshot
 * callbacks are stable per source, so React subscribes once per source rather
 * than once per render; a source that publishes on subscription would
 * otherwise re-render and re-subscribe without end.
 */
export function useObservable<T>(source: ObservableSnapshot<T>): T {
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source])
  const getSnapshot = useCallback(() => source.getSnapshot(), [source])
  return useSyncExternalStore(subscribe, getSnapshot)
}
