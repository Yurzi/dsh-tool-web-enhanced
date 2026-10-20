// @vitest-environment jsdom
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AllowlistEditor, type AllowlistEditorProps } from '../src/client/settings/AllowlistEditor.tsx'
import { en, zh } from '../src/client/locales.ts'
import { SettingsValidationError } from 'dsh-tool-web-enhanced-core/client'
import type { Translate } from '../src/client/connections.ts'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const t: Translate = (key, params) => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}

const tZh: Translate = (key, params) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}

afterEach(cleanup)

function mount(overrides: Partial<AllowlistEditorProps> = {}) {
  const write = vi.fn<AllowlistEditorProps['write']>().mockResolvedValue(true)
  const props: AllowlistEditorProps = { allowCidrs: [], allowHostnames: [], disabled: false, revision: 0, write, t, ...overrides }
  const view = render(<AllowlistEditor {...props} />)
  return {
    ...view, write,
    cidrs: screen.getByLabelText<HTMLTextAreaElement>(en['allowlist.allowCidrs']),
    hostnames: screen.getByLabelText<HTMLTextAreaElement>(en['allowlist.allowHostnames']),
    update: (next: Partial<AllowlistEditorProps>) => view.rerender(<AllowlistEditor {...props} {...next} />),
  }
}

function saveButton() {
  return screen.getByRole<HTMLButtonElement>('button', { name: en['allowlist.save'] })
}

async function save() {
  await act(async () => { fireEvent.click(saveButton()) })
}

describe('allowlist explicit-save editor', () => {
  it('renders primitive action buttons with primary and ghost variants and proper disabled states', () => {
    mount()
    const saveBtn = saveButton()
    const resetBtn = screen.getByRole<HTMLButtonElement>('button', { name: en['allowlist.reset'] })
    expect(saveBtn.disabled).toBe(true)
    expect(resetBtn.disabled).toBe(true)
    expect(saveBtn.className).toMatch(/primary/)
    expect(resetBtn.className).toMatch(/ghost/)
  })

  it('does not write on mount, typing, or blur; warnings can be explicitly saved together', async () => {
    const view = mount()
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(view.cidrs, { target: { value: ' \n 0.0.0.0/0 \n\n' } })
    fireEvent.change(view.hostnames, { target: { value: ' *.Example.com \nwiki.example.com\n' } })
    fireEvent.blur(view.cidrs)
    fireEvent.blur(view.hostnames)
    expect(view.write).not.toHaveBeenCalled()
    expect(screen.getByText(en['allowlist.warning.metadata'], { exact: false })).toBeTruthy()
    expect(screen.getByText(en['allowlist.warning.loopback'], { exact: false })).toBeTruthy()
    expect(screen.getByText(en['allowlist.warning.broad'], { exact: false })).toBeTruthy()
    expect(view.cidrs.getAttribute('aria-invalid')).toBe('false')
    expect(saveButton().disabled).toBe(false)
    await save()
    expect(view.write).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: ['0.0.0.0/0'] },
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowHostnames'], value: ['*.Example.com', 'wiki.example.com'] },
    ], 0)
    expect(view.cidrs.value).toBe('0.0.0.0/0')
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toBe(en['allowlist.saved'])
  })

  it('blocks either-field errors, reports physical lines, and offers opt-in corrections', async () => {
    const view = mount()
    fireEvent.change(view.cidrs, { target: { value: '\n198.18.1.1/15\n' } })
    fireEvent.change(view.hostnames, { target: { value: 'https://Wiki.Example.com/page' } })
    expect(saveButton().disabled).toBe(true)
    expect(view.cidrs.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Line 2:', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('allowlist.applyFix', { fix: '198.18.0.0/15' }) }))
    expect(view.cidrs.value).toBe('\n198.18.0.0/15\n')
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: t('allowlist.applyFix', { fix: 'wiki.example.com' }) }))
    expect(view.hostnames.value).toBe('wiki.example.com')
    expect(view.write).not.toHaveBeenCalled()
    await save()
    expect(view.write).toHaveBeenCalledTimes(1)
  })

  it('blocks normalized duplicates until explicitly removed', async () => {
    const view = mount()
    fireEvent.change(view.hostnames, { target: { value: 'Example.com\n\nexample.COM.' } })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByText(en['allowlist.duplicate'].replace('{line}', '1'), { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['allowlist.removeDuplicate'] }))
    expect(view.hostnames.value).toBe('Example.com\n\n')
    expect(view.write).not.toHaveBeenCalled()
    await save()
    expect(view.write).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: [] },
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowHostnames'], value: ['Example.com'] },
    ], 0)
  })

  it('clears both arrays with explicit empty sets, not deletes or implicit defaults', async () => {
    const view = mount({ allowCidrs: ['10.0.0.0/8'], allowHostnames: ['localhost'] })
    fireEvent.change(view.cidrs, { target: { value: '\n ' } })
    fireEvent.change(view.hostnames, { target: { value: '' } })
    await save()
    expect(view.write).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: [] },
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowHostnames'], value: [] },
    ], 0)
  })

  it('keeps a refused write visible and retains the draft for retry', async () => {
    const view = mount()
    view.write.mockResolvedValueOnce(false)
    fireEvent.change(view.cidrs, { target: { value: '198.18.0.0/15' } })
    await save()
    expect(screen.getByRole('alert').textContent).toBe(en['settings.refused'])
    expect(view.cidrs.value).toBe('198.18.0.0/15')
    expect(saveButton().disabled).toBe(false)
    await save()
    expect(view.write).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('presents a rejected validation write with details in the title only', async () => {
    const view = mount()
    view.write.mockRejectedValueOnce(new SettingsValidationError('sensitive validation detail'))
    fireEvent.change(view.hostnames, { target: { value: 'localhost' } })
    await save()
    expect(screen.getByRole('alert').textContent).toBe(en['settings.invalid'])
    expect(screen.getByRole('alert').title).toBe('sensitive validation detail')
    expect(view.container.textContent).not.toContain('sensitive validation detail')
    expect(view.hostnames.value).toBe('localhost')
    expect(saveButton().disabled).toBe(false)
  })

  it('clears a previous write failure when edits are discarded', async () => {
    const view = mount()
    view.write.mockResolvedValueOnce(false)
    fireEvent.change(view.cidrs, { target: { value: '198.18.0.0/15' } })
    await save()
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['allowlist.reset'] }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('locks textareas and every action during a pending write', async () => {
    const view = mount()
    const pending = Promise.withResolvers<boolean>()
    view.write.mockReturnValueOnce(pending.promise)
    fireEvent.change(view.cidrs, { target: { value: '198.18.0.0/15' } })
    fireEvent.click(saveButton())
    expect(view.cidrs.disabled).toBe(true)
    expect(view.hostnames.disabled).toBe(true)
    expect([...view.container.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
    expect(screen.getByRole('button', { name: en['allowlist.saving'] })).toBeTruthy()
    await act(async () => { pending.resolve(true); await pending.promise })
    expect(view.cidrs.disabled).toBe(false)
    expect(saveButton().disabled).toBe(true)
  })

  it('obeys parent read-only status, including fix actions', () => {
    const view = mount({ allowCidrs: ['10.0.0.1/8'], disabled: true })
    expect(view.cidrs.disabled).toBe(true)
    expect(view.hostnames.disabled).toBe(true)
    expect([...view.container.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
    expect(view.write).not.toHaveBeenCalled()
  })

  it('preserves both draft fields on external updates; reset uses the latest settings', () => {
    const view = mount({ allowCidrs: ['10.0.0.0/8'] })
    fireEvent.change(view.cidrs, { target: { value: '198.18.0.0/15' } })
    view.update({ allowCidrs: ['192.168.0.0/16'], allowHostnames: ['new.example.com'] })
    expect(view.cidrs.value).toBe('198.18.0.0/15')
    expect(view.hostnames.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: en['allowlist.reset'] }))
    expect(view.cidrs.value).toBe('192.168.0.0/16')
    expect(view.hostnames.value).toBe('new.example.com')
    expect(saveButton().disabled).toBe(true)
    expect(view.write).not.toHaveBeenCalled()
  })

  it('fences a dirty draft with its first-edit revision even after external settings pushes', async () => {
    const view = mount({ revision: 5, allowHostnames: ['original.example.com'] })
    fireEvent.change(view.cidrs, { target: { value: '198.18.0.0/15' } })
    view.update({ revision: 6, allowHostnames: ['external.example.com'] })
    fireEvent.change(view.cidrs, { target: { value: '10.0.0.0/8' } })
    view.write.mockResolvedValueOnce(false)
    await save()
    expect(view.write).toHaveBeenLastCalledWith([
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: ['10.0.0.0/8'] },
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowHostnames'], value: ['original.example.com'] },
    ], 5)
    expect(view.hostnames.value).toBe('original.example.com')
    await save()
    expect(view.write.mock.calls[1]?.[1]).toBe(5)
  })

  it('captures the current revision after discarding a stale draft', async () => {
    const view = mount({ revision: 5 })
    fireEvent.change(view.cidrs, { target: { value: '198.18.0.0/15' } })
    view.update({ revision: 6, allowHostnames: ['external.example.com'] })
    fireEvent.click(screen.getByRole('button', { name: en['allowlist.reset'] }))
    fireEvent.change(view.cidrs, { target: { value: '10.0.0.0/8' } })
    await save()
    expect(view.write).toHaveBeenLastCalledWith([
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: ['10.0.0.0/8'] },
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowHostnames'], value: ['external.example.com'] },
    ], 6)
  })

  it('refreshes pristine fields and captures the latest revision on first edit', async () => {
    const view = mount({ revision: 1 })
    view.update({ revision: 2, allowCidrs: ['198.18.0.0/15'], allowHostnames: ['external.example.com'] })
    expect(view.cidrs.value).toBe('198.18.0.0/15')
    expect(view.hostnames.value).toBe('external.example.com')
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(view.cidrs, { target: { value: '10.0.0.0/8' } })
    await save()
    expect(view.write.mock.calls[0]?.[1]).toBe(2)
  })

  it('renders labels and diagnostics through the injected package translation', () => {
    render(<AllowlistEditor allowCidrs={['127.0.0.0/8']} allowHostnames={['a.*.example.com']} disabled={false} revision={0} write={async () => true} t={tZh} />)
    expect(screen.getByLabelText(zh['allowlist.allowCidrs'])).toBeTruthy()
    expect(screen.getByText(zh['allowlist.warning.loopback'], { exact: false })).toBeTruthy()
    expect(screen.getByText(zh['allowlist.problem.wildcard'], { exact: false })).toBeTruthy()
  })
})
