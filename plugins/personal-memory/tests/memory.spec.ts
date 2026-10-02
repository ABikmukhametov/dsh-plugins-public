import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as PersonalMemory from '../src/index.ts'
import { acquireLease, MemoryStore, memoryDomain, MAX_ENTRIES_PER_KIND } from '../src/store.ts'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'

const directories: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.unstubAllEnvs()
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-personal-memory-'))
  directories.push(path)
  vi.stubEnv('DSH_HOME', path)
  return path
}

async function storage(path: string) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(path, 'storages') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return ctx
}

async function harness(path: string, adapter: MockAdapter, policy: 'danger-full-access' | 'read-only' = 'danger-full-access', persistent = false) {
  const ctx = await storage(path)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (persistent) await ctx.plugin(JsonlSessionPersistence, { root: join(path, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SandboxPolicy, { mode: policy })
  const memory = await ctx.plugin(PersonalMemory)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, memory }
}

function waitForIdle(ctx: Context, agent: { id: SessionId }): Promise<void> {
  return new Promise(resolve => {
    const off = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject.id === agent.id && status === 'idle') { off(); resolve() }
    })
  })
}

describe('personal memory', () => {
  it('persists agent-added memory and injects it once in a new dialogue', async () => {
    const path = await home()
    const adapter = new MockAdapter([textResponse('first'), textResponse('second'), textResponse('third')])
    const { ctx, memory } = await harness(path, adapter)
    const a = await ctx.agentLoop.create(SessionId('memory-a'), { provider: 'mock', model: 'mock' })
    const added = await ctx.tools.execute({ callId: ToolCallId('memory-add'), name: 'memory_add',
      arguments: { kind: 'user', content: 'I prefer concise answers.' }, agent: a, signal: new AbortController().signal })
    expect(added.isError).toBe(false)

    const b = await ctx.agentLoop.create(SessionId('memory-b'), { provider: 'mock', model: 'mock' })
    const idle = waitForIdle(ctx, b)
    b.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
    await idle
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('I prefer concise answers.')
    expect(b.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'personal-memory')).toHaveLength(1)
    const again = waitForIdle(ctx, b)
    b.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await again
    expect(b.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'personal-memory')).toHaveLength(1)
    await memory.dispose()
    await ctx.fiber.dispose()

    const persisted = JSON.parse(await readFile(join(path, 'storages', 'personal_memory.json'), 'utf8'))
    expect(JSON.stringify(persisted)).toContain('I prefer concise answers.')
    const adapter2 = new MockAdapter([textResponse('after restart')])
    const next = await harness(path, adapter2)
    const c = await next.ctx.agentLoop.create(SessionId('memory-c'), { provider: 'mock', model: 'mock' })
    const nextIdle = waitForIdle(next.ctx, c)
    c.followup(createUserMessage({ content: [{ type: 'text', text: 'new chat' }], source: { kind: 'user' } }))
    await nextIdle
    expect(JSON.stringify(adapter2.requests[0]?.messages)).toContain('I prefer concise answers.')
    await next.memory.dispose()
    await next.ctx.fiber.dispose()
  })

  it('replaces the visible snapshot in the next model request after editing', async () => {
    const path = await home()
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const { ctx, memory } = await harness(path, adapter)
    const agent = await ctx.agentLoop.create(SessionId('memory-edit'), { provider: 'mock', model: 'mock' })
    const add = await ctx.tools.execute({ callId: ToolCallId('memory-add'), name: 'memory_add',
      arguments: { kind: 'agent', content: 'Old fact' }, agent, signal: new AbortController().signal })
    expect(add.isError).toBe(false)
    let idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await idle
    const list = await ctx.tools.execute({ callId: ToolCallId('memory-list'), name: 'memory_list',
      arguments: {}, agent, signal: new AbortController().signal })
    const id = JSON.parse(String(list.value)).entries[0].id as string
    const edit = await ctx.tools.execute({ callId: ToolCallId('memory-edit'), name: 'memory_edit',
      arguments: { id, content: 'New fact' }, agent, signal: new AbortController().signal })
    expect(edit.isError).toBe(false)
    idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await idle
    const request = JSON.stringify(adapter.requests[1]?.messages)
    expect(request).toContain('New fact')
    expect(request).not.toContain('Old fact')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'personal-memory')).toHaveLength(2)
    await memory.dispose()
  })

  it('restores a snapshot after surface compaction hides the prior copy', async () => {
    const path = await home()
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const { ctx } = await harness(path, adapter)
    const agent = await ctx.agentLoop.create(SessionId('memory-compact'), { provider: 'mock', model: 'mock' })
    const added = await ctx.tools.execute({ callId: ToolCallId('memory-add'), name: 'memory_add',
      arguments: { kind: 'user', content: 'Compacted fact' }, agent, signal: new AbortController().signal })
    expect(added.isError).toBe(false)
    let idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await idle
    const snapshot = agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'personal-memory')
    if (snapshot?.type !== 'user/message') throw new Error('memory snapshot missing')
    agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'compacted summary' }], source: { kind: 'user' } }), {
      surfaceOp: { op: 'replace', startSeq: snapshot.seq, endSeq: snapshot.seq }, sourceEventSeqs: [snapshot.seq],
    })
    idle = waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await idle
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'personal-memory')).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('Compacted fact')
  })

  it('resumes a persisted dialogue without adding a duplicate snapshot', async () => {
    const path = await home()
    const first = await harness(path, new MockAdapter([textResponse('one')]), 'danger-full-access', true)
    const agent = await first.ctx.agentLoop.create(SessionId('memory-resume'), { provider: 'mock', model: 'mock' })
    const added = await first.ctx.tools.execute({ callId: ToolCallId('memory-add'), name: 'memory_add',
      arguments: { kind: 'agent', content: 'Resumed fact' }, agent, signal: new AbortController().signal })
    expect(added.isError).toBe(false)
    const idle = waitForIdle(first.ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await idle
    await first.ctx.fiber.dispose()

    const adapter = new MockAdapter([textResponse('two')])
    const next = await harness(path, adapter, 'danger-full-access', true)
    const resumed = await next.ctx.agents.resume({ resumeSessionId: SessionId('memory-resume'), agentOptions: { provider: 'mock', model: 'mock' } })
    const nextIdle = waitForIdle(next.ctx, resumed.agent)
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await nextIdle
    expect(resumed.agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'personal-memory')).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('Resumed fact')
  })

  it('rejects an unapproved agent edit and serializes access across Hosts', async () => {
    const path = await home()
    const { ctx } = await harness(path, new MockAdapter([]), 'read-only')
    const agent = await ctx.agentLoop.create(SessionId('memory-unapproved'), { provider: 'mock', model: 'mock' })
    const result = await ctx.tools.execute({ callId: ToolCallId('memory-rejected'), name: 'memory_add',
      arguments: { kind: 'user', content: 'Do not persist' }, agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    const list = await ctx.tools.execute({ callId: ToolCallId('memory-still-empty'), name: 'memory_list',
      arguments: {}, agent, signal: new AbortController().signal })
    expect(JSON.parse(String(list.value)).entries).toEqual([])
    const leasePath = join(path, 'storages', 'personal_memory.lock')
    await expect(acquireLease(leasePath)).rejects.toHaveProperty('code', 'memory/unavailable')
    await ctx.fiber.dispose()
    const release = await acquireLease(leasePath)
    await release()
  })

  it('enforces kind, entry and total-context limits without evicting data', async () => {
    const path = await home()
    const ctx = await storage(path)
    const store = new MemoryStore(await ctx.storageDomain.open(memoryDomain))
    for (let n = 0; n < MAX_ENTRIES_PER_KIND; n++) await store.add('user', `${'x'.repeat(1988)}${n}`)
    await expect(store.add('user', 'overflow')).rejects.toThrow('full')
    await expect(store.add('agent', 'x'.repeat(2001))).rejects.toThrow('2000')
    let budgetRejected = false
    for (let n = 0; n < MAX_ENTRIES_PER_KIND; n++) {
      const before = store.list()
      try { await store.add('agent', `${'y'.repeat(1988)}${n}`) }
      catch (error) {
        expect(error).toHaveProperty('code', 'memory/full')
        expect(store.list()).toEqual(before)
        budgetRejected = true
        break
      }
    }
    expect(budgetRejected).toBe(true)
    expect(store.list().entries.length).toBeGreaterThan(10)
    await store.close()
  })
})
