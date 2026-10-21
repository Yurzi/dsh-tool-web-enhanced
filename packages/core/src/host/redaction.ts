export interface SecretMatcher {
  readonly values: readonly string[]
  readonly windows: ReadonlySet<string>
  readonly short: readonly string[]
  readonly prefixes: ReadonlySet<string>
}

/** Compile once per response; successful strings and raw explanations share this immutable lookup. */
export function secretMatcher(secrets: Iterable<string>): SecretMatcher {
  const values = new Set<string>()
  for (const secret of secrets) {
    if (secret !== '') values.add(secret)
    if (secret.trim() !== '') values.add(secret.trim())
  }
  const windows = new Set<string>()
  const prefixes = new Set<string>()
  for (const value of values) {
    for (let index = 0; index + 8 <= value.length; index++) windows.add(value.slice(index, index + 8))
    for (let length = 1; length <= Math.min(7, value.length); length++) prefixes.add(value.slice(0, length))
  }
  return { values: [...values], windows, short: [...values].filter(value => value.length < 8), prefixes }
}

/** Decide on the whole explanation in each view; never split encoded text into protected intervals. */
export function containsSecret(text: string, matcher: SecretMatcher): boolean {
  if (matches(text, matcher)) return true
  return matches(decodeJsonEscapes(text), matcher)
}

function matches(text: string, matcher: SecretMatcher): boolean {
  for (const value of matcher.short) if (text.includes(value)) return true
  for (let index = 0; index + 8 <= text.length; index++) {
    if (matcher.windows.has(text.slice(index, index + 8))) return true
  }
  return false
}

/** Successful JSON strings are already decoded: replace covered values/fragments without interpreting escapes. */
export function redactSecrets(text: string, matcher: SecretMatcher): string {
  if (matcher.values.length === 0) return text
  let output = ''
  let cursor = 0
  let covered = -1
  for (let index = 0; index < text.length; index++) {
    let end = index
    if (index + 8 <= text.length && matcher.windows.has(text.slice(index, index + 8))) end = index + 8
    for (const value of matcher.short) if (text.startsWith(value, index)) end = Math.max(end, index + value.length)
    if (end === index) continue
    if (index > covered) output += text.slice(cursor, index) + '[redacted]'
    covered = Math.max(covered, end)
    cursor = covered
  }
  return output + text.slice(cursor)
}

/** Visit only parsed string values, retaining keys/scalars and avoiding recursion on deep JSON. */
export function redactJson<T>(value: T, matcher: SecretMatcher): T {
  if (matcher.values.length === 0) return value
  if (typeof value === 'string') return redactSecrets(value, matcher) as T
  if (typeof value !== 'object' || value === null) return value
  const pending = [value as Record<string, unknown>]
  while (pending.length > 0) {
    const object = pending.pop()!
    for (const [key, child] of Object.entries(object)) {
      if (typeof child === 'string') object[key] = redactSecrets(child, matcher)
      else if (typeof child === 'object' && child !== null) pending.push(child as Record<string, unknown>)
    }
  }
  return value
}

/** Return a safe copy: no original stack/cause/data, and no untrusted name/code references. */
export function redactDiagnostic(error: unknown, matcher: SecretMatcher): Error {
  const message = String(error instanceof Error ? error.message : error)
  const safe = new Error(containsSecret(message, matcher)
    ? "diagnostic message withheld: it contained this request's credential"
    : bounded(message))
  const name = error instanceof Error ? error.name : 'Error'
  safe.name = typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]*(Error|Exception)$/.test(name) && !containsSecret(name, matcher) ? name : 'Error'
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) && !containsSecret(code, matcher)) {
    Object.defineProperty(safe, 'code', { value: code, enumerable: true })
  }
  return safe
}

function bounded(text: string): string {
  if (text.length <= 2000) return text
  const last = text.charCodeAt(1998)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? 1998 : 1999) + '…'
}

/** Decode one JSON escape layer in fallback text; deliberately do not chase multiply encoded data. */
function decodeJsonEscapes(value: string): string {
  const backslash = String.fromCharCode(92)
  let decoded = ''
  let start = 0
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== backslash) continue
    const next = value[index + 1]
    let character: string | undefined
    let width = 2
    switch (next) {
      case '"': case '/': case backslash: character = next; break
      case 'b': character = String.fromCharCode(8); break
      case 'f': character = String.fromCharCode(12); break
      case 'n': character = String.fromCharCode(10); break
      case 'r': character = String.fromCharCode(13); break
      case 't': character = String.fromCharCode(9); break
      case 'u': {
        const hex = value.slice(index + 2, index + 6)
        if (/^[0-9a-f]{4}$/iu.test(hex)) { character = String.fromCharCode(Number.parseInt(hex, 16)); width = 6 }
        break
      }
    }
    if (character === undefined) continue
    decoded += value.slice(start, index) + character
    index += width - 1
    start = index + 1
  }
  return decoded + value.slice(start)
}
