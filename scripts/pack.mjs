import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dshRoot } from './dsh-root.mjs'

dshRoot()
for (const name of ['locale-ru', 'personal-memory', 'artifact-download']) {
  const script = fileURLToPath(new URL(`../plugins/${name}/scripts/pack.mjs`, import.meta.url))
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
