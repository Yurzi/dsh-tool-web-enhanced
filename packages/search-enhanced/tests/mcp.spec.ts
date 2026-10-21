/** Search-specific mappings for keyless MCP tool results. */
import { describe, expect, it } from 'vitest'
import type { SearchInput } from 'dsh-tool-web-enhanced-core/host'
import { ADAPTER_WIRES } from '../src/search/adapters/index.ts'

const INPUT: SearchInput = { query: 'q', maxResults: undefined, freshness: 'auto', options: {} }

describe('keyless MCP results', () => {
  const exa = ADAPTER_WIRES.exa.keyless
  const tinyfish = ADAPTER_WIRES.tinyfish.keyless
  if (typeof exa !== 'object' || typeof tinyfish !== 'object') throw new Error('expected MCP routes')
  const textResult = (text: string) => ({ content: [{ type: 'text', text }] })

  it('reads Exa text blocks', () => {
    const text = 'Title: First\nURL: https://example.com/one\nPublished Date: 2025-01-01\nText: First paragraph\nsecond line\n\n---\n\n'
      + 'Title: Second\nURL: https://example.com/two\nHighlights:\n - Useful evidence'
    expect(exa.parse(textResult(text), INPUT)).toEqual([
      { url: 'https://example.com/one', title: 'First', publishedAt: '2025-01-01T00:00:00.000Z', snippet: 'First paragraph\nsecond line' },
      { url: 'https://example.com/two', title: 'Second', snippet: '- Useful evidence' },
    ])
  })

  it.each([
    ['text length', ' '.repeat(512 * 1024)],
    ['line count', '\n '.repeat(10_000)],
  ])('rejects excessive Exa %s before parsing whitespace-heavy text', (_limit, padding) => {
    const value = 'Title: Untrusted\nURL: https://example.com\nText: evidence\n' + padding + '!'
    expect(() => exa.parse(textResult(value), INPUT)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('counts separators between empty Exa text parts toward the line budget', () => {
    const result = { content: [
      { type: 'text', text: 'No search results found.' },
      ...Array.from({ length: 5000 }, () => ({ type: 'text', text: '' })),
    ] }
    expect(() => exa.parse(result, INPUT)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('preserves non-separator suffixes and strips only a final Exa separator', () => {
    const prefix = 'Title: Example\nURL: https://example.com\nText: evidence'
    expect(exa.parse(textResult(prefix + '\n \n --- \n\t'), INPUT)).toEqual([
      { url: 'https://example.com', title: 'Example', snippet: 'evidence' },
    ])
    expect(exa.parse(textResult(prefix + '\n \n --- \n!'), INPUT)).toEqual([
      { url: 'https://example.com', title: 'Example', snippet: 'evidence\n \n --- \n!' },
    ])
  })

  it('reads JSON rows from structured content or text', () => {
    const rows = { results: [{ url: 'https://example.com', title: 'Example', snippet: 'evidence' }] }
    expect(tinyfish.parse(textResult(JSON.stringify(rows)), INPUT)).toEqual(rows.results)
    expect(exa.parse({ structuredContent: rows }, INPUT)).toEqual(rows.results)
  })

  it('accepts an explicit empty result but never mistakes an unknown one for it', () => {
    expect(exa.parse(textResult('No search results found.'), INPUT)).toEqual([])
    for (const route of [exa, tinyfish]) {
      expect(() => route.parse(textResult('unknown payload'), INPUT)).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    }
  })
})
