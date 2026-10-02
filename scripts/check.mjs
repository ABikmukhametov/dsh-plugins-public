import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dshRoot } from './dsh-root.mjs'

dshRoot()
const script = fileURLToPath(new URL('../plugins/locale-ru/scripts/check.mjs', import.meta.url))
const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
