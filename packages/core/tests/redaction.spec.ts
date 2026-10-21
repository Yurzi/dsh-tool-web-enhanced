import { describe, expect, it } from 'vitest'
import { containsSecret, redactDiagnostic, redactJson, redactSecrets, secretMatcher } from '../src/host/index.ts'

const slash = String.fromCharCode(92)
const unicode = (value: string) => Array.from({ length: value.length }, (_, index) => slash + 'u' + value.charCodeAt(index).toString(16).padStart(4, '0')).join('')
const WITHHELD = "diagnostic message withheld: it contained this request's credential"

describe('request-scoped secret detection', () => {
  it('detects every raw/Unicode switch point in both directions without creating exposed fragments', () => {
    const secret = '0123456789abcdef'
    const matcher = secretMatcher([secret])
    for (let split = 0; split <= secret.length; split++) {
      for (const text of [secret.slice(0, split) + unicode(secret.slice(split)), unicode(secret.slice(0, split)) + secret.slice(split)]) {
        expect(containsSecret(text, matcher)).toBe(true)
        expect(redactDiagnostic(new Error(text), matcher).message).toBe(WITHHELD)
      }
    }
  })

  it.each(['token', 'sk-' + slash, 'sk-' + slash + 'token', 'sk-' + slash + 'u0041-key', 'sk-' + slash + 'n-secret', '  opaque account token  '])('detects raw, trimmed and whole-decoded views for %j', secret => {
    const matcher = secretMatcher([secret])
    for (const text of [secret, secret.trim(), JSON.stringify(secret), slash + secret, secret + 'n']) {
      expect(containsSecret(text, matcher)).toBe(true)
      expect(redactDiagnostic(new Error(text), matcher).message).toBe(WITHHELD)
    }
  })

  it('detects any eight-character excerpt, uses whole short values, and does not pursue multiple encoding layers', () => {
    const matcher = secretMatcher(['sk-0123456789abcdef', 'tiny'])
    expect(containsSecret('01234567', matcher)).toBe(true)
    expect(containsSecret('tiny', matcher)).toBe(true)
    expect(containsSecret('tin', matcher)).toBe(false)
    expect(containsSecret('unrelated service explanation', matcher)).toBe(false)
    const encoded = unicode('s') + 'ecret'
    expect(containsSecret(encoded, secretMatcher(['secret']))).toBe(true)
    expect(containsSecret(slash + encoded, secretMatcher(['secret']))).toBe(false)
  })
})

describe('successful decoded values', () => {
  it('replaces actual raw/trimmed values and covered eight-character excerpts without rescanning markers', () => {
    const matcher = secretMatcher(['long-private-key', '  opaque token  ', '[', 'redacted'])
    expect(redactSecrets('long-private-key|opaque token|[|redacted', matcher)).toBe('[redacted]|[redacted]|[redacted]|[redacted]')
    expect(redactSecrets('private-', matcher)).toBe('[redacted]')
    expect(redactSecrets('plain text', matcher)).toBe('plain text')
  })

  it('builds a long-key matcher once and reuses it across many strings without recursive JSON traversal', () => {
    let reads = 0
    const key = 'a'.repeat(16_000) + 'z'
    const secrets = { *[Symbol.iterator]() { reads++; yield key } }
    const matcher = secretMatcher(secrets)
    const rows = Array.from({ length: 16_000 }, () => 'ok')
    expect(redactJson(rows, matcher)).toBe(rows)
    expect(rows.every(value => value === 'ok')).toBe(true)
    expect(redactSecrets(key, matcher)).toBe('[redacted]')
    expect(reads).toBe(1)
    const depth = 20_000
    const payload: unknown = JSON.parse('{"nested":'.repeat(depth) + JSON.stringify(key) + '}'.repeat(depth))
    let cursor = redactJson(payload, matcher)
    for (let index = 0; index < depth; index++) cursor = (cursor as { nested: unknown }).nested
    expect(cursor).toBe('[redacted]')
    expect(reads).toBe(1)
  })
})

describe('diagnostic copies', () => {
  it.each([
    { name: 'Error-private-key', code: { credential: 'private-key' }, expectedName: 'Error', expectedCode: undefined },
    { name: 'SyntaxError', code: 'BAD_JSON', expectedName: 'SyntaxError', expectedCode: 'BAD_JSON' },
    { name: 'SafeException', code: 'bad-code', expectedName: 'SafeException', expectedCode: undefined },
    { name: 'CREDENTIALError', code: 'CREDENTIAL', expectedName: 'Error', expectedCode: undefined },
    { name: { credential: 'private-key', toString: () => 'SyntaxError' }, code: undefined, expectedName: 'Error', expectedCode: undefined },
  ])('whitelists metadata and withholds credential-bearing messages (%j)', ({ name, code, expectedName, expectedCode }) => {
    const matcher = secretMatcher(['private-key', 'CREDENTIAL'])
    const original = Object.assign(new Error('failure private-key', { cause: new Error('private-key') }), { name, code, attached: { credential: 'private-key' } })
    const safe = redactDiagnostic(original, matcher)
    expect(safe).not.toBe(original)
    expect(safe.name).toBe(expectedName)
    expect((safe as Error & { code?: unknown }).code).toBe(expectedCode)
    expect(safe.message).toBe(WITHHELD)
    expect(safe.cause).toBeUndefined()
    expect(safe).not.toHaveProperty('attached')
    expect(String(safe)).not.toContain('private-key')
    expect(safe.stack).not.toContain('private-key')
    expect(safe.stack).not.toContain('CREDENTIAL')
  })

  it('preserves safe diagnostic text with a 2000-unit cap and no original stack/cause', () => {
    const original = new TypeError('x'.repeat(2001), { cause: new Error('private') })
    const safe = redactDiagnostic(original, secretMatcher([]))
    expect(safe.name).toBe('TypeError')
    expect(safe.message).toBe('x'.repeat(1999) + '…')
    expect(safe.cause).toBeUndefined()
    expect(safe.stack).not.toBe(original.stack)
  })
})
