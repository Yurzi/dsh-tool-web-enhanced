import { isEndpoint } from '../../shared/url.ts'
import type { ClientTranslate } from '../command.ts'

/** One optional request option as the forms show it; empty text means the default. */
export interface OptionField<K extends string = string> {
  readonly name: string
  readonly label: K
  readonly kind: 'text' | 'url' | 'integer' | 'boolean' | 'enum'
  /** Accepted enum values on this route. */
  readonly values: readonly string[]
  readonly pattern?: RegExp
  readonly min?: number
  readonly max?: number
  /** Localized example or the default value. */
  readonly placeholder: (t: ClientTranslate<K>) => string | undefined
  /** A note below the field, such as what a special value means or a unit conversion. */
  readonly hint?: K
}

/** Editor text per field name. */
export type FieldTexts = Readonly<Record<string, string>>

/** Editor text of a stored value; empty means the default. */
export const fieldText = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`
  return JSON.stringify(value)
}

/** Whether editor text is acceptable; empty always is. */
export function isValidText<K extends string>(field: OptionField<K>, text: string): boolean {
  if (text === '') return true
  switch (field.kind) {
    case 'enum': return field.values.includes(text)
    case 'boolean': return text === 'true' || text === 'false'
    case 'integer': {
      // Canonical decimal text only: no leading zeros, no "-0", no exponent.
      if (!/^(?:0|-?[1-9]\d{0,15})$/u.test(text)) return false
      const num = Number(text)
      if (!Number.isSafeInteger(num)) return false
      if (field.min !== undefined && num < field.min) return false
      if (field.max !== undefined && num > field.max) return false
      return true
    }
    case 'url': return isEndpoint(text)
    case 'text': return field.pattern === undefined || field.pattern.test(text)
  }
}

/** Stored value of valid editor text; undefined returns the option to its default. */
export function fieldValue<K extends string>(field: OptionField<K>, text: string): unknown {
  if (text === '') return undefined
  return field.kind === 'boolean' ? text === 'true' : field.kind === 'integer' ? Number(text) : text
}

/** Options with every field's text applied; empty text removes the option. Other keys stay. */
export function applyFields<K extends string>(fields: readonly OptionField<K>[], texts: FieldTexts, stored: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...stored }
  for (const field of fields) {
    const value = fieldValue(field, texts[field.name] ?? fieldText(stored[field.name]))
    if (value === undefined) delete next[field.name]
    else next[field.name] = value
  }
  return next
}
