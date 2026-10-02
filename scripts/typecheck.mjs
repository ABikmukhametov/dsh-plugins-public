/** Typecheck plugin sources against public declarations in a built DSH checkout. */
import { spawnSync } from 'node:child_process'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshRoot } from './dsh-root.mjs'

const root = dshRoot()
const tsc = join(root, 'node_modules/typescript/bin/tsc')
const packages = ['locale-ru', 'personal-memory', 'artifact-download', 'weather-forecast']
const selected = process.argv[2]
if (selected !== undefined && !packages.includes(selected)) throw new Error(`Unknown plugin ${selected}`)
for (const name of selected === undefined ? packages : [selected]) {
  const dir = fileURLToPath(new URL(`../plugins/${name}/`, import.meta.url))
  const source = JSON.parse(await readFile(join(dir, 'tsconfig.json'), 'utf8'))
  const paths = Object.fromEntries(Object.entries(source.compilerOptions.paths).map(([key, values]) =>
    [key, values.map(value => resolve(root, value.replace(/^\.\.\/\.\.\//, '')))]))
  const faces = name === 'locale-ru' || name === 'weather-forecast' ? [''] : ['host', 'client']
  for (const face of faces) {
    const faceConfig = face ? JSON.parse(await readFile(join(dir, `tsconfig.${face}.json`), 'utf8')) : source
    const configPath = join(dir, 'tsconfig.catalog.generated.json')
    const config = { extends: join(root, 'tsconfig.base.json'), compilerOptions: {
      ...source.compilerOptions, paths, typeRoots: [join(root, 'node_modules/@types')], noEmit: true,
    }, include: face ? faceConfig.include.filter(pattern => !pattern.startsWith('tests/')) : ['src/**/*.ts', 'src/**/*.mts', 'src/**/*.json'] }
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
    try {
      const result = spawnSync(process.execPath, [tsc, '--project', configPath], { cwd: root, stdio: 'inherit' })
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`Typecheck failed for ${name} ${face} (exit ${result.status})`)
    } finally {
      await rm(configPath, { force: true })
    }
  }
}
