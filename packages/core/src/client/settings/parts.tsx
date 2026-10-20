/** Building blocks shared by the settings sections. */
import { useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientTranslate } from '../command.ts'
import type { SettingsLayers } from './sparse.ts'
export type SettingsClasses = Readonly<Record<string, string>>

export function classNames(...args: unknown[]): string {
  return args
    .flat(Number.POSITIVE_INFINITY)
    .filter(Boolean)
    .map(arg => {
      if (typeof arg === 'string') return arg
      if (typeof arg === 'object' && arg !== null) {
        return Object.entries(arg)
          .filter(([, v]) => Boolean(v))
          .map(([k]) => k)
          .join(' ')
      }
      return ''
    })
    .filter(Boolean)
    .join(' ')
}

/** The accepted document a section edits. */
export interface SettingsDoc<S = unknown> {
  readonly config: S
  readonly layers: SettingsLayers
  readonly revision: number
  /** Writable and in the current schema version. */
  readonly editable: boolean
}

/**
 * Submit operations fenced by a revision (default: the one the page shows);
 * resolves whether the Host accepted them. No operations is a no-op success.
 */
export type WriteSettings = (ops: readonly SettingsPathOpView[], revision?: number) => Promise<boolean>

/** A local schema failure whose diagnostic stays out of the translated message. */
export class SettingsValidationError extends Error {}

export interface WriteState {
  readonly busy: boolean
  readonly error: string | undefined
  readonly errorTitle: string | undefined
  /** Run one write, recording a refusal or a transport failure as this section's error. */
  run(work: () => Promise<boolean>): Promise<boolean>
}

export interface SelectOption<T extends string = string> { readonly id: T; readonly label: string }

export function createSettingsParts<K extends string>({ classes: css, keys }: {
  classes: SettingsClasses
  keys: Readonly<Record<'refused' | 'invalid' | 'failed', K>>
}) {
  function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
      <section className={css.section}>
        <div className={css.sectionHead}>
          <h4 className={css.sectionTitle}>{title}</h4>
          {actions}
        </div>
        {children}
      </section>
    )
  }
  
  /** Title and hint on the left, one control on the right; wraps under the text on narrow pages. */
  function SettingRow({ title, hint, children }: { title: string; hint: ReactNode; children: ReactNode }) {
    return (
      <div className={css.settingRow}>
        <div className={css.settingText}>
          <div className={css.settingTitle}>{title}</div>
          <div className={css.hint}>{hint}</div>
        </div>
        <div className={css.settingControl}>{children}</div>
      </div>
    )
  }
  
  
  
  /** A dropdown in the settings pill style, built on the shared Menu. */
  function SelectMenu<T extends string = string>({ label, title, value, options, disabled, onChange, compact = false }: {
    label: string
    /** Hover text, e.g. the upstream name of an option. */
    title?: string
    value: T
    options: readonly SelectOption<T>[]
    disabled: boolean
    onChange: (id: T) => void
    compact?: boolean
  }) {
    const [open, setOpen] = useState(false)
    const current = options.find(option => option.id === value)
    return (
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={options.map(option => ({ id: option.id, label: option.label }))}
        selectedId={value}
        onSelect={(id) => {
          setOpen(false)
          if (id !== value) onChange(id as T)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={compact ? css.selectCompact : css.select}
            aria-label={label}
            title={title}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => { setOpen(!open) }}
          >
            <span className={css.selectValue}>{current?.label ?? value}</span>
            <IconChevronDownOutlineRegular className={css.selectChevron} />
          </button>
        )}
      />
    )
  }
  
    /** Pending state and the last failure of one section's writes. */
  function useWrite(t: ClientTranslate<K>): WriteState {
    const [state, setState] = useState<{ busy: boolean; error: string | undefined; errorTitle: string | undefined }>({ busy: false, error: undefined, errorTitle: undefined })
    const run = async (work: () => Promise<boolean>): Promise<boolean> => {
      setState({ busy: true, error: undefined, errorTitle: undefined })
      try {
        const accepted = await work()
        setState({ busy: false, error: accepted ? undefined : t(keys.refused), errorTitle: undefined })
        return accepted
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const invalid = error instanceof SettingsValidationError
        setState({
          busy: false,
          error: invalid ? t(keys.invalid) : message || t(keys.failed),
          errorTitle: invalid ? message : undefined,
        })
        return false
      }
    }
    return { ...state, run }
  }
  
  function ErrorText({ children, title }: { children: string | undefined; title?: string | undefined }) {
    return children === undefined ? null : <p className={css.error} role="alert" title={title}>{children}</p>
  }
  
  /** Inline confirmation of a destructive action: the question beside cancel and confirm. */
  function ConfirmRow({ message, confirmLabel, cancelLabel, disabled, onConfirm, onCancel }: {
    message: string
    confirmLabel: string
    cancelLabel: string
    disabled: boolean
    onConfirm: () => void
    onCancel: () => void
  }) {
    return (
      <div className={css.confirmRow} role="group" aria-label={message}>
        <span className={css.confirmText}>{message}</span>
        <div className={css.actions}>
          <Button variant="ghost" size="sm" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant="outline" size="sm" className={css.danger} disabled={disabled} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    )
  }
  
  
  return { Section, SettingRow, SelectMenu, ErrorText, ConfirmRow, useWrite }
}
export type SettingsParts<K extends string> = ReturnType<typeof createSettingsParts<K>>

export function applyOps(user: unknown, ops: readonly SettingsPathOpView[]): Record<string, unknown> {
  const root = structuredClone(user !== null && typeof user === 'object' && !Array.isArray(user) ? user as Record<string, unknown> : {})
  for (const op of ops) {
    if (op.path.length === 0) continue
    if (op.op === 'set') {
      let current: Record<string, unknown> = root
      for (let i = 0; i < op.path.length - 1; i++) {
        const seg = op.path[i]!
        if (current[seg] === null || typeof current[seg] !== 'object' || Array.isArray(current[seg])) {
          current[seg] = {}
        }
        current = current[seg] as Record<string, unknown>
      }
      current[op.path.at(-1)!] = structuredClone(op.value)
    } else if (op.op === 'unset') {
      let current: Record<string, unknown> = root
      for (let i = 0; i < op.path.length - 1; i++) {
        const seg = op.path[i]!
        if (current[seg] === null || typeof current[seg] !== 'object' || Array.isArray(current[seg])) {
          break
        }
        current = current[seg] as Record<string, unknown>
      }
      delete current[op.path.at(-1)!]
    }
  }
  return root
}
