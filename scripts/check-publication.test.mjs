import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scanner = fileURLToPath(new URL('./check-publication.mjs', import.meta.url))

function command(cwd, file, args) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

function git(cwd, ...args) {
  const result = command(cwd, 'git', args)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function repository(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-publication-'))
  try {
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.name', 'Айдар Бикмухаметов')
    git(dir, 'config', 'user.email', 'ARBikmuhametov@yandex.ru')
    callback(dir)
  } finally {
    const resolved = resolve(dir)
    assert.ok(resolved.startsWith(resolve(tmpdir()) + sep) && basename(resolved).startsWith('dsh-publication-'))
    rmSync(resolved, { recursive: true, force: true })
  }
}

test('clean history passes; a removed secret remains blocked in the outgoing range', () => repository(dir => {
  writeFileSync(join(dir, 'README.md'), '# Public example\n')
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-qm', 'Add public example')
  const base = git(dir, 'rev-parse', 'HEAD')
  assert.equal(command(dir, process.execPath, [scanner, '--all']).status, 0)

  const fakeToken = 'ghp_' + 'A'.repeat(30)
  writeFileSync(join(dir, 'temporary.txt'), fakeToken + '\n')
  git(dir, 'add', 'temporary.txt')
  git(dir, 'commit', '-qm', 'Add temporary file')
  unlinkSync(join(dir, 'temporary.txt'))
  git(dir, 'add', '-u')
  git(dir, 'commit', '-qm', 'Remove temporary file')

  const result = command(dir, process.execPath, [scanner, '--range', `${base}..HEAD`])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /temporary\.txt:1 github-token/u)
  assert.ok(!(result.stdout + result.stderr).includes(fakeToken))
}))

test('another email address is blocked without printing its value', () => repository(dir => {
  const otherEmail = 'employee@' + 'example.org'
  writeFileSync(join(dir, 'README.md'), `Contact ${otherEmail}\n`)
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-qm', 'Add contact')
  const result = command(dir, process.execPath, [scanner, '--all'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /README\.md:1 unapproved-email/u)
  assert.ok(!(result.stdout + result.stderr).includes(otherEmail))
}))

test('a documented placeholder passes while an actual user path is blocked', () => repository(dir => {
  const placeholder = '/Us' + 'ers/name/my-plugin'
  writeFileSync(join(dir, 'README.md'), `Install from ${placeholder}\n`)
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-qm', 'Document an example path')
  assert.equal(command(dir, process.execPath, [scanner, '--all']).status, 0)

  const actualPath = '/Us' + 'ers/alice/private'
  writeFileSync(join(dir, 'README.md'), `Install from ${actualPath}\n`)
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-qm', 'Document a local path')
  const result = command(dir, process.execPath, [scanner, '--all'])
  assert.equal(result.status, 1)
  assert.match(result.stdout, /README\.md:1 local-user-path/u)
  assert.ok(!(result.stdout + result.stderr).includes(actualPath))
}))
