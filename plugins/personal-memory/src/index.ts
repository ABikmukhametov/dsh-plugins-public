/** Personal memory Host plugin: durable records, guarded tools, and journaled context. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-session-projection'
import { acquireLease, memoryDomain, MemoryError, MemoryStore, renderSnapshot } from './store.ts'
import type { MemoryKind, MemoryState } from './store.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Revisioned snapshot from the personal-memory plugin. */
    'personal-memory': { kind: 'personal-memory'; form: 'snapshot'; revision: number; sections: readonly { name: string; text: string }[] }
  }
}

interface MemoryProjection { seq: number | null; revision: number }
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Last personal-memory snapshot committed to the session log. */
    personalMemory: MemoryProjection
  }
}

const projectionSchema = z.object({ seq: z.number().int().nonnegative().nullable(), revision: z.number().int().nonnegative() })
const projection = {
  key: 'personalMemory' as const,
  stateVersion: 1,
  stateSchema: projectionSchema,
  init: (): MemoryProjection => ({ seq: null, revision: 0 }),
  apply: (state: MemoryProjection, event: { type: string; seq: number; data: unknown }): MemoryProjection => {
    if (event.type !== 'user/message') return state
    const data = event.data
    if (typeof data !== 'object' || data === null || !('source' in data)) return state
    const source = data.source
    if (typeof source !== 'object' || source === null || !('kind' in source) || source.kind !== 'personal-memory') return state
    if (!('revision' in source) || typeof source.revision !== 'number') return state
    return { seq: event.seq, revision: source.revision }
  },
}

export const inject = ['storageDomain', 'tools', 'sandboxPolicy', 'sessionProjections']

/** Mount memory beside the shared DSH services; the browser channel is optional. */
export async function apply(ctx: Context): Promise<void> {
  const releaseLease = await acquireLease(dshHomePath('storages', 'personal_memory.lock'))
  let store: MemoryStore | undefined
  try {
    store = new MemoryStore(await ctx.storageDomain.open(memoryDomain))
    const ownedStore = store
    ctx.effect(() => () => ownedStore.close().finally(releaseLease), 'personal-memory: domain and writer lease')
    ctx.effect(() => ctx.sessionProjections.register(projection), 'personal-memory: projection')

    ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const state = ownedStore.list()
      const previous = ctx.sessionProjections.stateOf(agent.session, 'personalMemory') ?? { seq: null, revision: 0 }
      const visible = previous.seq !== null && agent.session.surface.nodes.includes(SessionSeq(previous.seq))
      if (visible && previous.revision === state.revision) return decision
      if (state.entries.length === 0 && !visible) return decision
      const message = snapshotMessage(state)
      if (visible && previous.seq !== null) {
        agent.session.append('user/message', message, {
          surfaceOp: { op: 'replace', startSeq: SessionSeq(previous.seq), endSeq: SessionSeq(previous.seq) },
          sourceEventSeqs: [SessionSeq(previous.seq)],
        })
        return decision
      }
      return { ...decision, messages: [...decision.messages, message] }
    })

    const approval = async (action: string, exec: ToolRunContext) => {
      const policy = ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
      await approveEscalation({ requestedMode: 'danger-full-access', effectiveMode: policy.mode,
        subject: 'personal memory change', justification: `${action}; changes persist across sessions in this DSH home.` },
      { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId,
        toolName: 'personal_memory', signal: exec.signal })
      exec.signal.throwIfAborted()
    }
    const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'memory_list', description: 'List saved user and agent memory with stable ids. Use before editing or deleting an entry.',
      parameters: {}, output,
      async execute() { return JSON.stringify(ownedStore.list()) },
      presentCall: () => ({ card: 'generic', title: 'Read personal memory', kind: 'read' }),
    })), 'personal-memory: tool')
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'memory_add', description: 'Add one user or agent memory entry only when the user explicitly asks you to remember it. Global durable memory is shared by sessions in this DSH home. Changes need permission or one-shot approval.',
      parameters: { kind: { type: 'string', required: true, enum: ['user', 'agent'] }, content: { type: 'string', required: true } }, output,
      async execute(args, exec) { await approval('add memory', exec); return JSON.stringify(await ownedStore.add(args.kind as MemoryKind, args.content)) },
      presentCall: () => ({ card: 'generic', title: 'Add personal memory', kind: 'other' }),
    })), 'personal-memory: tool')
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'memory_edit', description: 'Edit one saved memory entry by id only when the user explicitly asks. Read the current entries first. Changes need permission or one-shot approval.',
      parameters: { id: { type: 'string', required: true }, content: { type: 'string', required: true } }, output,
      async execute(args, exec) { await approval('edit memory', exec); return JSON.stringify(await ownedStore.edit(args.id, args.content)) },
      presentCall: () => ({ card: 'generic', title: 'Edit personal memory', kind: 'other' }),
    })), 'personal-memory: tool')
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'memory_delete', description: 'Delete one saved memory entry by id only when the user explicitly asks. Read the current entries first. Changes need permission or one-shot approval.',
      parameters: { id: { type: 'string', required: true } }, output,
      async execute(args, exec) { await approval('delete memory', exec); return JSON.stringify(await ownedStore.delete(args.id)) },
      presentCall: () => ({ card: 'generic', title: 'Delete personal memory', kind: 'other' }),
    })), 'personal-memory: tool')

    ctx.inject(['connection'], (connectionCtx) => {
      for (const endpoint of ['list', 'add', 'edit', 'delete'] as const) {
        connectionCtx.effect(() => connectionCtx.connection.fetch.register({
          path: `/api/personal-memory/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
          fetch: async request => {
            if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
              return new Response('content type must be application/json', { status: 415 })
            }
            const parsed = clientRequestSchema.safeParse(await request.json().catch(() => null))
            if (!parsed.success || parsed.data.method !== `personal-memory/${endpoint}`) {
              return new Response('invalid memory request', { status: 400 })
            }
            const result = await memoryRpc(endpoint, parsed.data.payload, request.signal, ownedStore)
            return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
          },
        }), `personal-memory: ${endpoint} RPC`)
      }
    })
  } catch (error) {
    if (store !== undefined) await store.close()
    await releaseLease()
    throw error
  }
}

const addSchema = z.object({ kind: z.enum(['user', 'agent']), content: z.string() })
const editSchema = z.object({ id: z.string().uuid(), content: z.string(), expectedRevision: z.number().int().nonnegative() })
const deleteSchema = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().nonnegative() })

async function memoryRpc(endpoint: 'list' | 'add' | 'edit' | 'delete', payload: unknown, signal: AbortSignal, store: MemoryStore) {
  try {
    signal.throwIfAborted()
    if (endpoint === 'list') return { ok: true, value: store.list() }
    let value: MemoryState
    switch (endpoint) {
      case 'add': { const body = addSchema.parse(payload); value = await store.add(body.kind, body.content); break }
      case 'edit': { const body = editSchema.parse(payload); value = await store.edit(body.id, body.content, body.expectedRevision); break }
      case 'delete': { const body = deleteSchema.parse(payload); value = await store.delete(body.id, body.expectedRevision); break }
    }
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: { code: error instanceof MemoryError ? error.code : 'memory/rejected',
      message: error instanceof Error ? error.message : String(error), details: {} } }
  }
}

function snapshotMessage(state: MemoryState) {
  const text = renderSnapshot(state)
  return createUserMessage({ content: [{ type: 'text', text }],
    source: { kind: 'personal-memory', form: 'snapshot', revision: state.revision,
      sections: [{ name: 'Saved personal memory', text }] } })
}
