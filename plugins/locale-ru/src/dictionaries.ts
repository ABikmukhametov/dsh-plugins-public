/** Reviewed translations with the source's empty prefix delegated to English. */
import source from '../vendor/core.json'
import overrides from './overrides.json'
import { composeDictionaries } from './compose.mjs'

/** Nonempty dictionary contributions, retaining the source's space group separator. */
export const dictionaries = composeDictionaries(source, overrides)
