/**
 * Remove build outputs of the current directory: `lib` by default, or the
 * directories named on the command line. Never walks above the working
 * directory.
 */
import { rmSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'

const targets = process.argv.length > 2 ? process.argv.slice(2) : ['lib']
for (const target of targets) {
  if (isAbsolute(target) || normalize(target).startsWith('..')) throw new Error(`clean: refusing to remove ${target}`)
  rmSync(resolve(target), { recursive: true, force: true })
}
