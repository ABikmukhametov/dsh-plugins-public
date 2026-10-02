/** Compose the runtime dictionaries from the pinned corpus and release-specific updates. */

/**
 * Apply updates and omit the empty shared-process prefix.
 * @param source - pinned translation corpus.
 * @param overrides - translations reviewed for the current DSH release.
 * @returns Dictionaries registered by the plugin.
 */
export function composeDictionaries<Source extends Record<string, Record<string, string>>>(source: Source, overrides: Record<string, Record<string, string>>): { [Key in keyof Source]: Record<string, string> } & Record<string, Record<string, string>>
