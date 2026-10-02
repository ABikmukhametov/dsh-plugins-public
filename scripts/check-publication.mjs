/** Inspect every file version in the commits selected for publication. */
import { execFileSync } from 'node:child_process'
import { TextDecoder } from 'node:util'

const args = process.argv.slice(2)
if (!(args.length === 1 && args[0] === '--all') && !(args.length === 2 && args[0] === '--range' && /^[^-\s]+\.\.[^-\s]+$/u.test(args[1]))) {
  process.stderr.write('Usage: node scripts/check-publication.mjs --all | --range <base>..<head>\n')
  process.exit(2)
}

function git(command, encoding = 'utf8') {
  return execFileSync('git', command, { encoding, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

const revisions = args[0] === '--all' ? ['--all'] : [args[1]]
let commits
try {
  commits = git(['rev-list', ...revisions]).trim().split('\n').filter(Boolean)
} catch {
  process.stderr.write('Cannot resolve the selected Git history. Publication check failed.\n')
  process.exit(2)
}
if (commits.length === 0) {
  process.stderr.write('No commits selected. Publication check failed.\n')
  process.exit(2)
}

const approvedName = 'Айдар Бикмухаметов'
const approvedEmail = 'ARBikmuhametov@yandex.ru'
const sensitivePath = /(^|\/)(?:TODO\.md|DEV-HISTORY\.md|\.env(?:\..*)?|\.npmrc|\.credentials[^/]*|\.cache|node_modules|artifacts|storages|sessions)(?:\/|$)/iu
const archivePath = /\.(?:tgz|zip|7z|db|sqlite\d*|pem|key|p12|pfx)$/iu
const secretPatterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu],
  ['github-token', /(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}/u],
  ['api-token', /\bsk-[A-Za-z0-9_-]{20,}\b/u],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~-]{20,}/iu],
  ['credential-assignment', /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*['"][^'"\r\n]{8,}['"]/iu],
]
const privateMarkers = [
  ['local-user-path', /(?:[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/)/iu],
  ['private-drive-path', /[A-Za-z]:[\\/](?:yandex_disk|dsh-official|deepseek_harnes)(?:[\\/]|\b)/iu],
  ['private-repository', new RegExp('ABikmukhametov/dsh-' + 'plugins(?!-public)(?:\\b|\\.git)', 'iu')],
  ['internal-work', new RegExp(['КС', 'УП|БИ', 'РПА|Первый ', 'Бит'].join(''), 'iu')],
]
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu
const findings = new Set()
const visited = new Set()
const paths = new Set()
const decoder = new TextDecoder('utf-8', { fatal: true })

function report(commit, path, line, kind) {
  findings.add(`${commit.slice(0, 12)} ${path}:${line} ${kind}`)
}

function inspectText(commit, path, content) {
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const lineNumber = index + 1
    const inspected = line.replaceAll('/Us' + 'ers/name/my-plugin', '')
    for (const [kind, pattern] of [...secretPatterns, ...privateMarkers]) {
      if (pattern.test(inspected)) report(commit, path, lineNumber, kind)
    }
    for (const email of line.match(emailPattern) ?? []) {
      if (email !== approvedEmail) report(commit, path, lineNumber, 'unapproved-email')
    }
  }
}

for (const commit of commits) {
  const metadata = git(['show', '-s', '--format=%an%n%ae%n%cn%n%ce', commit]).trimEnd().split('\n')
  if (metadata.length !== 4 || metadata[0] !== approvedName || metadata[2] !== approvedName || metadata[1] !== approvedEmail || metadata[3] !== approvedEmail) {
    report(commit, '<commit>', 0, 'unapproved-author-metadata')
  }
  inspectText(commit, '<message>', git(['show', '-s', '--format=%B', commit]))
  const entries = git(['ls-tree', '-r', '-z', commit], null).toString('utf8').split('\0').filter(Boolean)
  for (const entry of entries) {
    const match = /^(\d+) blob ([0-9a-f]{40,64})\t(.+)$/u.exec(entry)
    if (!match) {
      report(commit, '<tree>', 0, 'unsupported-git-entry')
      continue
    }
    const [, mode, blob, path] = match
    paths.add(path)
    inspectText(commit, '<path>', path)
    if (mode !== '100644' && mode !== '100755') report(commit, path, 0, 'unsupported-file-mode')
    if (sensitivePath.test(path)) report(commit, path, 0, 'private-or-generated-path')
    if (archivePath.test(path)) report(commit, path, 0, 'binary-or-archive-path')
    const key = `${blob}\0${path}`
    if (visited.has(key)) continue
    visited.add(key)
    const bytes = git(['cat-file', 'blob', blob], null)
    if (bytes.includes(0)) {
      report(commit, path, 0, 'binary-content-requires-review')
      continue
    }
    let content
    try {
      content = decoder.decode(bytes)
    } catch {
      report(commit, path, 0, 'invalid-utf8-requires-review')
      continue
    }
    inspectText(commit, path, content)
  }
}

process.stdout.write(`Checked ${commits.length} commits, ${visited.size} file versions, ${paths.size} paths.\n`)
if (findings.size > 0) {
  for (const finding of [...findings].sort()) process.stdout.write(`${finding}\n`)
  process.stderr.write(`Publication check failed: ${findings.size} finding(s). Values were not printed.\n`)
  process.exitCode = 1
} else {
  process.stdout.write('Publication pattern check passed. Manual content and GitHub surface review is still required.\n')
}
