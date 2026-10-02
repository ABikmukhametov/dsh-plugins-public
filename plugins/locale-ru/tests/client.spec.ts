// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { LocaleSettings } from '@deepseek-ai/dsh-client-locale/client'
import { describe, expect, it, onTestFinished } from 'vitest'
import { apply } from '../src/client.ts'
import { dictionaries } from '../src/dictionaries.ts'
import { validate } from '../scripts/validation.mjs'

function bench() {
  const ctx = new Context()
  const host = stubConfigForm<LocaleSettings>()
  const locale = new LocaleRuntime(ctx, host.scope, { languages: ['en-US'], preference: null })
  ctx.provide('locale', locale)
  return { ctx, locale, host }
}

describe('Russian language contribution', () => {
  it('uses the DSH 0.2 completion fragment and preview notice', async () => {
    const { ctx, locale } = bench()
    const fiber = ctx.plugin({ apply })
    onTestFinished(() => fiber.dispose())
    await fiber.await()
    locale.setLocale('ru')
    expect(locale.bind('chat')('message.turnProcess.took')).toBe('Выполнено за ')
    expect(locale.bind('settings.models')('welcomeBody')).toContain('DeepSeek Harness 0.2')
    await fiber.dispose()
  })

  it('registers, cleans every namespace, and restores a saved choice on re-enable', async () => {
    const { ctx, locale, host } = bench()
    const missingNamespace = locale.register('future-section', 'en', { caption: 'Future section' })
    onTestFinished(missingNamespace)
    const missingKey = locale.register('chat', 'en', { 'chat.deepDivingFor': 'Deep diving for {duration}' })
    onTestFinished(missingKey)
    const fiber = ctx.plugin({ apply })
    onTestFinished(() => fiber.dispose())
    await fiber.await()
    locale.setLocale('ru')
    expect(locale.getLocale().locales).toContainEqual({ id: 'ru', label: 'Русский', fallback: 'en' })
    expect(locale.bind('chat')('chat.deepDivingFor', { duration: '5s' })).toBe('Deep diving for 5s')
    expect(locale.bind('future-section')('caption')).toBe('Future section')
    expect(host.set).toHaveBeenCalledWith('preference', 'ru')
    await fiber.dispose()
    expect(locale.getLocale().active).toBe('en')
    expect(locale.getLocale().locales.map(language => language.id)).not.toContain('ru')
    for (const namespace of Object.keys(dictionaries)) locale.register(namespace, 'ru', {})()
    const again = ctx.plugin({ apply })
    onTestFinished(() => again.dispose())
    await again.await()
    expect(locale.getLocale().active).toBe('ru')
    expect(locale.bind('common')('cancel')).toBe(dictionaries.common.cancel)
    await again.dispose()
    expect(locale.getLocale().active).toBe('en')
  })

  it.each(['dictionary', 'language'])('rolls back partial registrations after a %s conflict', async (kind) => {
    const { ctx, locale } = bench()
    const namespaces = Object.keys(dictionaries)
    const conflict = kind === 'dictionary'
      ? locale.register(namespaces.at(-1)!, 'ru', { sentinel: 'Other owner' })
      : locale.addLanguage({ id: 'ru', label: 'Other owner', fallback: 'en' })
    onTestFinished(conflict)
    // Direct apply propagates the registry error instead of Cordis logging it.
    expect(() => apply(ctx)).toThrow('already')
    for (const namespace of namespaces.slice(0, -1)) locale.register(namespace, 'ru', {})()
    conflict()
    const fiber = ctx.plugin({ apply })
    onTestFinished(() => fiber.dispose())
    await fiber.await()
    locale.setLocale('ru')
    expect(locale.bind('common')('cancel')).toBe(dictionaries.common.cancel)
    await fiber.dispose()
  })
})

describe('dictionary acceptance', () => {
  it('allows missing keys and namespaces and reports their coverage', () => {
    expect(validate({ panel: { hello: 'Привет, {name}' } }, { panel: { hello: 'Hello, {name}', missing: 'Missing' }, next: { title: 'Next' } })).toMatchObject({ translated: 1, total: 3, missing: { panel: ['missing'], next: ['title'] } })
  })
  it('preserves the reviewed space used as a numeric group separator', () => {
    expect(validate({ chat: { 'number.groupSeparator': ' ' } }, { chat: { 'number.groupSeparator': ',' } }).translated).toBe(1)
  })
  it.each(['', '   ', 'Привет, {who}'])('rejects invalid existing translation %j', value => {
    expect(() => validate({ panel: { hello: value } }, { panel: { hello: 'Hello, {name}' } })).toThrow()
  })
})
