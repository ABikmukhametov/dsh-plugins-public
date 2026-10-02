/** One browser download action beside a presented or reviewed file. */
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconDownloadOutlineRegular, IconWarningOutlineRegular, Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { downloadRoute } from './routes.ts'

const NS = 'artifact-download'
export const en = { download: 'Download', missing: 'File is unavailable. Try again.', failed: 'Could not start the download. Try again.', started: 'Download started' } as const
type Key = keyof typeof en
export const zh: Record<Key, string> = { download: '下载', missing: '文件不可用，请重试', failed: '无法开始下载，请重试', started: '已开始下载' }
export const ru: Record<Key, string> = { download: 'Скачать', missing: 'Файл недоступен. Повторите попытку.', failed: 'Не удалось начать загрузку. Повторите попытку.', started: 'Загрузка началась' }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Download control on a declared file. */
    'artifact-download': Key
  }
}

/** Check availability before handing the authenticated route to the browser. */
export function DownloadAction({ actionUrl, t }: Pick<PropsRuntime<'deliverables.file.actions'>, 'actionUrl'> & { t: (key: Key) => string }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ id: number; key: 'missing' | 'failed' | 'started' } | null>(null)
  const seq = useRef(0)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  async function download() {
    if (active.current !== null) return
    const abort = new AbortController()
    active.current = abort
    setBusy(true)
    try {
      const route = downloadRoute(actionUrl)
      const response = await fetch(route, { method: 'HEAD', signal: abort.signal })
      if (!response.ok) throw new Error(response.status === 404 ? 'missing' : 'failed')
      const anchor = document.createElement('a')
      anchor.href = route
      anchor.download = ''
      anchor.click()
      seq.current += 1
      setNotice({ id: seq.current, key: 'started' })
    } catch (error) {
      if (!abort.signal.aborted) {
        seq.current += 1
        setNotice({ id: seq.current, key: error instanceof Error && error.message === 'missing' ? 'missing' : 'failed' })
      }
    } finally {
      active.current = null
      setBusy(false)
    }
  }
  return <>
    <Tooltip portal side="bottom" label={t('download')}>
      <Button variant="toolbar" size="sm" style={{ width: 24, height: 24, padding: 0, borderRadius: 6 }} aria-label={t('download')} disabled={busy}
        icon={<IconDownloadOutlineRegular size={13} />} onClick={() => { void download() }} />
    </Tooltip>
    {notice !== null && <Toast key={notice.id} text={t(notice.key)}
      {...notice.key === 'started' ? { tone: 'success' as const } : { icon: <IconWarningOutlineRegular /> }}
      onDone={() => { setNotice(current => current?.id === notice.id ? null : current) }} />}
  </>
}

export const inject = ['slots', 'locale']

/** Register both file actions without requiring a desktop file opener. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'artifact-download: dictionaries')
  ctx.effect(() => ctx.locale.register(NS, 'ru', ru), 'artifact-download: Russian dictionary')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('deliverables.file.actions', () => ctx.slots.register({
    name: 'deliverables.file.actions', id: 'artifact-download', order: -20, locale: NS,
    inject: () => ({ t }),
  }, DownloadAction))
  ctx.slots.inject('deliverables.review.file.actions', () => ctx.slots.register({
    name: 'deliverables.review.file.actions', id: 'artifact-download', order: -20, locale: NS,
    inject: () => ({ t }),
  }, DownloadAction))
}
