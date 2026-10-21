/**
 * The per-Session selection vocabulary and the `<ns>/get` · `<ns>/set` ·
 * `<ns>/provider` · `<ns>/pairings` · `<ns>/forgetPairing` Remote contract
 * both capabilities expose. A capability instantiates the zod fragments with
 * its own session options schema and connection extras; Host service and
 * browser store then parse the same shapes.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import { z } from 'zod'
import type { Access, BackendKind } from './connections.ts'

/** What a Session chose: a connection, or `null` for off; revision 0 means it never chose. */
export interface Selection<O> {
  readonly connectionId: string | null
  readonly revision: number
  readonly options: O
}

/** Where the Session's current connection comes from; the UI explains it. */
export const SELECTION_SOURCES = ['session', 'inherited', 'model', 'default'] as const
export type SelectionSource = typeof SELECTION_SOURCES[number]

/** Model memory: the connection last chosen in a Session of this model; `null` remembers "off". */
export interface Pairing {
  readonly provider: string
  readonly model: string
  readonly connectionId: string | null
}

/**
 * Whether a connection can serve this Session, judged from local facts only:
 * `ready` never proves upstream access, quota or health.
 */
export const CONNECTION_STATUS = ['ready', 'disabled', 'needs-credential', 'unsupported'] as const
export type ConnectionStatus = typeof CONNECTION_STATUS[number]

/**
 * Why a connection that follows the Session model cannot serve its current
 * route: no model yet, a provider without a public route, an undeclared or
 * unsupported protocol, no usable endpoint, custom request headers, or no
 * single credential reference. The browser words each reason.
 */
export const UNSUPPORTED_REASONS = ['no-model', 'unknown-route', 'protocol', 'endpoint', 'headers', 'credential'] as const
export type UnsupportedReason = typeof UNSUPPORTED_REASONS[number]

const KINDS = ['native', 'adapter', 'model', 'local'] as const satisfies readonly BackendKind[]
const ACCESS = ['keyless', 'api-key', 'account'] as const satisfies readonly Access[]

export const sessionId = z.string().min(1).max(256)
export const connectionId = z.string().min(1).max(128)

/** Fields every connection view carries; a capability adds its own with `extras`. */
export const connectionViewBase = z.object({
  id: connectionId,
  label: z.string(),
  kind: z.enum(KINDS),
  /** Whether the query or URL is sent to a third-party service. */
  remote: z.boolean(),
  /** How the next call would authenticate. */
  access: z.enum(ACCESS),
  status: z.enum(CONNECTION_STATUS),
  /** Present exactly when `status` is `unsupported`. */
  reason: z.enum(UNSUPPORTED_REASONS).optional(),
})

export const selectionRequest = z.object({ sessionId }).strict()
export const providerRequest = z.object({}).strict()
export const pairingsRequest = z.object({}).strict()
export const forgetPairingRequest = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()

export const pairingView = z.object({ provider: z.string(), model: z.string(), connectionId: z.string().nullable() }).strict()
export const pairingsView = z.object({ pairings: z.array(pairingView) }).strict()

/**
 * The two facts the browser cannot see when it judges the route from
 * `configForms.get('web')`: the id this plugin registered and the process
 * variable `WebRuntime` falls back to.
 */
export const providerView = z.object({
  providerId: z.string(),
  envProvider: z.string().nullable(),
}).strict()

export type SelectionRequest = z.infer<typeof selectionRequest>
export type ProviderRequest = z.infer<typeof providerRequest>
export type ProviderView = z.infer<typeof providerView>
export type PairingsRequest = z.infer<typeof pairingsRequest>
export type ForgetPairingRequest = z.infer<typeof forgetPairingRequest>
export type PairingsView = z.infer<typeof pairingsView>

/** What a capability hands the contract factory. */
export interface SelectionContractSpec<O extends z.ZodRawShape, E extends z.ZodRawShape> {
  /** Remote namespace, e.g. `searchConnections`. */
  readonly namespace: string
  /** npm name of the plugin, recorded in the generated Remote info. */
  readonly packageName: string
  /** Session options shape (search: `{ freshness }`; fetch: `{}`); a change may carry any subset of it. */
  readonly options: O
  /** Capability-specific connection view fields (search: `{ freshness: z.boolean() }`). */
  readonly extras: E
}

/**
 * Build the zod fragments and the mountable Remote info of one capability.
 * Request and result schemas are strict at both ends.
 */
export function selectionContract<O extends z.ZodRawShape, E extends z.ZodRawShape>(spec: SelectionContractSpec<O, E>) {
  const { namespace, packageName } = spec
  const options = z.strictObject(spec.options)
  const optionsChange = options.partial()
  const connectionView = connectionViewBase.extend(spec.extras).strict()
  const selection = z.object({ connectionId: z.string().nullable(), revision: z.number().int().nonnegative(), options }).strict()
  const selectionView = z.object({
    selection,
    source: z.enum(SELECTION_SOURCES),
    connections: z.array(connectionView),
  }).strict()
  const selectionChange = z.object({
    sessionId,
    /** A connection id, or null to turn the capability off for the Session. */
    connectionId: connectionId.nullable().optional(),
    /** Session options to change; omitted fields keep their value. */
    options: optionsChange.optional(),
    /** Revision the caller observed; a stale one fails with `<ns>/conflict`. */
    expectedRevision: z.number().int().nonnegative(),
  }).strict().refine(change => change.connectionId !== undefined || change.options !== undefined, 'a change needs connectionId or options')

  const strict = (typeSymbol: string, create: () => z.ZodType) => ({ mode: 'strict', typeSymbol, create }) as const
  const request = (typeSymbol: string, create: () => z.ZodType) => ({ name: 'request', source: 'json', codec: strict(typeSymbol, create), strictCodec: strict(typeSymbol, create) }) as const
  const method = (name: string, parameter: ReturnType<typeof request>, result: ReturnType<typeof strict>) =>
    [`${namespace}/${name}`, { service: namespace, invocation: { kind: 'direct' }, parameters: [parameter], result }] as const
  const Type = (name: string) => `${namespace[0]!.toUpperCase()}${namespace.slice(1)}${name}`

  /** Client contribution; mount with `ctx.remote.$mount(remoteInfo)`. */
  const remoteInfo = createTypertRemoteInfo({
    package: packageName,
    methods: Object.fromEntries([
      method('get', request(Type('SelectionRequest'), () => selectionRequest), strict(Type('SelectionView'), () => selectionView)),
      method('set', request(Type('SelectionChange'), () => selectionChange), strict(Type('SelectionView'), () => selectionView)),
      method('provider', request(Type('ProviderRequest'), () => providerRequest), strict(Type('ProviderView'), () => providerView)),
      method('pairings', request(Type('PairingsRequest'), () => pairingsRequest), strict(Type('PairingsView'), () => pairingsView)),
      method('forgetPairing', request(Type('ForgetPairingRequest'), () => forgetPairingRequest), strict(Type('PairingsView'), () => pairingsView)),
    ]),
  }, z)

  return { namespace, options, optionsChange, connectionView, selection, selectionView, selectionChange, remoteInfo }
}

export type SelectionContract<O extends z.ZodRawShape, E extends z.ZodRawShape> = ReturnType<typeof selectionContract<O, E>>
export type ConnectionViewOf<C> = C extends { connectionView: z.ZodType<infer V> } ? V : never
export type SelectionViewOf<C> = C extends { selectionView: z.ZodType<infer V> } ? V : never
export type SelectionChangeOf<C> = C extends { selectionChange: z.ZodType<infer V> } ? V : never

/**
 * The capability-agnostic views, for code that handles either capability (the
 * ui package). A capability's own types (`SelectionViewOf<typeof contract>`)
 * are assignable to them.
 */
export type ConnectionView = z.infer<typeof connectionViewBase> & Readonly<Record<string, unknown>>
export interface SelectionView<O extends Record<string, unknown> = Record<string, unknown>> {
  readonly selection: Selection<O>
  readonly source: SelectionSource
  readonly connections: readonly ConnectionView[]
}
/** A change as any capability's `<ns>/set` accepts it; the capability's contract narrows `options`. */
export interface SelectionChange<O extends Record<string, unknown> = Record<string, unknown>> {
  readonly sessionId: string
  readonly connectionId?: string | null | undefined
  readonly options?: Partial<O> | undefined
  readonly expectedRevision: number
}

/**
 * The method map a capability merges into `TypertRemoteMap`:
 * `interface TypertRemoteMap extends ConnectionsRemoteMap<'searchConnections', SearchSelectionView> {}`.
 */
export type ConnectionsRemoteMap<NS extends string, V, C = SelectionChange> = {
  [K in `${NS}/get`]: (request: SelectionRequest) => Promise<RemoteResult<V>>
} & {
  [K in `${NS}/set`]: (request: C) => Promise<RemoteResult<V>>
} & {
  [K in `${NS}/provider`]: (request: ProviderRequest) => Promise<RemoteResult<ProviderView>>
} & {
  [K in `${NS}/pairings`]: (request: PairingsRequest) => Promise<RemoteResult<PairingsView>>
} & {
  [K in `${NS}/forgetPairing`]: (request: ForgetPairingRequest) => Promise<RemoteResult<PairingsView>>
}

/** The error details a capability merges into `RemoteErrorDetailsMap`. */
export type ConnectionsRemoteErrors<NS extends string> = {
  /** The row document is invalid; repair it on the settings page. */
  [K in `${NS}/invalid-settings`]: {}
} & {
  /** The selection changed after the caller read it; re-read and retry. */
  [K in `${NS}/conflict`]: {}
} & {
  /** The requested connection is missing or disabled. */
  [K in `${NS}/unavailable`]: { readonly connectionId: string }
}
