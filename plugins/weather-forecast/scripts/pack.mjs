/** Build and pack the weather bundle without touching the DSH checkout. */
import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dshRoot } from '../../../scripts/dsh-root.mjs'

const packageDir = fileURLToPath(new URL('../', import.meta.url))
const build = fileURLToPath(new URL('./build.mjs', import.meta.url))
const built = spawnSync(process.execPath, [build], { cwd: packageDir, stdio: 'inherit' })
if (built.error) throw built.error
if (built.signal) throw new Error(`Build terminated by ${built.signal}`)
if (built.status !== 0) process.exit(built.status ?? 1)
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
const pnpm = join(dshRoot(), 'node_modules/pnpm/bin/pnpm.cjs')
const result = spawnSync(process.execPath, [pnpm, 'pack', '--pack-destination', 'artifacts'], { cwd: packageDir, stdio: 'inherit' })
if (result.error) throw result.error
if (result.signal) throw new Error(`Pack terminated by ${result.signal}`)
process.exitCode = result.status ?? 1
