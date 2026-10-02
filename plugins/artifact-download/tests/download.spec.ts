/** The protected route reads current files listed by presented and changed events. */
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, attachmentName } from '../src/index.ts'
import { DOWNLOAD_PATH, downloadRoute } from '../src/routes.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

async function fixture(chunkBytes = 8, maxBytes = 64 * 1024, eventType: 'present' | 'changes' = 'present') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-artifact-download-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const declared = { path: 'result.txt' }
  await writeFile(join(cwd, declared.path), 'current bytes')
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalFileSystem, { cwd })
  ctx.provide('sandboxPolicy', { workspaceRoot: cwd } as never)
  await ctx.plugin({ inject: ['fs', 'sandboxPolicy'], apply: scope => {
    new WorkspaceFiles(scope, { maxBytes, maxFileBytes: 64 * 1024, maxLines: 100, maxEntries: 100 })
  } })
  const changes = { turn: 1, cwd, files: [declared] }
  const summary = vi.fn((sessionId: string, seq: number) => sessionId === 'owner' && seq === 7 ? changes : undefined)
  ctx.provide('workspaceChanges', { summary } as never)
  const readEvent = vi.fn(async (request: { sessionId: string; seq: number }) => {
    if (request.sessionId !== 'owner') throw new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')
    if (request.seq !== 7) throw new SessionQueryError('missing', 'SESSION_QUERY_EVENT_NOT_FOUND')
    const target = eventType === 'present'
      ? { type: 'deliverables/presented', data: { turn: 1, callId: 'call', files: [declared] } }
      : { type: 'workspace/changes', data: { turn: 1 } }
    return { session: { cwd }, target: target as SessionEvent }
  })
  ctx.provide('sessionQuery', { readEvent } as never)
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({ inject: ['connection', 'sessionQuery', 'workspaceChanges', 'workspaceFiles', 'sandboxPolicy', 'fs'], apply: scope => apply(scope, { chunkBytes }) })
  await fiber
  const handler = connection.createSharedFetchHandler('/api')
  const fetchFile = (query = '?sessionId=owner&seq=7&index=0', method = 'GET', signal?: AbortSignal) => handler.fetch(
    new Request(`http://localhost${DOWNLOAD_PATH}${query}`, { method, signal: signal ?? null }),
  )
  return { root, cwd, declared, changes, summary, readEvent, fetchFile, ctx, fiber }
}

describe('artifact download', () => {
  it('downloads the selected changed file, including its current text, binary, and empty versions', async () => {
    const { cwd, changes, fetchFile } = await fixture(8, 64 * 1024, 'changes')
    changes.files.push({ path: 'second.bin' })
    const second = join(cwd, 'second.bin')
    await writeFile(second, 'original')
    expect((await fetchFile('?sessionId=owner&seq=7&index=1', 'HEAD')).headers.get('content-disposition')).toContain('second.bin')
    for (const bytes of [new TextEncoder().encode('latest text'), Uint8Array.from([0, 255, 80, 75]), new Uint8Array()]) {
      await writeFile(second, bytes)
      const response = await fetchFile('?sessionId=owner&seq=7&index=1')
      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    }
    expect(await (await fetchFile('?sessionId=owner&seq=7&index=0')).text()).toBe('current bytes')
  })

  it('rejects missing change summaries, mismatched turns, invalid indices, and unrelated events', async () => {
    const { changes, summary, readEvent, fetchFile } = await fixture(8, 64 * 1024, 'changes')
    expect((await fetchFile('?sessionId=owner&seq=7&index=1')).status).toBe(404)
    changes.turn = 2
    expect((await fetchFile()).status).toBe(404)
    changes.turn = 1
    summary.mockReturnValueOnce(undefined)
    expect((await fetchFile()).status).toBe(404)
    readEvent.mockResolvedValueOnce({ session: { cwd: changes.cwd }, target: { type: 'turn/start' } as SessionEvent })
    expect((await fetchFile()).status).toBe(404)
  })

  it('rejects a removed changed file and a relative path redirected outside its workspace', async () => {
    const { root, cwd, changes, fetchFile } = await fixture(8, 64 * 1024, 'changes')
    await unlink(join(cwd, 'result.txt'))
    expect((await fetchFile()).status).toBe(404)
    const external = join(root, 'external')
    await mkdir(external)
    await writeFile(join(external, 'result.txt'), 'outside')
    await symlink(external, join(cwd, 'reports'), 'dir')
    changes.files[0].path = 'reports/result.txt'
    expect((await fetchFile(undefined, 'HEAD')).status).toBe(404)
  })

  it('preflights through HEAD and downloads current text without moving the source', async () => {
    const { cwd, fetchFile } = await fixture()
    const source = join(cwd, 'result.txt')
    const head = await fetchFile(undefined, 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    expect(head.headers.get('content-disposition')).toContain('result.txt')
    expect(head.headers.get('cache-control')).toBe('no-store')
    for (const text of ['current bytes', 'updated bytes']) {
      await writeFile(source, text)
      expect(await (await fetchFile()).text()).toBe(text)
    }
  })

  it('streams binary, empty, and files larger than the complete-read cap', async () => {
    const { cwd, fetchFile } = await fixture(32 * 1024)
    const source = join(cwd, 'result.txt')
    const binary = Uint8Array.from([0, 255, 80, 75])
    await writeFile(source, binary)
    expect(new Uint8Array(await (await fetchFile()).arrayBuffer())).toEqual(binary)
    await writeFile(source, '')
    expect((await fetchFile()).headers.get('content-length')).toBe('0')
    expect(new Uint8Array(await (await fetchFile()).arrayBuffer())).toHaveLength(0)
    const large = Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, index) => index % 251)
    await writeFile(source, large)
    expect(new Uint8Array(await (await fetchFile()).arrayBuffer())).toEqual(large)
  })

  it('adapts its byte window when the workspace file service has a smaller cap', async () => {
    const { fetchFile } = await fixture(16, 4)
    expect((await fetchFile(undefined, 'HEAD')).status).toBe(200)
    expect(await (await fetchFile()).text()).toBe('current bytes')
  })

  it.each(['', '?seq=7&index=0', '?sessionId=owner&index=0', '?sessionId=owner&seq=7',
    '?sessionId=owner&seq=-1&index=0', '?sessionId=owner&seq=7&index=1.5',
    '?sessionId=owner&seq=9007199254740992&index=0',
  ])('rejects invalid coordinates: %s', async query => {
    const { fetchFile, readEvent } = await fixture()
    expect((await fetchFile(query)).status).toBe(400)
    expect(readEvent).not.toHaveBeenCalled()
  })

  it('rejects other Sessions, events, indices, and undeclared files', async () => {
    const { fetchFile, readEvent } = await fixture()
    expect((await fetchFile('?sessionId=other&seq=7&index=0')).status).toBe(404)
    expect((await fetchFile('?sessionId=owner&seq=8&index=0')).status).toBe(404)
    expect((await fetchFile('?sessionId=owner&seq=7&index=1')).status).toBe(404)
    readEvent.mockResolvedValueOnce({ session: { cwd: '' }, target: { type: 'turn/start' } as SessionEvent })
    expect((await fetchFile()).status).toBe(404)
  })

  it('rejects missing files, directories, and final symlinks', async () => {
    const { cwd, declared, fetchFile } = await fixture()
    const source = join(cwd, declared.path)
    await unlink(source)
    expect((await fetchFile()).status).toBe(404)
    declared.path = '.'
    expect((await fetchFile()).status).toBe(404)
    declared.path = 'link.txt'
    await symlink(join(cwd, 'target.txt'), join(cwd, declared.path))
    await writeFile(join(cwd, 'target.txt'), 'secret')
    expect((await fetchFile()).status).toBe(404)
  })

  it('rejects a relative declaration redirected outside the workspace by a parent symlink', async () => {
    const { root, cwd, declared, fetchFile } = await fixture()
    const external = join(root, 'external')
    await mkdir(external)
    await writeFile(join(external, 'result.txt'), 'outside')
    declared.path = 'reports/result.txt'
    await symlink(external, join(cwd, 'reports'), 'dir')
    expect((await fetchFile(undefined, 'HEAD')).status).toBe(404)
    expect((await fetchFile()).status).toBe(404)
  })

  it('allows an explicitly declared absolute file when the composed filesystem can read it', async () => {
    const { root, declared, fetchFile } = await fixture()
    const outside = join(root, 'explicit.txt')
    await writeFile(outside, 'explicit file')
    declared.path = outside
    expect(await (await fetchFile()).text()).toBe('explicit file')
  })

  it('keeps reading the resolved source when a relative directory link changes after GET', async () => {
    const { cwd, declared, fetchFile } = await fixture(4)
    const first = join(cwd, 'first')
    const second = join(cwd, 'second')
    await mkdir(first)
    await mkdir(second)
    await writeFile(join(first, 'report.txt'), 'first source')
    await writeFile(join(second, 'report.txt'), 'other source')
    const alias = join(cwd, 'reports')
    await symlink(first, alias, 'dir')
    declared.path = 'reports/report.txt'
    const response = await fetchFile()
    await unlink(alias)
    await symlink(second, alias, 'dir')
    expect(await response.text()).toBe('first source')
  })

  it('fails a stream when the source changes after its first chunk', async () => {
    const { cwd, fetchFile } = await fixture(4)
    const response = await fetchFile()
    const reader = response.body!.getReader()
    expect(new Uint8Array((await reader.read()).value!)).toEqual(new TextEncoder().encode('curr'))
    await writeFile(join(cwd, 'result.txt'), 'replacement with different size')
    await expect(reader.read()).rejects.toThrow('File changed while downloading')
  })

  it('does not enqueue bytes changed between a range read and its post-read stat', async () => {
    const { cwd, ctx, fetchFile } = await fixture(4)
    const source = join(cwd, 'result.txt')
    const read = ctx.workspaceFiles.readBytes.bind(ctx.workspaceFiles)
    vi.spyOn(ctx.workspaceFiles, 'readBytes').mockImplementation(async (...args) => {
      const part = await read(...args)
      await writeFile(source, 'replacement with a different size')
      return part
    })
    const response = await fetchFile()
    await expect(response.text()).rejects.toThrow('File changed while downloading')
  })

  it('aborts an unread response when the plugin unloads', async () => {
    const { fetchFile, fiber } = await fixture()
    const response = await fetchFile()
    await fiber.dispose()
    await expect(response.text()).rejects.toThrow()
    expect((await fetchFile()).status).toBe(404)
  })

  it('cancels the stream without removing the source', async () => {
    const { cwd, fetchFile } = await fixture()
    const response = await fetchFile()
    await response.body!.cancel()
    await expect((await import('node:fs/promises')).readFile(join(cwd, 'result.txt'), 'utf8')).resolves.toBe('current bytes')
  })

  it('builds safe names and preserves only the event coordinates in the browser URL', () => {
    expect(attachmentName('dir\\report\r\n.xlsx')).toBe('report__.xlsx')
    expect(downloadRoute('api/present.open?sessionId=owner&seq=7&index=0'))
      .toBe('api/artifact.download?sessionId=owner&seq=7&index=0')
    expect(downloadRoute('api/changes.open?sessionId=owner&seq=7&index=1'))
      .toBe('api/artifact.download?sessionId=owner&seq=7&index=1')
    expect(() => downloadRoute('api/other?sessionId=owner')).toThrow()
  })

  it('quotes a filename apostrophe in the UTF-8 download header', async () => {
    const { cwd, declared, fetchFile } = await fixture()
    declared.path = "O'Brien.txt"
    await writeFile(join(cwd, declared.path), 'named file')
    expect((await fetchFile(undefined, 'HEAD')).headers.get('content-disposition'))
      .toContain("filename*=UTF-8''O%27Brien.txt")
  })
})
