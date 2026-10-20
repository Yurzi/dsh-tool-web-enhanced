/**
 * Run `dsh web` for the isolated profile.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { type E2EContext, PROFILE, artifacts, run } from './environment.ts'

/** A running `dsh web`. */
export interface WebServer {
  /**
   * The one-time launch URL. Visiting it trades the token for an HttpOnly
   * cookie bound to this host and port, then redirects to the app.
   */
  readonly url: string
  stop(): Promise<void>
}

const LOG = join(artifacts, 'web.log')

/**
 * Start the GUI on a free loopback port; never the default 3080 a developer may be using.
 * @param e2e - the run's install and environment.
 * @param overlays - profile patches parsed before Web command flags.
 * @returns the server once it printed its launch URL.
 */
export async function startWeb(e2e: E2EContext, overlays: readonly string[] = []): Promise<WebServer> {
  const port = await freePort()
  // `dsh web` starts the profile named web (PROFILE).
  const child = spawn(e2e.cli, [PROFILE, ...overlays.flatMap(file => ['--patch', file]), '--no-open', '--host', '127.0.0.1', '--port', String(port)], { cwd: run, env: e2e.env })
  const log = createWriteStream(LOG)
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  const pattern = new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[\\w.~-]+`)
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => { reject(new Error(`dsh web printed no launch URL in 90 s; see ${LOG}`)) }, 90_000)
      const read = (chunk: Buffer) => {
        output += chunk.toString()
        const match = pattern.exec(output)
        if (match === null) return
        clearTimeout(timer)
        resolve(match[0])
      }
      child.stdout.on('data', read)
      child.stderr.on('data', read)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`dsh web exited with ${code}; see ${LOG}`)) })
    })
    return { url, stop: () => stop(child) }
  } catch (error) {
    await stop(child)
    throw error
  }
}

/** SIGTERM, then SIGKILL if the process has not exited within 10 s. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
  await exited
  clearTimeout(timer)
}

/** A port the OS just handed out. Another process could take it before dsh binds; startWeb then fails loudly. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port)
        else reject(new Error('no port assigned'))
      })
    })
  })
}
