/** Pack only prebuilt files; installation has no lifecycle scripts. */
import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dshRoot } from '../../../scripts/dsh-root.mjs'

const packageDir = fileURLToPath(new URL('../', import.meta.url))
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
const pnpm = join(dshRoot(), 'node_modules/pnpm/bin/pnpm.cjs')
const result = spawnSync(process.execPath, [pnpm, 'pack', '--pack-destination', 'artifacts'], { cwd: packageDir, stdio: 'inherit' })
if (result.error) throw result.error
if (result.signal) throw new Error(`Pack terminated by ${result.signal}`)
process.exitCode = result.status ?? 1
