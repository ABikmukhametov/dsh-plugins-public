/** Check the pinned corpus against the native dictionaries of this checkout. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { dshRoot } from '../../../scripts/dsh-root.mjs'
import { nativeDictionaries } from './native-dictionaries.mjs'
import { validate } from './validation.mjs'
import { syncExamples } from './examples.mjs'
import { composeDictionaries } from '../src/compose.mjs'

const root = dshRoot()
const source = JSON.parse(await readFile(new URL('../vendor/SOURCE.json', import.meta.url), 'utf8'))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (manifest.version !== source.dshVersion) throw new Error(`Dictionary reference requires DSH ${source.dshVersion}; found ${manifest.version}`)
const corpus = await readFile(new URL('../vendor/core.json', import.meta.url))
if (createHash('sha256').update(corpus).digest('hex') !== source.sha256) throw new Error('Pinned dictionary checksum differs')
const license = await readFile(new URL('../vendor/LICENSE.txt', import.meta.url))
if (createHash('sha256').update(license).digest('hex') !== source.licenseSha256) throw new Error('Pinned MIT notice checksum differs')
const raw = JSON.parse(corpus.toString())
if (raw.chat['message.stepProcess.sharedPrefix'] !== '') throw new Error('Reviewed empty source prefix changed')
const overrides = JSON.parse(await readFile(new URL('../src/overrides.json', import.meta.url), 'utf8'))
const dictionaries = composeDictionaries(raw, overrides)
const report = validate(dictionaries, nativeDictionaries(root))
await syncExamples()
await writeFile(new URL('../coverage.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(`${report.translated}/${report.total} native keys translated (${(100 * report.translated / report.total).toFixed(1)}%); gaps and obsolete keys: plugins/locale-ru/coverage.json`)
