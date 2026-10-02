/** Stage tests in a separate DSH checkout so native source aliases resolve unchanged. */
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshRoot } from './dsh-root.mjs'

const root = dshRoot()
const staging = resolve(root, 'plugins')
if (staging !== resolve(root, 'plugins') || !staging.startsWith(resolve(root) + sep)) throw new Error('Invalid staging path')
try {
  await stat(staging)
  throw new Error(`Refusing to overwrite existing ${staging}; use a clean DSH checkout`)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
await mkdir(staging)
try {
  for (const name of ['locale-ru', 'personal-memory', 'artifact-download']) {
    const source = fileURLToPath(new URL(`../plugins/${name}/`, import.meta.url))
    await cp(source, join(staging, name), { recursive: true, filter: path => !/(?:^|[\\/])(?:lib|artifacts|node_modules)(?:[\\/]|$)/.test(path) })
    const vitest = join(root, 'node_modules/vitest/vitest.mjs')
    const result = spawnSync(process.execPath, [vitest, 'run', '--config', `plugins/${name}/vitest.config.ts`], { cwd: root, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Tests failed for ${name} (exit ${result.status})`)
  }
} finally {
  if (!staging.startsWith(resolve(root) + sep)) throw new Error('Invalid cleanup path')
  await rm(staging, { recursive: true })
}
