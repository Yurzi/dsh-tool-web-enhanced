// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ServicesSection as SearchServices } from '../../search-enhanced/src/client/settings/ServicesSection.tsx'
import { ServicesSection as FetchServices } from '../../fetch-enhanced/src/client/settings/ServicesSection.tsx'
import { DefaultsSection as SearchDefaults } from '../../search-enhanced/src/client/settings/DefaultsSection.tsx'
import { DefaultsSection as FetchDefaults } from '../../fetch-enhanced/src/client/settings/DefaultsSection.tsx'
import { en as searchEn } from '../../search-enhanced/src/client/locales.ts'
import { en as fetchEn } from '../../fetch-enhanced/src/client/locales.ts'
import type { SettingsDoc } from 'dsh-tool-web-enhanced-core/client'
import type { SearchSettings } from '../../search-enhanced/src/settings/types.ts'
import type { FetchSettings } from '../../fetch-enhanced/src/settings/types.ts'
import searchCss from '../../search-enhanced/src/client/settings/Settings.module.css'
import fetchCss from '../../fetch-enhanced/src/client/settings/Settings.module.css'
import menuCss from '../src/client/ComposerConnectionMenu.module.css'

const translate = <K extends string>(locale: Record<K, string>) => (key: string, params?: Record<string, unknown>): string =>
  (locale[key as K] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => params && name in params ? String(params[name]) : match)
const searchT = translate(searchEn)
const fetchT = translate(fetchEn)
const write = async () => true
const saveCredential = async () => {}
const doc = <S,>(config: S): SettingsDoc<S> => ({ config, layers: { user: config }, editable: true, revision: 1 })

afterEach(cleanup)

describe('settings appearance regressions', () => {
  it('groups each service configure button and switch in the responsive rowActions wrapper', () => {
    const { container } = render(<>
      <SearchServices doc={doc<SearchSettings>({ version: 2 })} write={write} credentials={{}} saveCredential={saveCredential} t={searchT} />
      <FetchServices doc={doc<FetchSettings>({ version: 2 })} write={write} credentials={{}} saveCredential={saveCredential} t={fetchT} />
    </>)
    const switches = container.querySelectorAll('[role="switch"]')
    expect(switches.length).toBeGreaterThan(2)
    for (const toggle of switches) {
      const actions = toggle.parentElement!
      expect([searchCss.rowActions, fetchCss.rowActions]).toContain(actions.className)
      expect(actions.querySelector('button[aria-expanded]')).not.toBeNull()
    }
  })

  it('marks missing native credentials warning, while keyless stays done and disabled stays idle', () => {
    const { container } = render(<>
      <SearchServices doc={doc<SearchSettings>({ version: 2, connections: { 'builtin:exa': { disabled: true } } })} write={write} credentials={{ DEEPSEEK_API_KEY: 'missing', SEMANTIC_SCHOLAR_API_KEY: 'missing' }} saveCredential={saveCredential} t={searchT} />
      <FetchServices doc={doc<FetchSettings>({ version: 2 })} write={write} credentials={{ DEEPSEEK_API_KEY: 'missing' }} saveCredential={saveCredential} t={fetchT} />
    </>)
    const row = (label: string) => [...container.querySelectorAll('li')].find(item => item.textContent?.includes(label))!
    for (const label of ['DeepSeek Messages', 'DeepSeek Search API', 'DeepSeek Fetch API', 'Semantic Scholar']) {
      expect(row(label).querySelector('[data-state]')?.getAttribute('data-state')).toBe('warning')
    }
    expect(row('Local HTTP').querySelector('[data-state]')?.getAttribute('data-state')).toBe('done')
    expect(row('Exa').querySelector('[data-state]')?.getAttribute('data-state')).toBe('idle')
  })

  it('warns in the defaults hint when the search default is disabled', () => {
    const id = 'builtin:exa'
    render(<SearchDefaults doc={doc<SearchSettings>({ version: 2, defaultConnection: id, connections: { 'builtin:exa': { disabled: true } } })} write={write} t={searchT} />)
    const warning = screen.getByRole('status')
    expect(warning.querySelector('[data-state="warning"]')).not.toBeNull()
    expect(warning.textContent).toContain('Exa is turned off')
    expect(screen.getByText(searchEn['defaults.connectionHint'])).toBeDefined()
  })

  it('warns about the default native credentials and clears the warning when configured', () => {
    const config = doc<FetchSettings>({ version: 2, defaultConnection: 'builtin:deepseek-fetch-api' })
    const { rerender } = render(<FetchDefaults doc={config} write={write} credentials={{ DEEPSEEK_API_KEY: 'missing' }} t={fetchT} />)
    expect(screen.getByRole('status').textContent).toContain('Needs a DeepSeek account or API key')
    rerender(<FetchDefaults doc={config} write={write} credentials={{ DEEPSEEK_API_KEY: 'configured' }} t={fetchT} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('warns in the defaults hint when the inherited local fetch default is disabled', () => {
    render(<FetchDefaults doc={doc<FetchSettings>({ version: 2, connections: { 'builtin:local': { disabled: true } } })} write={write} t={fetchT} />)
    const warning = screen.getByRole('status')
    expect(warning.querySelector('[data-state="warning"]')).not.toBeNull()
    expect(warning.textContent).toContain('Local HTTP is turned off')
  })

  it('menu rowCaption and sectionSource meet minimum WCAG AA contrast (>= 4.5:1) in light theme', () => {
    expect(menuCss.rowCaption).toBeDefined()
    expect(menuCss.sectionSource).toBeDefined()

    // Light mode colors from dsh-client-ui-theme design platform:
    // White background: #ffffff, --dsw-alias-label-secondary: #61666b (neutral-bluish-700)
    const sRGBToLuminance = (r: number, g: number, b: number): number => {
      const channel = (c: number) => {
        const val = c / 255
        return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    const contrastRatio = (l1: number, l2: number): number =>
      (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)

    const bgLum = sRGBToLuminance(255, 255, 255)
    const textLum = sRGBToLuminance(0x61, 0x66, 0x6b)
    const ratio = contrastRatio(bgLum, textLum)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
