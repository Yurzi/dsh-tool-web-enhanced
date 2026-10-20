import { describe, expect, it } from 'vitest'
import { appendLine, readAllowlist, replaceLine } from '../src/client/allowlist-lines.ts'
import type { RuleProblem } from '../src/local/rules.ts'

describe('allowlist line diagnostics', () => {
  it('ignores whitespace and blank lines while preserving accepted spelling', () => {
    expect(readAllowlist('allowCidrs', ' \r\n 198.18.0.0/15 \n\t\nfd12:3456::/32\r')).toEqual({
      values: ['198.18.0.0/15', 'fd12:3456::/32'], reports: [],
    })
    expect(readAllowlist('allowHostnames', ' Wiki.Example.COM. \n *.Example.com \n')).toEqual({
      values: ['Wiki.Example.COM.', '*.Example.com'], reports: [],
    })
    expect(readAllowlist('allowCidrs', '\n \t\r\n')).toEqual({ values: [], reports: [] })
  })

  const cidrProblems: [string, RuleProblem][] = [
    ['not-a-cidr', { code: 'syntax' }],
    ['010.0.0.0/8', { code: 'ipv4-form' }],
    ['fe80::%eth0/64', { code: 'zone' }],
    ['::ffff:192.168.0.0/120', { code: 'mapped', fix: '192.168.0.0/24' }],
    ['::ffff:0:0/80', { code: 'mapped' }],
    ['198.18.1.1/15', { code: 'host-bits', fix: '198.18.0.0/15' }],
  ]
  it.each(cidrProblems)('reports the shared CIDR problem for %s at its physical line', (input, problem) => {
    expect(readAllowlist('allowCidrs', '\n198.18.0.0/15\n\n ' + input)).toEqual({
      values: undefined, reports: [{ line: 4, text: input, note: { kind: 'problem', problem } }],
    })
  })

  const hostnameProblems: [string, RuleProblem][] = [
    ['user@example.com', { code: 'syntax' }],
    ['fe80::1%eth0', { code: 'zone' }],
    ['foo.*.example.com', { code: 'wildcard' }],
    ['*.127.0.0.1', { code: 'wildcard-ip' }],
    ['https://Wiki.Example.com/a', { code: 'not-hostname', fix: 'wiki.example.com' }],
    ['wiki.example.com:8080', { code: 'not-hostname', fix: 'wiki.example.com' }],
  ]
  it.each(hostnameProblems)('reports the shared hostname problem for %s', (input, problem) => {
    expect(readAllowlist('allowHostnames', '\n' + input)).toEqual({
      values: undefined, reports: [{ line: 2, text: input, note: { kind: 'problem', problem } }],
    })
  })

  it.each([
    ['allowCidrs', 'fd12:3456::/32\n\nfd12:3456:0:0::/32', 3],
    ['allowHostnames', 'Wiki.Example.COM.\n\nwiki.example.com', 3],
    ['allowHostnames', '*.Example.COM.\n*.example.com', 2],
    ['allowHostnames', '[::1]\n0:0:0:0:0:0:0:1', 2],
  ] as const)('rejects semantic duplicates in %s', (field, text, line) => {
    const reading = readAllowlist(field, text)
    expect(reading.values).toBeUndefined()
    expect(reading.reports).toContainEqual({ line, text: text.split('\n')[line - 1], note: { kind: 'duplicate', of: 1 } })
  })

  it('does not confuse exact rules with strict-subdomain wildcard rules', () => {
    expect(readAllowlist('allowHostnames', 'example.com\n*.example.com').values).toEqual(['example.com', '*.example.com'])
  })

  it('keeps warnings saveable and in physical-line/severity order', () => {
    const reading = readAllowlist('allowCidrs', '\n0.0.0.0/0\n\n8.8.8.0/24\n127.0.0.0/8\n169.254.0.0/16')
    expect(reading.values).toEqual(['0.0.0.0/0', '8.8.8.0/24', '127.0.0.0/8', '169.254.0.0/16'])
    expect(reading.reports.map(({ line, note }) => [line, note])).toEqual([
      [2, { kind: 'warning', warning: 'metadata' }],
      [2, { kind: 'warning', warning: 'loopback' }],
      [2, { kind: 'warning', warning: 'broad' }],
      [4, { kind: 'warning', warning: 'public' }],
      [5, { kind: 'warning', warning: 'loopback' }],
      [6, { kind: 'warning', warning: 'metadata' }],
    ])
  })

  it('reports every bad line, even when another field or line already blocks saving', () => {
    const reading = readAllowlist('allowCidrs', 'bad\n\n10.0.0.1/8\n8.8.8.0/24')
    expect(reading.values).toBeUndefined()
    expect(reading.reports.map(report => [report.line, report.note.kind])).toEqual([[1, 'problem'], [3, 'problem'], [4, 'warning']])
  })
})

describe('allowlist line edits', () => {
  it('replaces just the selected physical line and preserves mixed line endings and whitespace', () => {
    expect(replaceLine(' first \r\n bad\n last \r', 2, 'fixed')).toBe(' first \r\nfixed\n last \r')
    expect(replaceLine('first\nsecond\nthird', 2, '')).toBe('first\n\nthird')
  })

  it('appends rules on their own line', () => {
    expect(appendLine(' \n', 'example.com')).toBe('example.com')
    expect(appendLine('first\n\n ', 'second')).toBe('first\nsecond')
  })
})
