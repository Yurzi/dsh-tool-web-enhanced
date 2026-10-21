/** Optional request options: labelled inputs over editor text, and a self-saving form around them. */
import { useState, type KeyboardEvent } from 'react'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientTranslate } from '../command.ts'
import { conflictOf, fieldText, fieldValue, isValidText, listProblem, type OptionField, type OptionGroup, type FieldTexts } from './fields.ts'
import { classNames, type SettingsClasses, type SettingsParts } from './parts.tsx'

/**
 * `options.invalidItem` names a refused list line (`{line}`, `{item}`);
 * `options.invalidLine` is kept for dictionaries that still carry it;
 * `options.exclusive` names the option (`{other}`) that may not be set too.
 */
export type OptionsCopyKey = 'options.default' | 'options.invalid' | 'options.invalidLine' | 'options.invalidItem' | 'options.tooMany' | 'options.exclusive' | 'options.on' | 'options.off'

/** How much of a refused list item the error quotes. */
const QUOTED_ITEM = 40

export type { OptionGroup } from './fields.ts'

export function createOptionsEditor<K extends string>({ classes: css, keys, parts: { SelectMenu }, valueLabel }: {
  classes: SettingsClasses
  keys: Readonly<Record<OptionsCopyKey, K>>
  parts: SettingsParts<K>
  valueLabel: (value: string, t: ClientTranslate<K>) => string
}) {
  /**
   * A grid of option inputs; empty text means the default. \`onSettle\` marks
   * a finished edit: a choice from a menu at once, typed text on blur or Enter
   * (a list, typed one item per line, on blur). With \`groups\`, options outside
   * every group come first, then each group under its title. Two options the
   * catalog declares exclusive are both marked while both have a value.
   */
  function OptionFields({ id, fields, groups, texts, disabled, onEdit, onSettle, t }: {
    id: string
    fields: readonly OptionField<K>[]
    groups?: readonly OptionGroup[] | undefined
    texts: FieldTexts
    disabled: boolean
    onEdit: (name: string, text: string) => void
    onSettle?: (name: string, text: string) => void
    t: ClientTranslate<K>
  }) {
    const grid = (subset: readonly OptionField<K>[]) => (
      <div className={css.optionGrid}>
        {subset.map(field => (
          <OptionInput
            key={field.name}
            id={id + '-' + field.name}
            field={field}
            text={texts[field.name] ?? ''}
            conflict={conflictOf(field, fields, texts)}
            disabled={disabled}
            t={t}
            onEdit={text => onEdit(field.name, text)}
            onSettle={text => onSettle?.(field.name, text)}
          />
        ))}
      </div>
    )
    if (groups === undefined) return grid(fields)
    const grouped = new Set(groups.flatMap(group => group.options))
    const loose = fields.filter(field => !grouped.has(field.name))
    return (
      <>
        {loose.length === 0 ? null : grid(loose)}
        {groups.map(group => {
          const subset = group.options.flatMap(name => fields.filter(field => field.name === name))
          if (subset.length === 0) return null
          return (
            <div key={group.title} className={css.optionGroup} role="group" aria-label={group.title}>
              <span className={css.optionGroupTitle}>{group.title}</span>
              {grid(subset)}
            </div>
          )
        })}
      </>
    )
  }

  /** Why the text is refused: a list names its first bad line or its item limit; a valid value names the option it conflicts with. */
  function problemText(field: OptionField<K>, text: string, conflict: OptionField<K> | undefined, t: ClientTranslate<K>): string | undefined {
    if (isValidText(field, text)) return conflict === undefined ? undefined : t(keys['options.exclusive'], { other: t(conflict.label) })
    if (field.kind !== 'list') return t(keys['options.invalid'])
    const problem = listProblem(field, text)
    if (problem === undefined) return t(keys['options.invalid'])
    if (problem.kind === 'count') return t(keys['options.tooMany'], { max: problem.max })
    const chars = Array.from(problem.item)
    const item = chars.length > QUOTED_ITEM ? chars.slice(0, QUOTED_ITEM).join('') + '…' : problem.item
    return t(keys['options.invalidItem'], { line: problem.line, item })
  }

  function OptionInput({ id, field, text, conflict, disabled, onEdit, onSettle, t }: {
    id: string
    field: OptionField<K>
    text: string
    /** The option this one may not be set together with, while both have a value. */
    conflict: OptionField<K> | undefined
    disabled: boolean
    onEdit: (text: string) => void
    onSettle: (text: string) => void
    t: ClientTranslate<K>
  }) {
    const label = t(field.label)
    const hintId = id + '-hint'
    const errorId = id + '-error'
    const hint = field.hint === undefined ? null : <span className={css.hint} id={hintId}>{t(field.hint)}</span>
    const problem = problemText(field, text, conflict, t)
    const error = problem === undefined ? null : <span className={css.fieldError} id={errorId}>{problem}</span>
    // The error, then the hint: what is wrong is read before what the field is for.
    const describedBy = [problem === undefined ? undefined : errorId, hint === null ? undefined : hintId].filter(part => part !== undefined).join(' ')
    const description = describedBy === '' ? undefined : describedBy

    if (field.kind === 'list') {
      return (
        <div className={classNames(css.option, css.optionWide)}>
          <label className={css.optionName} htmlFor={id}>{label}</label>
          <textarea
            id={id}
            className={css.textarea}
            rows={3}
            value={text}
            disabled={disabled}
            aria-invalid={problem !== undefined}
            aria-describedby={description}
            spellCheck={false}
            title={field.name}
            placeholder={field.placeholder(t) ?? t(keys['options.default'])}
            onChange={event => { onEdit(event.target.value.trim() === '' ? '' : event.target.value) }}
            onBlur={() => { onSettle(text) }}
          />
          {error}
          {hint}
        </div>
      )
    }

    if (field.kind === 'text' || field.kind === 'url' || field.kind === 'integer') {
      const settleOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
        event.preventDefault()
        onSettle(text)
      }
      return (
        <div className={css.option}>
          <label className={css.optionName} htmlFor={id}>{label}</label>
          <Input
            id={id}
            className={css.input as string}
            type={field.kind === 'url' ? 'url' : 'text'}
            value={text}
            disabled={disabled}
            aria-invalid={problem !== undefined}
            aria-describedby={description}
            spellCheck={false}
            title={field.name}
            inputMode={field.kind === 'integer' ? 'numeric' : undefined}
            placeholder={field.placeholder(t) ?? t(keys['options.default'])}
            onChange={event => { onEdit(event.target.value.trim() === '' ? '' : event.target.value) }}
            onBlur={() => { onSettle(text) }}
            onKeyDown={settleOnEnter}
          />
          {error}
          {hint}
        </div>
      )
    }

    // Unset is the service's own default, which the catalog does not claim to know; a boolean is no exception.
    const choices = field.kind === 'boolean'
      ? [{ id: 'true', label: t(keys['options.on']) }, { id: 'false', label: t(keys['options.off']) }]
      : field.values.map(value => ({ id: value, label: valueLabel(value, t) }))
    return (
      <div className={css.option}>
        <span className={css.optionName}>{label}</span>
        <SelectMenu
          compact
          label={label}
          title={field.name}
          value={text}
          disabled={disabled}
          options={[{ id: '', label: t(keys['options.default']) }, ...choices]}
          onChange={choice => {
            onEdit(choice)
            onSettle(choice)
          }}
        />
        {error}
        {hint}
      </div>
    )
  }

  /**
   * Options that save themselves, one path per option: a menu choice at once,
   * typed text once it settles and is valid. An invalid draft, or one that
   * conflicts with an exclusive option, stays visible with its error and is not
   * written; once the conflict is cleared, the held draft saves too.
   */
  function OptionsForm({ id, title, hint, fields, groups, stored, disabled, onCommit, t }: {
    id: string
    title: string
    hint: string
    fields: readonly OptionField<K>[]
    groups?: readonly OptionGroup[] | undefined
    stored: Readonly<Record<string, unknown>>
    disabled: boolean
    /** Settled option changes, written atomically under one settings revision. */
    onCommit: (changes: Readonly<Record<string, unknown>>) => Promise<boolean>
    t: ClientTranslate<K>
  }) {
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    if (fields.length === 0) return null
    const texts: FieldTexts = Object.fromEntries(fields.map(field => [field.name, drafts[field.name] ?? fieldText(stored[field.name])]))

    const settle = async (name: string, text: string): Promise<void> => {
      const field = fields.find(candidate => candidate.name === name)
      if (!field) return
      const current = { ...texts, [name]: text }
      const valid = (candidate: OptionField<K>) => isValidText(candidate, current[candidate.name]!) && conflictOf(candidate, fields, current) === undefined
      if (!valid(field)) return
      // Clearing one option can release a held draft. Validate and write both
      // together, never through successive writes using the same old revision.
      const released = fields.filter(candidate => field.exclusive?.includes(candidate.name) && Object.hasOwn(drafts, candidate.name) && valid(candidate))
      const settled = [field, ...released]
      const changes = Object.fromEntries(settled
        .map(candidate => [candidate.name, fieldValue(candidate, current[candidate.name]!)] as const)
        .filter(([option, value]) => fieldText(value) !== fieldText(stored[option])))
      if (Object.keys(changes).length > 0 && !await onCommit(changes)) return
      const names = new Set(settled.map(candidate => candidate.name))
      setDrafts(previous => Object.fromEntries(Object.entries(previous).filter(([option]) => !names.has(option))))
    }
    return (
      <div className={css.field}>
        <div className={css.fieldHead}><span className={css.fieldLabel}>{title}</span></div>
        <OptionFields
          id={id}
          fields={fields}
          groups={groups}
          texts={texts}
          disabled={disabled}
          t={t}
          onEdit={(name, text) => { setDrafts(current => ({ ...current, [name]: text })) }}
          onSettle={(name, text) => { void settle(name, text) }}
        />
        <p className={css.hint}>{hint}</p>
      </div>
    )
  }
  return { OptionFields, OptionsForm }
}
export type OptionsEditor<K extends string> = ReturnType<typeof createOptionsEditor<K>>
