/**
 * The browser-side seam between the two plugins and the ui package
 * (docs/architecture.md section 9.2). The ui package provides the
 * `webConnections` service and renders one composer menu from the registered
 * sections. Each plugin registers its route facts independently of the optional
 * section and supplies the capability-specific selection store, labels, and
 * options component. Kept to what the ui package
 * reads; a plugin's own store may offer more to its command and settings page.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type { ComponentType } from 'react'
import type { Route } from '../shared/route.ts'
import type { ConnectionView, SelectionView } from '../shared/selection.ts'

export type CapabilityName = 'search' | 'fetch'

/** What a view of one Session renders. */
export interface SelectionState<V extends SelectionView = SelectionView> {
  /** Latest Host view; undefined until the first read succeeds. */
  readonly view: V | undefined
  /** Whether a write is crossing the wire. */
  readonly saving: boolean
  /** Whether the last read failed; cleared by the next successful read or write. */
  readonly readFailure: 'invalid-settings' | 'failed' | undefined
}

/** One change to a Session's selection; the store supplies the observed revision. */
export interface SelectionUpdate {
  readonly connectionId?: string | null
  readonly options?: Readonly<Record<string, unknown>>
}

export type WriteResult = { readonly ok: true } | { readonly ok: false; readonly error: RemoteFailure }

/**
 * Per-Session selection state of one capability, shared by every surface that
 * shows or changes it: the composer menu, the `/setup-<cap>` command and the
 * settings page. A write from any surface reaches all of them.
 */
export interface SelectionStore<V extends SelectionView = SelectionView> {
  /** Stable observable of one Session; the renderer caches its hook binding per source. */
  source(sessionId: string): ObservableSnapshot<SelectionState<V>>
  /** Make sure the Session's view is current; `modelKey` identifies the Session model the defaults depend on. */
  load(sessionId: string, modelKey?: string): Promise<void>
  /** Write a change against the revision the views show; a refused write re-reads. */
  set(sessionId: string, update: SelectionUpdate): Promise<WriteResult>
}

/** Whether the `web` row routes the capability to the plugin, kept current while observed. */
export interface RouteStore {
  readonly source: ObservableSnapshot<Route>
}

/** Localized presentation of one connection, supplied by the owning plugin. */
export interface ConnectionText {
  readonly label: string
  /** Short caption under the label: access mode, or why it cannot be chosen. */
  readonly caption?: string
  /** Full reason the connection cannot serve the Session; undefined when ready. */
  readonly reason?: string
}

/** One capability's part of the composer menu. */
export interface ConnectionSection {
  readonly capability: CapabilityName
  /** Position in the menu; lower first. */
  readonly order: number
  /** Localized title of the section. */
  readonly title: () => string
  readonly selection: SelectionStore
  /** Localized text of a connection the Host listed. */
  readonly describe: (connection: ConnectionView) => ConnectionText
  /** Localized text of the selection source shown beside the current connection. */
  readonly sourceText: (view: SelectionView) => string
  /** Localized text of a refused write. */
  readonly writeFailureText: (error: RemoteFailure) => string
  /** Capability-specific Session options (search: freshness); rendered under the connection list. */
  readonly Options?: ComponentType<{ readonly sessionId: string }>
  /** Open the plugin's row settings page; undefined while the Plugins page is unavailable. */
  readonly settings: ObservableSnapshot<(() => void) | undefined>
}

/** The browser service the ui package provides. */
export interface WebConnectionsService {
  /** Register Host-aware routing independently of the optional composer section. */
  registerRoute(capability: CapabilityName, route: RouteStore): () => void
  /** Missing entries have no running plugin to supply environment facts; unknown entries must not be guessed. */
  readonly routes: ObservableSnapshot<ReadonlyMap<CapabilityName, Route>>
  /** Register a section; the returned disposer removes it (run it in the registrant's effect). */
  register(section: ConnectionSection): () => void
  /** Registered sections in `order`. */
  readonly sections: ObservableSnapshot<readonly ConnectionSection[]>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webConnections: WebConnectionsService
  }
}
