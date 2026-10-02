/** Bundle the Host plugin against the already built DSH checkout. */
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { dshRoot } from '../../../scripts/dsh-root.mjs'

const packageDir = fileURLToPath(new URL('../', import.meta.url))
const outputDir = fileURLToPath(new URL('../lib/', import.meta.url))
const root = dshRoot()
const esbuild = createRequire(join(root, 'packages/boot/hmr/package.json'))('esbuild')
const packages = new Map()
for (const groupRoot of ['packages', 'vendor']) {
  for (const group of await readdir(join(root, groupRoot), { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const groupPath = join(root, groupRoot, group.name)
    const dirs = groupRoot === 'packages' ? await readdir(groupPath, { withFileTypes: true }) : [group]
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const location = groupRoot === 'packages' ? join(groupPath, dir.name) : groupPath
      const manifest = await readFile(join(location, 'package.json'), 'utf8').then(JSON.parse).catch(() => null)
      if (manifest?.name?.startsWith('@deepseek-ai/')) packages.set(manifest.name, { location, manifest })
    }
  }
}
const dshImports = { name: 'dsh-imports', setup(build) {
  build.onResolve({ filter: /^@deepseek-ai\// }, args => {
    const segments = args.path.split('/')
    const name = segments.slice(0, 2).join('/')
    const owner = packages.get(name)
    if (!owner) throw new Error(`No workspace package for ${args.path}`)
    const relative = segments.slice(2).join('/')
    const entry = owner.manifest.exports?.['.']
    const main = typeof entry === 'string' ? entry : entry?.import ?? entry?.default ?? owner.manifest.module ?? owner.manifest.main
    return { path: relative ? resolve(owner.location, 'lib', `${relative}.js`) : resolve(owner.location, main) }
  })
} }
await mkdir(outputDir, { recursive: true })
await esbuild.build({ absWorkingDir: packageDir, entryPoints: ['src/index.ts'], outfile: join(outputDir, 'index.js'),
  platform: 'node', format: 'esm', target: 'node22', bundle: true, plugins: [dshImports] })
