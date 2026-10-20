/** Optional request options: labelled inputs over editor text, and a self-saving form around them. */
import { useState, type KeyboardEvent } from 'react'
import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientTranslate } from '../command.ts'
import { fieldText, fieldValue, isValidText, type OptionField, type FieldTexts } from './fields.ts'
import type { SettingsClasses, SettingsParts } from './parts.tsx'

export function createOptionsEditor<K extends string>({ classes: css, keys, parts: { SelectMenu }, valueLabel }: {
  classes: SettingsClasses
  keys: Readonly<Record<'options.default' | 'options.invalid', K>>
  parts: SettingsParts<K>
  valueLabel: (value: string, t: ClientTranslate<K>) => string
}) {
  /**
   * A grid of option inputs; empty text means the default. `onSettle` marks
   * a finished edit: a choice from a menu at once, typed text on blur or Enter.
   */
  function OptionFields({ id, fields, texts, disabled, onEdit, onSettle, t }: {
    id: string
    fields: readonly OptionField<K>[]
    texts: FieldTexts
    disabled: boolean
    onEdit: (name: string, text: string) => void
    onSettle?: (name: string, text: string) => void
    t: ClientTranslate<K>
  }) {
    return (
      <div className={css.optionGrid}>
        {fields.map(field => (
          <OptionInput
            key={field.name}
            id={id + '-' + field.name}
            field={field}
            text={texts[field.name] ?? ''}
            disabled={disabled}
            t={t}
            onEdit={text => onEdit(field.name, text)}
            onSettle={text => onSettle?.(field.name, text)}
          />
        ))}
      </div>
    )
  }
  
  function OptionInput({ id, field, text, disabled, onEdit, onSettle, t }: {
    id: string
    field: OptionField<K>
    text: string
    disabled: boolean
    onEdit: (text: string) => void
    onSettle: (text: string) => void
    t: ClientTranslate<K>
  }) {
    const label = t(field.label)
  
    if (field.kind === 'boolean') {
      return (
        <div className={css.option}>
          <span className={css.optionName}>{label}</span>
          <div className={css.optionBoolean}>
            <Switch
              checked={text === 'true'}
              disabled={disabled}
              label={label}
              onChange={(checked) => {
                const next = checked ? 'true' : 'false'
                onEdit(next)
                onSettle(next)
              }}
            />
          </div>
        </div>
      )
    }
  
    if (field.kind === 'text' || field.kind === 'url' || field.kind === 'integer') {
      const invalid = !isValidText(field, text)
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
            aria-invalid={invalid}
            spellCheck={false}
            title={field.name}
            inputMode={field.kind === 'integer' ? 'numeric' : undefined}
            placeholder={field.placeholder(t) ?? t(keys['options.default'])}
            onChange={event => { onEdit(event.target.value.trim() === '' ? '' : event.target.value) }}
            onBlur={() => { onSettle(text) }}
            onKeyDown={settleOnEnter}
          />
          {invalid ? <span className={css.fieldError}>{t(keys['options.invalid'])}</span> : null}
        </div>
      )
    }
  
    const choices = field.values.map(value => ({ id: value, label: valueLabel(value, t) }))
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
      </div>
    )
  }
  
  /**
   * Options that save themselves, one path per option: a menu choice at once,
   * typed text once it settles and is valid. An invalid draft stays visible with
   * its error; nothing valid is ever held back.
   */
  function OptionsForm({ id, title, hint, fields, stored, disabled, onCommit, t }: {
    id: string
    title: string
    hint: string
    fields: readonly OptionField<K>[]
    stored: Readonly<Record<string, unknown>>
    disabled: boolean
    onCommit: (name: string, value: unknown) => Promise<boolean>
    t: ClientTranslate<K>
  }) {
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    if (fields.length === 0) return null
    const texts: FieldTexts = Object.fromEntries(fields.map(field => [field.name, drafts[field.name] ?? fieldText(stored[field.name])]))
  
    const forget = (name: string) => {
      setDrafts(({ [name]: _settled, ...rest }) => rest)
    }
  
    const settle = async (name: string, text: string): Promise<void> => {
      const field = fields.find(candidate => candidate.name === name)
      if (!field || !isValidText(field, text)) return
      if (text === fieldText(stored[name])) return forget(name)
      if (await onCommit(name, fieldValue(field, text))) forget(name)
    }
    return (
      <div className={css.field}>
        <div className={css.fieldHead}><span className={css.fieldLabel}>{title}</span></div>
        <OptionFields
          id={id}
          fields={fields}
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
