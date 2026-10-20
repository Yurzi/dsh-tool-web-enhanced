/**
 * The connection grammar both capabilities share: how connections are named,
 * how a catalog entry describes itself, and how operator-supplied options are
 * checked against that description. Pure and isomorphic.
 */

import { isEndpoint } from './url.ts'

/** Upper bound on any text option; a pattern runs only on text within it. */
export const TEXT_MAX_LENGTH = 2000

/** A connection the operator can select: a catalog entry or an operator-defined one. */
export type ConnectionId = `builtin:${string}` | `custom:${string}`

export const BUILTIN_PREFIX = 'builtin:'
export const CUSTOM_PREFIX = 'custom:'

/** Operator-defined connection ids: `custom:` plus a short, readable name. */
export const CUSTOM_CONNECTION_ID = /^custom:[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u

/** A DSH Credentials reference, the only form a key is ever stored in. */
export const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** Persisted access modes; `account` is derived per call from the Session's model route. */
export type AccessMode = 'keyless' | 'api-key'

/** How a call actually authenticates. */
export type Access = AccessMode | 'account'

/** The four backend kinds of docs/architecture.md section 6.4. */
export type BackendKind = 'native' | 'adapter' | 'model' | 'local'

/**
 * One accepted operator option of a connection. `keyless` narrows the option
 * on the anonymous route: omitted accepts it unchanged, `false` rejects it, a
 * list narrows the accepted enum values.
 */
export type OptionRule =
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly keyless?: readonly string[] | false }
  /** Text matching `pattern`; never longer than `maxLength` (default {@link TEXT_MAX_LENGTH}), checked before the pattern runs. */
  | { readonly kind: 'text'; readonly pattern: RegExp; readonly maxLength?: number; readonly keyless?: false }
  /** An absolute http(s) URL without credentials, query or fragment (see `isEndpoint`). */
  | { readonly kind: 'url'; readonly keyless?: false }
  | { readonly kind: 'boolean'; readonly keyless?: false }
  | { readonly kind: 'integer'; readonly min: number; readonly max: number }
  /** A list of strings, each matching `pattern`; capabilities add semantic checks (CIDR syntax) on top. */
  | { readonly kind: 'list'; readonly pattern: RegExp; readonly max: number }

/** How a catalog entry can be reached. */
export interface AccessFacts {
  /** An anonymous route exists; built-in connections then default to it. */
  readonly keyless: boolean
  /** Personal-key access and the DSH Credentials reference it resolves by default. */
  readonly apiKey: { readonly credentialRef: string } | false
  /** A DeepSeek account sign-in can authenticate Sessions on the account route. */
  readonly account: boolean
}

/**
 * Secret-free catalog facts about one built-in connection. Validation, the
 * settings page, and status views all read it; a capability extends it with
 * its own facts (endpoint, freshness support, …).
 */
export interface Descriptor {
  readonly label: string
  readonly homepage?: string
  readonly kind: BackendKind
  /** Whether the query or URL leaves this machine for a third-party service; only drives explanatory text. */
  readonly remote: boolean
  readonly access: AccessFacts
  readonly options: Readonly<Record<string, OptionRule>>
}

export const builtinId = (key: string): ConnectionId => `${BUILTIN_PREFIX}${key}`

export const isBuiltinId = (id: string): boolean => id.startsWith(BUILTIN_PREFIX)
export const isCustomId = (id: string): boolean => CUSTOM_CONNECTION_ID.test(id)

/** The catalog key of a built-in connection id, or undefined for any other id. */
export function builtinKey(id: string): string | undefined {
  return id.startsWith(BUILTIN_PREFIX) ? id.slice(BUILTIN_PREFIX.length) : undefined
}

/** The default access of a catalog entry: anonymous when it exists, else a personal key. */
export function defaultAccess(access: AccessFacts): AccessMode {
  return access.keyless ? 'keyless' : 'api-key'
}

/**
 * Check operator options against a descriptor's rules.
 * @param label - connection label used in the problems.
 * @param rules - the descriptor's option rules.
 * @param options - the operator's options.
 * @param access - persisted access mode; keyless may reject or narrow an option.
 * @returns one English problem per invalid option; empty when all are valid.
 */
export function validateOptions(label: string, rules: Readonly<Record<string, OptionRule>>, options: Readonly<Record<string, unknown>>, access: AccessMode): string[] {
  return Object.entries(options).flatMap(([key, value]) => {
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined
    if (rule === undefined) return [`${label} has no option "${key}"`]
    if (!accepts(rule, value)) return [`${label} option "${key}" has an invalid value`]
    if (access === 'keyless' && !keylessAccepts(rule, value)) return [`${label} option "${key}" = ${JSON.stringify(value)} needs API-key access`]
    return []
  })
}

function accepts(rule: OptionRule, value: unknown): boolean {
  switch (rule.kind) {
    case 'enum': return typeof value === 'string' && rule.values.includes(value)
    case 'text': return typeof value === 'string' && value.length <= (rule.maxLength ?? TEXT_MAX_LENGTH) && rule.pattern.test(value)
    case 'url': return typeof value === 'string' && value.length <= TEXT_MAX_LENGTH && isEndpoint(value)
    case 'boolean': return typeof value === 'boolean'
    case 'integer': return Number.isInteger(value) && (value as number) >= rule.min && (value as number) <= rule.max
    case 'list': return Array.isArray(value) && value.length <= rule.max && value.every(item => typeof item === 'string' && rule.pattern.test(item))
  }
}

function keylessAccepts(rule: OptionRule, value: unknown): boolean {
  if (!('keyless' in rule) || rule.keyless === undefined) return true
  if (rule.keyless === false) return false
  return rule.keyless.includes(value as string)
}
