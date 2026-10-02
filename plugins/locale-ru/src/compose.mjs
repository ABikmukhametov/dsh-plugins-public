/** Combine the pinned corpus with translations reviewed for the current DSH release. */

/**
 * Apply local translations and omit the source's empty shared-process prefix.
 * @param {Record<string, Record<string, string>>} source - pinned translation corpus.
 * @param {Record<string, Record<string, string>>} overrides - release-specific translations.
 * @returns {Record<string, Record<string, string>>} dictionaries registered by the plugin.
 */
export function composeDictionaries(source, overrides) {
  const dictionaries = { ...source, chat: { ...source.chat } }
  for (const [namespace, entries] of Object.entries(overrides)) {
    dictionaries[namespace] = { ...dictionaries[namespace], ...entries }
  }
  delete dictionaries.chat['message.stepProcess.sharedPrefix']
  return dictionaries
}
