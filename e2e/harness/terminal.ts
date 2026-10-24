import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { stripVTControlCharacters } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { artifacts, type E2EContext, run } from './environment.ts'
import { reviewDirectory } from './review.ts'

/** A real PTY, not a mocked TTY flag; waits are driven by output events. */
export function startTerminal(e2e: E2EContext, args: readonly string[], executable = e2e.cli, artifactName = 'm6-tui-pty') {
  const child = spawn('python3', [join(import.meta.dirname, 'terminal-pty.py'), executable, ...args], {
    cwd: run, env: { ...e2e.env, TERM: 'xterm-256color', DSH_TUI_LANG: 'en', DSH_TUI_LAUNCHER_VERSION: '0.16.1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const events = new EventEmitter()
  let raw = ''
  let failure: Error | undefined
  let exited = false
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', () => { exited = true; events.emit('output'); resolve() })
  })
  child.on('error', error => { failure = error; events.emit('output') })
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (data: string) => { raw += data; events.emit('output') })
  }
  const text = () => stripVTControlCharacters(raw).replaceAll('\r', '\n')
  const waitForAny = (expected: readonly string[]): Promise<string> => new Promise((resolve, reject) => {
    const check = () => {
      const match = expected.find(value => text().includes(value))
      if (match !== undefined) { events.off('output', check); resolve(match) }
      else if (failure !== undefined || exited) {
        events.off('output', check)
        reject(failure ?? new Error('TUI exited before ' + expected.join(' or ') + '\n' + text()))
      }
    }
    events.on('output', check)
    check()
  })
  return {
    write(input: string) { child.stdin.write(input) },
    text,
    waitForAny,
    async waitFor(expected: string): Promise<void> {
      writeFileSync(join(artifacts, 'm6-tui-progress.txt'), 'Waiting for: ' + expected + '\n')
      await waitForAny([expected])
    },
    async close() {
      if (!exited) child.kill('SIGTERM')
      await done
      mkdirSync(reviewDirectory, { recursive: true })
      for (const directory of [artifacts, reviewDirectory]) {
        writeFileSync(join(directory, artifactName + '.txt'), text())
        writeFileSync(join(directory, artifactName + '.ansi.txt'), raw)
      }
    },
  }
}
