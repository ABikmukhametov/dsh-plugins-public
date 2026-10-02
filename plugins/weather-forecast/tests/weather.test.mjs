import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dshRoot } from '../../../scripts/dsh-root.mjs'
import * as weather from '../lib/index.js'

const root = dshRoot()
const dsh = async path => import(pathToFileURL(join(root, path)).href)
const { Context } = await dsh('vendor/cordis/lib/index.js')
const { default: SystemPrompt } = await dsh('packages/core/system-prompt/lib/index.js')
const { default: ToolRuntime } = await dsh('packages/core/tools/lib/index.js')
const { default: AgentRegistry } = await dsh('packages/core/agent/lib/index.js')
const { ToolCallId } = await dsh('packages/llm/llm/lib/index.js')
const contexts = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

async function catalog(config = { timeoutMs: 15_000, maxResponseBytes: 32 * 1024, traceRegistration: false }) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  weather.apply(ctx, config)
  return ctx
}

test('URL encodes a city and accepts exactly days 0–3', () => {
  assert.equal(weather.forecastUrl(' Moscow ', 3), 'https://wttr.in/Moscow?3&n&lang=ru')
  assert.equal(weather.forecastUrl('New York', 0), 'https://wttr.in/New+York?0&n&lang=ru')
  assert.equal(weather.forecastUrl('MUC', 1), 'https://wttr.in/MUC?1&n&lang=ru')
  assert.equal(weather.forecastUrl('Москва?x=1', 2), 'https://wttr.in/%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%3Fx%3D1?2&n&lang=ru')
  for (const days of [-1, 4, 1.5, Number.NaN]) assert.throws(() => weather.forecastUrl('Moscow', days))
  assert.throws(() => weather.forecastUrl(' ', 1))
})

test('registration projects one schema into the prompt before a model call', async () => {
  const ctx = await catalog()
  const schemas = ctx.tools.schemas()
  assert.deepEqual(schemas.map(tool => tool.name), ['get_weather_forecast'])
  assert.match(schemas[0].parameters.properties.location.description, /IATA/)
  assert.deepEqual(schemas[0].parameters.properties.days.enum, [0, 1, 2, 3])
  assert.deepEqual((await ctx.systemPrompt.assemble()).tools.map(tool => tool.name), ['get_weather_forecast'])
})

test('agent creation logs the scoped catalog before any model request', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const lines = []
  ctx.logger.info = (...args) => lines.push(args)
  weather.apply(ctx, { timeoutMs: 15_000, maxResponseBytes: 32 * 1024, traceRegistration: true })
  const agent = { id: 'new-chat', session: { id: 'new-chat' } }
  const disposeAgent = await ctx.agents.register(agent)
  try {
    assert.equal(lines.length, 1)
    assert.match(lines[0][0], /before first model turn/)
    assert.equal(lines[0][2], 1)
    assert.match(lines[0][3], /get_weather_forecast/)
  } finally {
    await disposeAgent()
  }
})

test('execution sends the requested headers and returns plain text', async () => {
  const ctx = await catalog()
  const originalFetch = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response('\u001b[31mМосква: дождь\u001b[0m\r\n', { headers: { 'content-type': 'text/plain' } })
  }
  try {
    const result = await ctx.tools.execute({
      callId: ToolCallId('weather-1'), name: 'get_weather_forecast',
      arguments: { location: 'Москва', days: 2 }, signal: new AbortController().signal,
    })
    assert.equal(result.isError, false)
    assert.equal(result.content[0].text, 'Москва: дождь')
    assert.equal(request.url, 'https://wttr.in/%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0?2&n&lang=ru')
    assert.equal(request.options.headers['User-Agent'], 'curl')
    assert.equal(request.options.redirect, 'error')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('HTML, oversized responses, and invalid days fail', async () => {
  const ctx = await catalog({ timeoutMs: 15_000, maxResponseBytes: 1024, traceRegistration: false })
  const originalFetch = globalThis.fetch
  try {
    for (const body of ['<html>not weather</html>', 'x'.repeat(1025)]) {
      globalThis.fetch = async () => new Response(body)
      const result = await ctx.tools.execute({
        callId: ToolCallId(`weather-${body.length}`), name: 'get_weather_forecast',
        arguments: { location: 'Moscow', days: 1 }, signal: new AbortController().signal,
      })
      assert.equal(result.isError, true)
    }
    const invalid = await ctx.tools.execute({
      callId: ToolCallId('weather-invalid'), name: 'get_weather_forecast',
      arguments: { location: 'Moscow', days: 4 }, signal: new AbortController().signal,
    })
    assert.equal(invalid.isError, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
