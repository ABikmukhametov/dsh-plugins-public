/** Generate or verify readable dictionaries and the native English-to-Russian map. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dshRoot } from '../../../scripts/dsh-root.mjs'
import { nativeDictionaries } from './native-dictionaries.mjs'
import { validate } from './validation.mjs'
import { composeDictionaries } from '../src/compose.mjs'

/**
 * Compare examples with the pinned corpus and this checkout's native dictionaries.
 * @param {boolean} write Whether to replace examples instead of rejecting stale files.
 * @returns {Promise<void>} Resolves when both files are current; rejects on invalid dictionaries or stale examples.
 */
export async function syncExamples(write = false) {
  const root = dshRoot()
  const source = JSON.parse(await readFile(new URL('../vendor/SOURCE.json', import.meta.url), 'utf8'))
  const raw = JSON.parse(await readFile(new URL('../vendor/core.json', import.meta.url), 'utf8'))
  const overrides = JSON.parse(await readFile(new URL('../src/overrides.json', import.meta.url), 'utf8'))
  const russian = composeDictionaries(raw, overrides)
  const english = nativeDictionaries(root)
  const report = validate(russian, english)
  const namespaces = {}
  for (const namespace of Object.keys(english).sort()) {
    namespaces[namespace] = {}
    for (const key of Object.keys(english[namespace]).sort()) {
      const en = english[namespace][key]
      const ru = russian[namespace]?.[key] ?? null
      namespaces[namespace][key] = { en, ru, displayedInRussian: ru ?? en }
    }
  }
  const files = {
    'dictionaries.ru.json': russian,
    'translation-map.json': {
      description: 'Действующие ключи DSH: en — английский текст, ru — зарегистрированный русский перевод (null при отсутствии), displayedInRussian — текст при выборе русского до подстановки параметров и объединения фрагментов интерфейсом.',
      dshVersion: source.dshVersion,
      sourceRevision: source.revision,
      translated: report.translated,
      missing: report.total - report.translated,
      namespaces,
    },
  }
  const directory = new URL('../examples/', import.meta.url)
  if (write) await mkdir(directory, { recursive: true })
  for (const [name, value] of Object.entries(files)) {
    const path = new URL(name, directory)
    const content = JSON.stringify(value, null, 2) + '\n'
    if (write) await writeFile(path, content)
    else {
      let actual
      try {
        actual = await readFile(path, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (actual !== content) throw new Error(`Stale example plugins/locale-ru/examples/${name}; run node plugins/locale-ru/scripts/examples.mjs --write`)
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await syncExamples(process.argv.includes('--write'))
  console.log(process.argv.includes('--write') ? 'Locale examples generated' : 'Locale examples are current')
}
