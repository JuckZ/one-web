import type { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const output = path.resolve(root, 'artifacts/local-acceptance/20261115/checkpoint')
const hash = (input: string | Buffer) => createHash('sha256').update(input).digest('hex')
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all')
const head = git('rev-parse', 'HEAD').trim()
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort()
const entries = files.map((name) => {
  if (path.isAbsolute(name) || name.split('/').includes('..'))
    throw new Error('Unsafe source path')
  const file = path.join(root, name)
  if (!fs.existsSync(file))
    return { path: name, kind: 'deleted' }
  const stat = fs.lstatSync(file)
  if (!stat.isFile())
    throw new Error(`Source checkpoint requires regular files: ${name}`)
  return { path: name, kind: 'file', mode: stat.mode & 0o777, sha256: hash(fs.readFileSync(file)) }
})
fs.mkdirSync(output, { recursive: true })
const archive = path.join(output, 'source-inputs.tar.gz')
execFileSync('tar', ['--create', '--gzip', '--file', archive, '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--null', '--verbatim-files-from', '--files-from', '-'], {
  cwd: root,
  input: `${entries.filter(entry => entry.kind === 'file').map(entry => entry.path).join('\0')}\0`,
})
for (const entry of entries) {
  const file = path.join(root, entry.path)
  if (entry.kind === 'file' ? hash(fs.readFileSync(file)) !== entry.sha256 : fs.existsSync(file))
    throw new Error(`Source changed during capture: ${entry.path}`)
}
if (git('status', '--porcelain=v1', '-z', '--untracked-files=all') !== status || git('rev-parse', 'HEAD').trim() !== head)
  throw new Error('Git state changed during source capture')

function artifactTree(directory: string) {
  const entries: Array<{ path: string, sha256: string }> = []
  const visit = (relative: string) => {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      const nested = path.join(relative, name)
      const file = path.join(directory, nested)
      const stat = fs.lstatSync(file)
      if (stat.isDirectory())
        visit(nested)
      else if (stat.isFile())
        entries.push({ path: nested, sha256: hash(fs.readFileSync(file)) })
      else
        throw new Error('Generated artifact contains a non-file entry')
    }
  }
  visit('')
  return entries
}
const evidence = {
  kind: 'uncommitted-local-checkpoint',
  head,
  branch: git('branch', '--show-current').trim(),
  sourceArchive: 'source-inputs.tar.gz',
  sourceArchiveSha256: hash(fs.readFileSync(archive)),
  sourceFiles: entries,
  gitStatusSha256: hash(status),
  lockfileSha256: hash(fs.readFileSync('pnpm-lock.yaml')),
  artifacts: {
    chromium: artifactTree('artifacts/test/chromium'),
    firefox: artifactTree('artifacts/test/firefox'),
    sdk: artifactTree('packages/module-sdk/dist'),
  },
  restore: 'Clone the recorded HEAD into an owned empty checkout, extract the archive, then remove only the paths explicitly marked deleted. Verify every source hash before installing dependencies. This snapshot is not a tag or publication.',
}
fs.writeFileSync(path.join(output, 'source-and-artifacts.json'), `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`Captured ${entries.filter(entry => entry.kind === 'file').length} source files and ${entries.filter(entry => entry.kind === 'deleted').length} recorded deletions; archive ${evidence.sourceArchiveSha256}\n`)
