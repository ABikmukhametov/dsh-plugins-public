/** Native Russian language contribution; all registrations share one lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { dictionaries } from './dictionaries.ts'

/** Service supplied by the native Web locale plugin. */
export const inject = ['locale']

/**
 * Register the dictionaries before exposing the selectable language.
 * @param ctx - browser context with the native locale registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    const dispose = (): void => {
      for (const remove of disposers.splice(0).reverse()) remove()
    }
    try {
      for (const [namespace, dictionary] of Object.entries(dictionaries)) {
        disposers.push(ctx.locale.register(namespace, 'ru', dictionary))
      }
      disposers.push(ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' }))
    } catch (error) {
      dispose()
      throw error
    }
    return dispose
  }, 'locale-ru: dictionaries and language')
}
