import { type CidrWarning, type RuleProblem, cidrWarnings, parseCidr, parseHostnameRule } from '../local/rules.ts'

export type AllowlistField = 'allowCidrs' | 'allowHostnames'

export type LineNote =
  | { readonly kind: 'problem'; readonly problem: RuleProblem }
  | { readonly kind: 'duplicate'; readonly of: number }
  | { readonly kind: 'warning'; readonly warning: CidrWarning }

export interface LineReport {
  /** 1-based physical line in the textarea, including blank lines. */
  readonly line: number
  readonly text: string
  readonly note: LineNote
}

export interface AllowlistReading {
  /** Undefined if any line is invalid or a semantic duplicate; warnings do not block saving. */
  readonly values: readonly string[] | undefined
  readonly reports: readonly LineReport[]
}

/** Read with the Host's grammar, preserving accepted spelling and ignoring blank lines. */
export function readAllowlist(field: AllowlistField, text: string): AllowlistReading {
  const values: string[] = []
  const reports: LineReport[] = []
  const seen = new Map<string, number>()
  let refused = false

  text.split(/\r\n?|\n/).forEach((raw, index) => {
    const line = index + 1
    const value = raw.trim()
    if (value === '') return
    const parsed = field === 'allowCidrs' ? parseCidr(value) : parseHostnameRule(value)
    if (!parsed.ok) {
      refused = true
      reports.push({ line, text: value, note: { kind: 'problem', problem: parsed.problem } })
      return
    }
    const key = JSON.stringify(parsed.value)
    const first = seen.get(key)
    if (first !== undefined) {
      refused = true
      reports.push({ line, text: value, note: { kind: 'duplicate', of: first } })
      return
    }
    seen.set(key, line)
    values.push(value)
    if (field === 'allowCidrs' && 'prefixLength' in parsed.value) {
      for (const warning of cidrWarnings(parsed.value)) {
        reports.push({ line, text: value, note: { kind: 'warning', warning } })
      }
    }
  })
  return { values: refused ? undefined : values, reports }
}

/** Replace a physical line without changing other lines or their line endings. */
export function replaceLine(text: string, line: number, replacement: string): string {
  const parts = text.split(/(\r\n|\r|\n)/)
  parts[(line - 1) * 2] = replacement
  return parts.join('')
}

/** Append a rule on its own line. */
export function appendLine(text: string, rule: string): string {
  const body = text.replace(/\s+$/, '')
  return body === '' ? rule : body + '\n' + rule
}
