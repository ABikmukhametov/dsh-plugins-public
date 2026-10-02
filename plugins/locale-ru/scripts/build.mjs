/** Build a self-contained Web module and the discovery-only Host entry. */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dshRoot } from '../../../scripts/dsh-root.mjs'

const packageDir = fileURLToPath(new URL('../', import.meta.url))
const outputDir = process.argv[2] ?? fileURLToPath(new URL('../lib/', import.meta.url))
const require = createRequire(import.meta.url)
const esbuild = createRequire(join(dshRoot(), 'packages/boot/hmr/package.json'))('esbuild')
await mkdir(outputDir, { recursive: true })
await esbuild.build({ absWorkingDir: packageDir, entryPoints: ['src/index.ts'], outfile: `${outputDir}/index.js`, format: 'esm', platform: 'node', target: 'node22', bundle: true })
const result = await esbuild.build({ absWorkingDir: packageDir, entryPoints: ['src/client.ts'], format: 'iife', globalName: 'localeRu', platform: 'browser', target: 'es2022', bundle: true, write: false })
await writeFile(`${outputDir}/client.js`,
  `window.__ModuleLoader__.load({id:"@abikmukhametov/dsh-locale-ru",factory(){\n${result.outputFiles[0].text}\nreturn localeRu;\n}});\n`)
