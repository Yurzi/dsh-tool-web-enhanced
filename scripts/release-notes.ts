/**
 * Print the CHANGELOG.md section of one release tag: the body of the GitHub
 * Release that publish.yml creates. The section starts at the heading
 * `## <tag>` (optionally followed by a date) and ends at the next `## `.
 * Usage: node scripts/release-notes.ts v0.1.0
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repo } from './workspace.ts'

const tag = process.argv[2]
if (tag === undefined) {
  console.error('usage: node scripts/release-notes.ts <tag>')
  process.exit(2)
}

const lines = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8').split('\n')
const start = lines.findIndex(line => line === `## ${tag}` || line.startsWith(`## ${tag} `))
const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
const notes = start === -1 ? '' : lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim()
if (notes === '') {
  console.error(`CHANGELOG.md has no notes under "## ${tag}"`)
  process.exit(1)
}
process.stdout.write(notes + '\n')
