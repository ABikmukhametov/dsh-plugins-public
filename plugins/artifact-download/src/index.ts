/** Authenticated streaming download for one presented or changed file. */
import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-workspace-files'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { DOWNLOAD_PATH } from './routes.ts'

export const name = 'artifact-download'
export const inject = ['connection', 'sessionQuery', 'workspaceChanges', 'workspaceFiles', 'sandboxPolicy', 'fs']

/** Size of each bounded filesystem read; the file itself has no limit. */
export interface Config { readonly chunkBytes: number }
export const Config: Schema<Config> = Schema.object({
  chunkBytes: Schema.number().step(1).min(1).max(2 * 1024 * 1024).default(64 * 1024),
})

const NUMERIC = /^\d+$/
function coordinate(value: string | null): number | undefined {
  return value !== null && NUMERIC.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
}

function filePath(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('path' in value)) return undefined
  return typeof value.path === 'string' && value.path.trim() !== '' ? value.path : undefined
}

function declaredPath(data: unknown, index: number): string | undefined {
  if (typeof data !== 'object' || data === null || !('files' in data) || !Array.isArray(data.files)) return undefined
  return filePath(data.files[index])
}

/** Keep the original readable name while preventing header injection and path separators. */
export function attachmentName(path: string): string {
  const base = path.split(/[\\/]/u).at(-1) ?? ''
  const cleaned = base.replace(/[\x00-\x1f\x7f]/gu, '_').replace(/[\\/]/gu, '_').trim()
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'artifact' : cleaned
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

function failureStatus(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code
    if (code === 'SESSION_QUERY_SESSION_NOT_FOUND' || code === 'SESSION_QUERY_EVENT_NOT_FOUND'
      || code === 'workspace-file/not-found' || code === 'workspace-file/not-regular-file'
      || code === 'ENOENT' || code === 'ENOTDIR') return 404
  }
  return 500
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/** Relative declarations may not reach a different tree through `..` or an ancestor link. */
async function relativePathAllowed(ctx: Context, path: string, workspaceRoot: string, signal: AbortSignal): Promise<boolean> {
  if (posix.isAbsolute(path) || win32.isAbsolute(path)) return true
  const root = await ctx.fs.resolve(workspaceRoot, { signal })
  const target = await ctx.fs.resolve(path, { cwd: workspaceRoot, signal })
  return ctx.fs.contains(root, target)
}

/** Resolve a file listed by a Session event and serve its current bytes in bounded chunks. */
async function artifactDownloadResponse(ctx: Context, request: Request, chunkBytes: number, active: Set<Promise<unknown>>): Promise<Response> {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  const index = coordinate(query.get('index'))
  if (!id || seq === undefined || index === undefined) return new Response('Invalid file coordinates.', { status: 400 })
  try {
    request.signal.throwIfAborted()
    const { target, session } = await ctx.sessionQuery.readEvent({
      sessionId: id as SessionId, seq: seq as SessionSeq, before: 0, after: 0,
    }, request.signal)
    const scope = { sessionId: id as SessionId, workspaceRoot: session.cwd ?? ctx.sandboxPolicy.workspaceRoot }
    let path: string | undefined
    if (target.type === 'deliverables/presented') {
      path = declaredPath(target.data, index)
    } else if (target.type === 'workspace/changes') {
      const summary = ctx.workspaceChanges.summary(scope.sessionId, seq)
      if (summary !== undefined && summary.turn === target.data.turn) {
        path = filePath(summary.files[index])
        scope.workspaceRoot = summary.cwd
      }
    }
    if (path === undefined) return new Response('File not found in this Session event.', { status: 404 })
    if (!await relativePathAllowed(ctx, path, scope.workspaceRoot, request.signal)) {
      return new Response('File unavailable.', { status: 404 })
    }
    const initial = await ctx.workspaceFiles.stat(scope, path, request.signal)
    if (!await relativePathAllowed(ctx, path, scope.workspaceRoot, request.signal)) {
      return new Response('File unavailable.', { status: 404 })
    }
    const sourcePath = initial.absolutePath
    request.signal.throwIfAborted()
    const headers = new Headers({
      'content-type': 'application/octet-stream',
      'content-disposition': contentDisposition(attachmentName(path)),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    if (initial.bytes !== undefined) headers.set('content-length', String(initial.bytes))
    if (request.method === 'HEAD') {
      const probe = await ctx.workspaceFiles.readBytes(scope, sourcePath, { range: { offset: 0, length: 1 } }, request.signal)
      const after = await ctx.workspaceFiles.stat(scope, sourcePath, request.signal)
      if (probe.version !== initial.version || after.version !== initial.version
        || probe.bytes !== initial.bytes || after.bytes !== initial.bytes) {
        return new Response('File changed.', { status: 409 })
      }
      return new Response(null, { headers })
    }
    const cancel = new AbortController()
    const signal = AbortSignal.any([request.signal, cancel.signal])
    let offset = 0
    let windowBytes = chunkBytes
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const work = (async () => {
          signal.throwIfAborted()
          let part
          for (;;) {
            try {
              part = await ctx.workspaceFiles.readBytes(scope, sourcePath, { range: { offset, length: windowBytes } }, signal)
              break
            } catch (error) {
              if (!hasCode(error, 'workspace-file/too-large') || windowBytes === 1) throw error
              windowBytes = Math.max(1, Math.floor(windowBytes / 2))
            }
          }
          const after = await ctx.workspaceFiles.stat(scope, sourcePath, signal)
          if (part.version !== initial.version || part.bytes !== initial.bytes
            || after.version !== initial.version || after.bytes !== initial.bytes) {
            throw new Error('File changed while downloading')
          }
          if (part.data.byteLength === 0 && !part.eof) throw new Error('File read made no progress')
          offset += part.data.byteLength
          if (part.data.byteLength > 0) controller.enqueue(part.data)
          if (part.eof) controller.close()
        })().catch(error => {
          controller.error(error)
        })
        active.add(work)
        return work.finally(() => { active.delete(work) })
      },
      cancel() { cancel.abort() },
    }, { highWaterMark: 0 })
    return new Response(body, { headers })
  } catch (error) {
    request.signal.throwIfAborted()
    return new Response('File unavailable.', { status: failureStatus(error) })
  }
}

/** Register the route behind Connection's existing authentication fence. */
export function apply(ctx: Context, config: Config): void {
  const lifetime = new AbortController()
  const active = new Set<Promise<unknown>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(active)
  }, 'artifact-download: active transfers')
  ctx.effect(() => ctx.connection.fetch.register({
    path: DOWNLOAD_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: request => {
      const linked = new Request(request, { signal: AbortSignal.any([request.signal, lifetime.signal]) })
      const task = artifactDownloadResponse(ctx, linked, config.chunkBytes, active)
      active.add(task)
      void task.then(() => { active.delete(task) }, () => { active.delete(task) })
      return task
    },
  }), 'artifact-download: route')
}
