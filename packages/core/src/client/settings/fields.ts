import { isEndpoint } from '../../shared/url.ts'
import type { ClientTranslate } from '../command.ts'

/** One optional request option as the forms show it; empty text means the default. */
export interface OptionField<K extends string = string> {
  readonly name: string
  readonly label: K
  readonly kind: 'text' | 'url' | 'integer' | 'boolean' | 'enum' | 'list'
  /** Accepted enum values on this route. */
  readonly values: readonly string[]
  /** What a text value, or each item of a list, must match. */
  readonly pattern?: RegExp
  readonly min?: number
  readonly max?: number
  /** Most items a list holds. */
  readonly maxItems?: number
  /** Options that may not be set together with this one (catalog `exclusive`). */
  readonly exclusive?: readonly string[]
  /** Localized example or the default value. */
  readonly placeholder: (t: ClientTranslate<K>) => string | undefined
  /** A note below the field, such as what a special value means or a unit conversion. */
  readonly hint?: K
}

/**
 * A titled subset of an entry's options, such as those some model protocols
 * apply; derived from catalog data (`protocolGroups`).
 */
export interface OptionGroup {
  readonly title: string
  readonly options: readonly string[]
}

/** Editor text per field name. */
export type FieldTexts = Readonly<Record<string, string>>

/** Editor text of a stored value; empty means the default. A list is one item per line. */
export const fieldText = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join('\n')
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`
  return JSON.stringify(value)
}

/** The items of list text: one per line, blank lines ignored. */
function listLines(text: string): { readonly line: number; readonly item: string }[] {
  return text.split('\n').map((raw, index) => ({ line: index + 1, item: raw.trim() })).filter(entry => entry.item !== '')
}

/** What is wrong with list text: the first line that does not match, or too many items. */
export type ListProblem = { readonly kind: 'line'; readonly line: number; readonly item: string } | { readonly kind: 'count'; readonly max: number }

export function listProblem<K extends string>(field: OptionField<K>, text: string): ListProblem | undefined {
  const lines = listLines(text)
  const bad = lines.find(entry => field.pattern !== undefined && !field.pattern.test(entry.item))
  if (bad !== undefined) return { kind: 'line', line: bad.line, item: bad.item }
  if (field.maxItems !== undefined && lines.length > field.maxItems) return { kind: 'count', max: field.maxItems }
  return undefined
}

/** Whether editor text is acceptable; empty always is. */
export function isValidText<K extends string>(field: OptionField<K>, text: string): boolean {
  if (text === '') return true
  switch (field.kind) {
    case 'list': return listProblem(field, text) === undefined
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

/** The first other field with a value that this one, when it has a value too, may not be set with. */
export function conflictOf<K extends string>(field: OptionField<K>, fields: readonly OptionField<K>[], texts: FieldTexts): OptionField<K> | undefined {
  const exclusive = field.exclusive
  if (exclusive === undefined || !isSet(field, texts)) return undefined
  return fields.find(other => exclusive.includes(other.name) && isSet(other, texts))
}

function isSet<K extends string>(field: OptionField<K>, texts: FieldTexts): boolean {
  const text = Object.hasOwn(texts, field.name) ? texts[field.name]! : ''
  return fieldValue(field, text) !== undefined
}

/** Stored value of valid editor text; undefined returns the option to its default. */
export function fieldValue<K extends string>(field: OptionField<K>, text: string): unknown {
  if (text === '') return undefined
  switch (field.kind) {
    case 'boolean': return text === 'true'
    case 'integer': return Number(text)
    case 'list': {
      const items = listLines(text).map(entry => entry.item)
      return items.length === 0 ? undefined : items
    }
    default: return text
  }
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
