/**
 * Pack every publishable package and check what a user would install:
 * manifests carry no workspace or catalog ranges, every package targets the
 * same DSH range, plugins ship self-contained host bundles, the profile pins
 * the exact plugin versions it was released with, and every file the Plugins
 * page reads is present. Then publint lints each package.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Manifest, pack, publishablePackages, repo } from './workspace.ts'

const problems: string[] = []
const fail = (pkg: string, message: string) => { problems.push(`${pkg}: ${message}`) }

const tar = (tarball: string, ...args: string[]) => execFileSync('tar', ['-xzf', tarball, '-O', ...args], { encoding: 'utf8' })
const list = (tarball: string) => new Set(execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n').map(path => path.replace(/^package\//, '')))

const packages = publishablePackages()
const versions = new Map(packages.map(pkg => [pkg.manifest.name, pkg.manifest.version]))
const out = mkdtempSync(join(tmpdir(), 'dsh-web-enhanced-pack-'))
const dshRanges = new Set<string>()

try {
  for (const pkg of packages) {
    const tarball = pack(pkg, out)
    const files = list(tarball)
    const manifest = JSON.parse(tar(tarball, 'package/package.json')) as Manifest
    const name = manifest.name

    for (const field of ['dependencies', 'peerDependencies'] as const) {
      for (const [dep, range] of Object.entries(manifest[field] ?? {})) {
        if (/^(workspace|catalog):/.test(range)) fail(name, `${field}.${dep} still reads ${range}`)
      }
    }
    const dsh = manifest.engines?.dsh
    if (dsh === undefined) fail(name, 'engines.dsh is missing')
    else dshRanges.add(dsh)
    for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (dep.startsWith('@deepseek-ai/dsh-') && range !== dsh) fail(name, `peer ${dep} ${range} differs from engines.dsh ${dsh}`)
    }

    for (const target of Object.values(manifest.exports ?? {})) {
      if (!target.includes('*') && !files.has(target.replace(/^\.\//, ''))) fail(name, `export target ${target} is not packed`)
    }
    if (manifest.icon === undefined || !files.has(manifest.icon.replace(/^\.\//, ''))) fail(name, 'icon is not packed')
    for (const lang of ['en', 'zh']) {
      if (!files.has(`locale/${lang}.json`)) { fail(name, `locale/${lang}.json is not packed`); continue }
      const meta = (JSON.parse(tar(tarball, `package/locale/${lang}.json`)) as { meta?: { title?: string; description?: string } }).meta
      if (!meta?.title || !meta.description) fail(name, `locale/${lang}.json lacks meta.title or meta.description`)
    }

    if (manifest.dsh?.bundle !== undefined) {
      // The profile: mounts plugins of this workspace, pinned to this release.
      if (!files.has(manifest.dsh.bundle.patch.replace(/^\.\//, ''))) fail(name, 'bundle patch is not packed')
      for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
        if (versions.get(dep) !== range) fail(name, `depends on ${dep}@${range}; this workspace releases ${versions.get(dep) ?? 'no such package'}`)
      }
    } else {
      // A plugin: its host bundle may import only Node built-ins and the DSH installation,
      // and every DSH package it imports must be a declared peer (the installation provides it).
      if (manifest.dependencies !== undefined) fail(name, 'plugins inline their dependencies; remove "dependencies"')
      const entry = tar(tarball, `package/${(manifest.main ?? '').replace(/^\.\//, '')}`)
      for (const match of entry.matchAll(/(?:^|[;\s])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const specifier = match[1] ?? match[2]!
        if (isBuiltin(specifier)) continue
        if (!specifier.startsWith('@deepseek-ai/')) { fail(name, `host bundle imports ${specifier}`); continue }
        const imported = specifier.split('/').slice(0, 2).join('/')
        if (manifest.peerDependencies?.[imported] === undefined) fail(name, `host bundle imports ${imported}, which is not a declared peer`)
      }
    }

    execFileSync(join(repo, 'node_modules/.bin/publint'), [pkg.dir, '--strict', '--pack', 'pnpm'], { stdio: 'inherit' })
  }
  if (dshRanges.size > 1) problems.push(`packages target different DSH ranges: ${[...dshRanges].join(', ')}`)
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (problems.length > 0) {
  console.error(problems.map(problem => `✗ ${problem}`).join('\n'))
  process.exit(1)
}
console.log(`✓ ${packages.length} packages verified`)
