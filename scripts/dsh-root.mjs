/** Find a separately checked-out and built DeepSeek Harness source tree. */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

export function dshRoot() {
  if (!process.env.DSH_SOURCE_ROOT) throw new Error('Set DSH_SOURCE_ROOT to a DeepSeek Harness checkout')
  const root = resolve(process.env.DSH_SOURCE_ROOT)
  const manifestPath = join(root, 'package.json')
  if (!existsSync(manifestPath)) throw new Error('DSH_SOURCE_ROOT has no package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-root' || manifest.version !== '0.2.0-rc.2')
    throw new Error('Plugins require DSH 0.2.0-rc.2')
  return root
}
