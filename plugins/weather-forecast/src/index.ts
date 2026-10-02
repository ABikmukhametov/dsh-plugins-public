/** Text weather forecasts and a pre-turn tool-catalog trace for DSH Web. */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'weather-forecast'
export const inject = ['tools', 'agents']

export interface Config {
  timeoutMs: number
  maxResponseBytes: number
  traceRegistration: boolean
}

export const Config: Schema<Config> = Schema.object({
  timeoutMs: Schema.number().step(1).min(1).max(120_000).default(15_000),
  maxResponseBytes: Schema.number().step(1).min(1024).max(1024 * 1024).default(32 * 1024),
  traceRegistration: Schema.boolean().default(false),
})

/** Keep a location in one URL path component while using wttr.in's plus-separated spaces. */
export function forecastUrl(location: string, days: number): string {
  const place = location.trim()
  if (place.length === 0 || place.length > 200) throw new Error('location must contain 1–200 characters')
  if (!Number.isInteger(days) || days < 0 || days > 3) throw new Error('days must be an integer from 0 to 3')
  return `https://wttr.in/${encodeURIComponent(place).replace(/%20/g, '+')}?${days}&n&lang=ru`
}

/** Fetch one bounded UTF-8 report and return plain text for the model. */
export async function fetchForecast(url: string, signal: AbortSignal, maxResponseBytes: number): Promise<string> {
  const response = await fetch(url, { headers: { 'User-Agent': 'curl' }, signal, redirect: 'error' })
  if (!response.ok) throw new Error(`wttr.in returned HTTP ${response.status}`)
  if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new Error('wttr.in returned HTML instead of a text forecast')
  }
  if (response.body === null) throw new Error('wttr.in returned an empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxResponseBytes) throw new Error('wttr.in forecast exceeds the configured size limit')
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const report = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .trim()
  if (report === '' || /^<(?:!doctype\s+html|html\b)/i.test(report)) {
    throw new Error('wttr.in did not return a text forecast')
  }
  return report
}

/** Register one forecast tool and optionally log the scoped catalog at agent creation. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'get_weather_forecast',
    description: 'Get the current weather or a Russian text forecast from wttr.in for a city or airport. Use a three-letter IATA code for an airport. days: 0=current only, 1=today, 2=today and tomorrow, 3=three days.',
    parameters: {
      location: { type: 'string', required: true, description: 'City name or three-letter IATA airport code, for example Moscow or MUC.' },
      days: { type: 'integer', required: true, enum: [0, 1, 2, 3], description: 'Number of forecast days (0–3).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const url = forecastUrl(args.location, args.days)
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)])
      return fetchForecast(url, signal, config.maxResponseBytes)
    },
    presentCall: args => ({ card: 'generic', title: `Weather forecast: ${args.location}`, kind: 'read' }),
  })), 'weather-forecast: tool')

  if (config.traceRegistration) {
    ctx.on('agent/created', ({ agent }) => {
      const schemas = ctx.tools.schemas(agent)
      const forecast = schemas.find(tool => tool.name === 'get_weather_forecast')
      ctx.logger.info('weather-forecast: before first model turn, agent=%s, tools=%d, names=%s, forecast=%s',
        agent.id, schemas.length, JSON.stringify(schemas.map(tool => tool.name)), JSON.stringify(forecast ?? null))
    })
  }
}
