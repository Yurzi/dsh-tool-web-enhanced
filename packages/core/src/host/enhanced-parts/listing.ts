import type { InferValue, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { FRESHNESS, type Freshness, type UnsupportedReason } from '../../shared/index.ts'
import type { EnhancedAccess, ExplicitCall, ProviderEntry, ProviderListing, Recipient } from '../enhanced.ts'
import { rejectionError, type EnhancedVoice } from './wording.ts'

/** The recipient `sendsTo` names for fetch `local`; the text says `fetches from this machine`. */
export const THIS_MACHINE = 'this machine'
const SESSION_MODEL = 'the service behind the session model'

/** Operator data in the listing is one line and bounded; labels and service names share the settings label bound. */
const LABEL_MAX = 200
const HOST_MAX = 253
const NOTICE_MAX = 2000

/** Why the session model cannot search, in English; the execution layer's error and the listing share it. */
export const UNSUPPORTED_REASON_TEXT: Readonly<Record<UnsupportedReason, string>> = {
  'no-model': 'no session model is available',
  'unknown-route': 'the model route is unknown',
  protocol: 'the route does not declare a supported protocol',
  endpoint: 'the route has no supported endpoint',
  headers: 'the route uses custom request headers',
  credential: 'the route has no supported credential reference',
}

const text = { type: 'string', required: true } as const

function entrySchema<const P extends ParameterSchemaSpec>(extra: P) {
  const common = { id: text, name: text, use: { type: 'string' }, sendsTo: text, ...extra } as const
  return {
    oneOf: [
      { type: 'object', additionalProperties: false, properties: { ...common, status: { type: 'string', required: true, const: 'ready' } } },
      { type: 'object', additionalProperties: false, properties: { ...common, status: { type: 'string', required: true, const: 'needs-key' } } },
      { type: 'object', additionalProperties: false, properties: { ...common, status: { type: 'string', required: true, const: 'needs-sign-in' } } },
      { type: 'object', additionalProperties: false, properties: { ...common, status: { type: 'string', required: true, const: 'unavailable' }, reason: text } },
    ],
  } as const
}

const session = { sessionProvider: text, sessionProviderTurnedOff: { type: 'boolean', required: true } } as const

// Schemas are built on call, so each plugin bundle keeps only its own.
export function searchListingSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...session,
      freshness: { type: 'string', required: true, enum: FRESHNESS },
      providers: { type: 'array', required: true, items: entrySchema({ appliesFreshness: { type: 'boolean', required: true } }) },
    },
  } as const
}

export function fetchListingSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...session,
      providers: { type: 'array', required: true, items: entrySchema({ notice: { type: 'string' } }) },
    },
  } as const
}

/** The canonical value of `list_web_search_providers` (docs/design.md, "列出工具"). */
export type SearchListingValue = InferValue<ReturnType<typeof searchListingSchema>>
/** The canonical value of `list_web_fetch_providers`. */
export type FetchListingValue = InferValue<ReturnType<typeof fetchListingSchema>>
type SearchListed = SearchListingValue['providers'][number]
type FetchListed = FetchListingValue['providers'][number]

interface ListedBase {
  readonly id: string
  readonly name: string
  readonly use?: string
  readonly sendsTo: string
}

type Readiness =
  | { readonly status: 'ready' }
  | { readonly status: 'needs-key' }
  | { readonly status: 'needs-sign-in' }
  | { readonly status: 'unavailable'; readonly reason: string }

/** This conversation's providers, or the worded refusal. */
export async function listProviders<O, Q, R>(voice: EnhancedVoice, access: EnhancedAccess<O, Q, R>, call: ExplicitCall): Promise<ProviderListing<O>> {
  const outcome = await access.list(call)
  if (outcome.kind === 'rejected') throw rejectionError(voice, outcome.reason)
  return outcome.value
}

export function searchListingValue(listing: ProviderListing<{ readonly freshness: Freshness }>): SearchListingValue {
  return {
    ...sessionOf(listing),
    freshness: listing.options.freshness,
    providers: listing.providers.map((entry): SearchListed => ({ ...listedBase(entry), appliesFreshness: entry.facts.appliesFreshness === true, ...readiness(entry) })),
  }
}

export function fetchListingValue(listing: ProviderListing<unknown>): FetchListingValue {
  return {
    ...sessionOf(listing),
    providers: listing.providers.map((entry): FetchListed => {
      const { notice } = entry.facts
      return { ...listedBase(entry), ...notice === undefined ? {} : { notice: oneLine(notice, NOTICE_MAX) }, ...readiness(entry) }
    }),
  }
}

/** One line per provider, `<id> — <name> · …`, without a heading (docs/design.md, "列出工具"). */
export function renderSearchListing(voice: EnhancedVoice, value: SearchListingValue): string {
  const uncached = value.freshness !== 'auto'
  const head = uncached ? ['The user asked for uncached (fresh) page content; only providers marked "uncached" apply it.'] : []
  return renderLines(voice, value, head, {
    marks: entry => uncached && entry.appliesFreshness ? ['uncached'] : [],
    notes: () => [],
  })
}

export function renderFetchListing(voice: EnhancedVoice, value: FetchListingValue): string {
  return renderLines(voice, value, [], {
    marks: () => [],
    notes: entry => entry.notice === undefined ? [] : [entry.notice],
  })
}

/** Capability parts of an entry line: `marks` come before the recipient, `notes` after it. */
interface EntryParts<E> {
  readonly marks: (entry: E) => readonly string[]
  readonly notes: (entry: E) => readonly string[]
}

function renderLines<E extends ListedBase & Readiness>(
  voice: EnhancedVoice,
  value: { readonly sessionProvider: string; readonly sessionProviderTurnedOff: boolean; readonly providers: readonly E[] },
  head: readonly string[],
  parts: EntryParts<E>,
): string {
  const entries = value.providers.map(entry => {
    const line = [statusText(entry)]
    if (entry.id === value.sessionProvider) line.push('selected for this session')
    if (entry.use !== undefined) line.push(entry.use)
    line.push(...parts.marks(entry))
    if (entry.sendsTo === THIS_MACHINE) line.push('fetches from this machine')
    else if (entry.sendsTo !== entry.name) line.push(`${voice.sends} go to ${entry.sendsTo}`)
    line.push(...parts.notes(entry))
    return `${entry.id} — ${entry.name} · ${line.join(' · ')}`
  })
  const tail = value.sessionProviderTurnedOff
    ? [`This session's selection, ${value.sessionProvider}, is turned off; ${voice.nativeTool} will fail until the user changes it.`]
    : []
  return [...head, ...entries.length === 0 ? ['(no providers)'] : entries, ...tail].join('\n')
}

function statusText(entry: Readiness): string {
  switch (entry.status) {
    case 'ready': return 'ready'
    case 'needs-key': return 'needs an API key (ask the user)'
    case 'needs-sign-in': return 'needs the user to sign in to DeepSeek again'
    case 'unavailable': return `unavailable: ${entry.reason}`
  }
}

function sessionOf(listing: ProviderListing<unknown>): { readonly sessionProvider: string; readonly sessionProviderTurnedOff: boolean } {
  return { sessionProvider: listing.session.connectionId, sessionProviderTurnedOff: !listing.session.selectable }
}

function listedBase(entry: ProviderEntry): ListedBase {
  const { use, recipient } = entry.facts
  return { id: entry.id, name: oneLine(entry.name, LABEL_MAX), ...use === undefined ? {} : { use }, sendsTo: recipientText(recipient) }
}

function recipientText(recipient: Recipient): string {
  switch (recipient.kind) {
    case 'this-machine': return THIS_MACHINE
    case 'session-model': return recipient.provider === undefined ? SESSION_MODEL : `${SESSION_MODEL} (${oneLine(recipient.provider, LABEL_MAX)})`
    case 'service': return recipient.host === undefined ? oneLine(recipient.service, LABEL_MAX) : oneLine(recipient.host, HOST_MAX)
  }
}

function readiness(entry: ProviderEntry): Readiness {
  switch (entry.status) {
    case 'ready': return { status: 'ready' }
    case 'needs-credential': return { status: entry.credential === 'account' ? 'needs-sign-in' : 'needs-key' }
    case 'unsupported': return { status: 'unavailable', reason: UNSUPPORTED_REASON_TEXT[entry.reason] }
  }
}

/** Collapse line breaks, controls and runs of white space, then cut at `max` characters without splitting a surrogate pair. */
function oneLine(value: string, max: number): string {
  const flat = value.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim()
  if (flat.length <= max) return flat
  const last = flat.charCodeAt(max - 2)
  return flat.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 2 : max - 1) + '…'
}
