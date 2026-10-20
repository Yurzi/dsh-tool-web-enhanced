// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSettingsParts } from '../src/client/settings/parts.tsx'
import { createDefaultsSection } from '../src/client/settings/DefaultsSection.tsx'
import { createRouteNotice } from '../src/client/settings/RouteNotice.tsx'
import { createOptionsEditor } from '../src/client/settings/OptionsEditor.tsx'
import { createSparseSettings } from '../src/client/settings/sparse.ts'
import type { OptionField } from '../src/client/settings/fields.ts'

const t = (key: string, params: Record<string, string | number> = {}) => key + (params.name === undefined ? '' : ': ' + params.name)
const parts = createSettingsParts<string>({ classes: { section: 'consumer-section' }, keys: { refused: 'fetch.refused', invalid: 'fetch.invalid', failed: 'fetch.failed' } })
const sparse = createSparseSettings({ version: 2, fields: ['version', 'defaultConnection', 'connections'] })
afterEach(cleanup)

describe('settings skeleton with consumer copy and styles', () => {
  it('renders a capability default and its custom controls without a core dictionary', () => {
    const Defaults = createDefaultsSection({ parts, sparse, keys: { title: 'fetch.defaults', connection: 'fetch.connection', connectionHint: 'fetch.hint', connectionUnset: 'fetch.unset', connectionMissing: 'fetch.missing' } })
    const result = render(<Defaults doc={{ config: {}, layers: {}, revision: 1, editable: true }} write={async () => true} t={t}
      defaultConnection={undefined} defaultLabel="Local HTTP" choices={[{ id: 'builtin:local', label: 'Local HTTP' }]}>
      {({ disabled }) => <button disabled={disabled}>Local allowlist</button>}
    </Defaults>)
    expect(result.container.querySelector('.consumer-section')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'fetch.connection' }).textContent).toContain('fetch.unset: Local HTTP')
    expect(screen.getByRole('button', { name: 'Local allowlist' }).hasAttribute('disabled')).toBe(false)
  })

  it('uses injected route keys and classes for a different capability', () => {
    const Notice = createRouteNotice({ classes: { warning: 'fetch-warning' }, keys: { unknown: 'fetch.unknown', auto: 'fetch.auto', other: 'fetch.other' } })
    const { rerender } = render(<Notice route={{ kind: 'unknown' }} t={t} />)
    expect(screen.getByRole('status').className).toBe('fetch-warning')
    expect(screen.getByRole('status').textContent).toBe('fetch.unknown')
    rerender(<Notice route={{ kind: 'this' }} t={t} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('commits a zero-valued numeric option through the shared editor', async () => {
    const { OptionsForm } = createOptionsEditor<string>({ classes: {}, parts, keys: { 'options.default': 'fetch.default', 'options.invalid': 'fetch.invalid' }, valueLabel: value => value })
    const field: OptionField = { name: 'maxRedirects', label: 'fetch.redirects', kind: 'integer', min: 0, max: 20, values: [], placeholder: () => undefined }
    const writes: [string, unknown][] = []
    render(<OptionsForm id="fetch-options" title="Limits" hint="" fields={[field]} stored={{ maxRedirects: 5 }} disabled={false} t={t}
      onCommit={async (name, value) => { writes.push([name, value]); return true }} />)
    const input = screen.getByLabelText('fetch.redirects')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    await waitFor(() => { expect(writes).toEqual([['maxRedirects', 0]]) })
  })
})
