import { useId, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WriteSettings } from 'dsh-tool-web-enhanced-core/client'
import type { Translate } from '../connections.ts'
import { readAllowlist, replaceLine, type AllowlistField, type AllowlistReading, type LineNote } from '../allowlist-lines.ts'
import { useWrite, ErrorText } from './parts.tsx'
import css from './Allowlist.module.css'

export interface AllowlistEditorProps {
  readonly allowCidrs: readonly string[]
  readonly allowHostnames: readonly string[]
  readonly disabled: boolean
  readonly revision: number
  readonly write: WriteSettings
  readonly t: Translate
}

function noteText(note: LineNote, t: Translate): string {
  switch (note.kind) {
    case 'duplicate': return t('allowlist.duplicate', { line: note.of })
    case 'warning': return t(`allowlist.warning.${note.warning}`)
    case 'problem': {
      const problem = note.problem
      return t(`allowlist.problem.${problem.code}`, 'fix' in problem ? { fix: problem.fix } : {})
    }
  }
}

function RuleField({ field, text, reading, disabled, onChange, t }: {
  field: AllowlistField
  text: string
  reading: AllowlistReading
  disabled: boolean
  onChange: (text: string) => void
  t: Translate
}) {
  const id = useId()
  const hint = field === 'allowCidrs' ? 'allowlist.cidrsHint' : 'allowlist.hostnamesHint'
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={id}>{t(field === 'allowCidrs' ? 'allowlist.allowCidrs' : 'allowlist.allowHostnames')}</label>
      <p id={id + '-hint'} className={css.hint}>{t(hint)}</p>
      <textarea
        id={id}
        className={css.textarea}
        rows={7}
        value={text}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={reading.values === undefined}
        aria-describedby={id + '-hint ' + id + '-reports'}
        onChange={event => onChange(event.currentTarget.value)}
      />
      <ul id={id + '-reports'} className={css.reports} aria-live="polite">
        {reading.reports.map((report, index) => {
          const { note } = report
          const fix = note.kind === 'problem' && 'fix' in note.problem ? note.problem.fix : undefined
          return (
            <li key={report.line + '-' + index} className={note.kind === 'warning' ? css.warning : css.error}>
              <span>{t('allowlist.line', { line: report.line })}: <code>{report.text}</code> — {noteText(note, t)}</span>
              {fix !== undefined && <button type="button" className={css.fix} disabled={disabled} onClick={() => onChange(replaceLine(text, report.line, fix))}>{t('allowlist.applyFix', { fix })}</button>}
              {note.kind === 'duplicate' && <button type="button" className={css.fix} disabled={disabled} onClick={() => onChange(replaceLine(text, report.line, ''))}>{t('allowlist.removeDuplicate')}</button>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Edits stay local until one explicit, atomic write of both allowlist arrays. */
export function AllowlistEditor({ allowCidrs, allowHostnames, disabled, revision, write, t }: AllowlistEditorProps) {
  const sourceCidrs = allowCidrs.join('\n')
  const sourceHostnames = allowHostnames.join('\n')
  const [observed, setObserved] = useState({ cidrs: sourceCidrs, hostnames: sourceHostnames, revision })
  const [draft, setDraft] = useState({ cidrs: sourceCidrs, hostnames: sourceHostnames, baselineCidrs: sourceCidrs, baselineHostnames: sourceHostnames, revision })
  const action = useWrite(t)
  const { busy } = action
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle')

  const dirty = draft.cidrs !== draft.baselineCidrs || draft.hostnames !== draft.baselineHostnames
  // A settings push may refresh a pristine editor, never an in-progress draft.
  if (observed.cidrs !== sourceCidrs || observed.hostnames !== sourceHostnames || observed.revision !== revision) {
    setObserved({ cidrs: sourceCidrs, hostnames: sourceHostnames, revision })
    if (!dirty) {
      setDraft({ cidrs: sourceCidrs, hostnames: sourceHostnames, baselineCidrs: sourceCidrs, baselineHostnames: sourceHostnames, revision })
      setStatus('idle')
    }
  }

  const cidrs = readAllowlist('allowCidrs', draft.cidrs)
  const hostnames = readAllowlist('allowHostnames', draft.hostnames)
  const locked = disabled || busy

  function change(field: 'cidrs' | 'hostnames', text: string) {
    setDraft(previous => ({ ...previous, [field]: text, revision: dirty ? previous.revision : revision }))
    setStatus('idle')
  }

  async function save() {
    if (locked || !dirty || cidrs.values === undefined || hostnames.values === undefined) return
    const cidrValues = [...cidrs.values]
    const hostnameValues = [...hostnames.values]
    setStatus('idle')
    const accepted = await action.run(() => write([
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: cidrValues },
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowHostnames'], value: hostnameValues },
    ], draft.revision))
    if (accepted) {
      const cidrsText = cidrValues.join('\n')
      const hostnamesText = hostnameValues.join('\n')
      setDraft({ cidrs: cidrsText, hostnames: hostnamesText, baselineCidrs: cidrsText, baselineHostnames: hostnamesText, revision: draft.revision })
      setStatus('saved')
    } else {
      setStatus('failed')
    }
  }

  return (
    <section className={css.editor} aria-label={t('allowlist.title')} aria-busy={busy}>
      <h4 className={css.title}>{t('allowlist.title')}</h4>
      <p className={css.hint}>{t('allowlist.description')}</p>
      <div className={css.fields}>
        <RuleField field="allowCidrs" text={draft.cidrs} reading={cidrs} disabled={locked} onChange={text => change('cidrs', text)} t={t} />
        <RuleField field="allowHostnames" text={draft.hostnames} reading={hostnames} disabled={locked} onChange={text => change('hostnames', text)} t={t} />
      </div>
      <div className={css.actions}>
        <Button
          type="button"
          variant="primary"
          disabled={locked || !dirty || cidrs.values === undefined || hostnames.values === undefined}
          onClick={() => { void save() }}
        >
          {t(busy ? 'allowlist.saving' : 'allowlist.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={locked || !dirty}
          onClick={() => {
            setDraft({ cidrs: sourceCidrs, hostnames: sourceHostnames, baselineCidrs: sourceCidrs, baselineHostnames: sourceHostnames, revision })
            setStatus('idle')
          }}
        >
          {t('allowlist.reset')}
        </Button>
      </div>
      <ErrorText title={action.errorTitle}>{status === 'failed' ? action.error : undefined}</ErrorText>
      {status === 'saved' && <p role="status" className={css.success}>{t('allowlist.saved')}</p>}
    </section>
  )
}
