import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from './browser.ts'
import { artifacts, workspace } from './environment.ts'

// Capture the launch target before isolated Host setup replaces process.env.
export const reviewDirectory = join(workspace, 'review', process.env.DSH_E2E_REVIEW_NAME ?? '2026-10-22-m5')

/** Keep each matrix image both with this run and outside global setup's cleanup. */
export async function reviewScreenshot(app: App, name: string): Promise<void> {
  mkdirSync(reviewDirectory, { recursive: true })
  await app.page.evaluate(async () => { await document.fonts.ready })
  const path = join(artifacts, name + '.png')
  await app.page.screenshot({ path, fullPage: true, animations: 'disabled' })
  copyFileSync(path, join(reviewDirectory, name + '.png'))
}
