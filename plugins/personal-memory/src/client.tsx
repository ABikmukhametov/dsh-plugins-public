/** Web Settings page for viewing and manually changing personal memory. */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc, ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

type Kind = 'user' | 'agent'
interface Entry { id: string; kind: Kind; content: string; createdAt: string; updatedAt: string }
interface State { revision: number; entries: Entry[] }
interface Face { rpc: ClientConnectionRpc; t: (key: Key) => string }

export const en = {
  nav: 'Memory', title: 'Personal memory', intro: 'Saved entries are shared by chats in this DSH home and included in new chats.',
  user: 'About you', agent: 'About the agent', empty: 'No entries yet', add: 'Add', edit: 'Edit', save: 'Save', cancel: 'Cancel',
  delete: 'Delete', confirm: 'Confirm delete', refresh: 'Refresh', loading: 'Loading…', failed: 'Could not load memory. Try again.',
  placeholder: 'Write one fact to remember', content: 'Memory text', changed: 'Memory changed. Reload and try again.',
  full: 'Memory is full. Remove or shorten an entry before saving.', duplicate: 'This entry is already saved.',
  invalid: 'Enter 1–2000 characters.', missing: 'This entry was removed. Refresh the list.',
} as const
type Key = keyof typeof en
const zh: Record<Key, string> = {
  nav: '记忆', title: '个人记忆', intro: '保存的记录在此 DSH 主目录中的对话间共享，并加入新对话。',
  user: '关于你', agent: '关于代理', empty: '暂无记录', add: '添加', edit: '编辑', save: '保存', cancel: '取消',
  delete: '删除', confirm: '确认删除', refresh: '刷新', loading: '加载中…', failed: '无法读取记忆，请重试。',
  placeholder: '写下要记住的一条事实', content: '记忆内容', changed: '记忆已变化，请刷新后重试。',
  full: '记忆已满。保存前请删除或缩短一条记录。', duplicate: '此记录已保存。', invalid: '请输入 1–2000 个字符。', missing: '此记录已删除，请刷新列表。',
}
const ru: Record<Key, string> = {
  nav: 'Память', title: 'Долговременная память', intro: 'Записи общие для диалогов в этом DSH_HOME и попадают в новые диалоги.',
  user: 'О пользователе', agent: 'Об агенте', empty: 'Записей пока нет', add: 'Добавить', edit: 'Изменить', save: 'Сохранить', cancel: 'Отмена',
  delete: 'Удалить', confirm: 'Подтвердить удаление', refresh: 'Обновить', loading: 'Загрузка…', failed: 'Не удалось загрузить память. Повторите попытку.',
  placeholder: 'Один факт для запоминания', content: 'Текст записи', changed: 'Память изменилась. Обновите список и повторите.',
  full: 'Память заполнена. Удалите или сократите запись.', duplicate: 'Такая запись уже есть.',
  invalid: 'Введите от 1 до 2000 символов.', missing: 'Запись уже удалена. Обновите список.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal-memory Settings page text. */
    'settings.personalMemory': Key
  }
}

const card: CSSProperties = { border: '1px solid var(--dsw-alias-settings-card-stroke)', background: 'var(--dsw-alias-settings-card-fill)',
  borderRadius: 'var(--dsw-radius-xl)', padding: 14, display: 'grid', gap: 10 }
const field: CSSProperties = { width: '100%', boxSizing: 'border-box', color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-settings-card-fill)', border: '1px solid var(--dsw-alias-settings-card-stroke)',
  borderRadius: 'var(--dsw-radius-md)', padding: 8, font: 'inherit' }
const button: CSSProperties = { color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-settings-card-fill)',
  border: '1px solid var(--dsw-alias-settings-card-stroke)', borderRadius: 'var(--dsw-radius-md)', padding: '6px 10px', cursor: 'pointer' }

function isState(value: unknown): value is State {
  if (typeof value !== 'object' || value === null || !('revision' in value) || !('entries' in value)) return false
  if (typeof value.revision !== 'number' || !Array.isArray(value.entries)) return false
  return value.entries.every((entry: unknown) => typeof entry === 'object' && entry !== null
    && 'id' in entry && typeof entry.id === 'string' && 'content' in entry && typeof entry.content === 'string'
    && 'kind' in entry && (entry.kind === 'user' || entry.kind === 'agent'))
}

/** Stateful section whose Host operations share the same store as agent tools. */
export function MemorySection({ rpc, t }: Face) {
  const [state, setState] = useState<State>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<Kind>('user')
  const [editing, setEditing] = useState<string>()
  const [deleting, setDeleting] = useState<string>()

  async function call(endpoint: string, payload: object): Promise<State> {
    const result = await rpc.call('/api', `personal-memory/${endpoint}`, payload)
    if (!result.ok) throw new Error(result.error.code)
    if (!isState(result.value)) throw new Error('memory/invalid-response')
    return result.value
  }
  async function refresh() {
    setBusy(true)
    try { setState(await call('list', {})); setError('') }
    catch { setError(t('failed')) }
    finally { setBusy(false) }
  }
  useEffect(() => { void refresh() }, [rpc])

  async function change(endpoint: string, payload: object) {
    setBusy(true)
    try {
      const updated = await call(endpoint, payload)
      setState(updated)
      setDraft(''); setEditing(undefined); setDeleting(undefined); setError('')
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : ''
      const label: Key = code === 'memory/conflict' ? 'changed' : code === 'memory/full' ? 'full'
        : code === 'memory/duplicate' ? 'duplicate' : code === 'memory/invalid' ? 'invalid'
          : code === 'memory/not-found' ? 'missing' : 'failed'
      setError(t(label))
    } finally { setBusy(false) }
  }
  return <div style={{ display: 'grid', gap: 16, maxWidth: 720, color: 'var(--dsw-alias-label-primary)', fontSize: 13 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{t('title')}</h2>
      <button type="button" style={button} disabled={busy} onClick={() => { void refresh() }}>{t('refresh')}</button>
    </header>
    <p style={{ margin: 0, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }}>{t('intro')}</p>
    {error && <p role="alert" style={{ margin: 0, color: 'var(--dsw-alias-state-warn-label)' }}>{error}</p>}
    {!state && !error && <p>{t('loading')}</p>}
    {state && (['user', 'agent'] as const).map(group => <section key={group} style={{ display: 'grid', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{t(group)} ({state.entries.filter(entry => entry.kind === group).length}/10)</h3>
      {state.entries.filter(entry => entry.kind === group).length === 0 && <p style={{ margin: 0 }}>{t('empty')}</p>}
      {state.entries.filter(entry => entry.kind === group).map(entry => <div key={entry.id} style={card}>
        {editing === entry.id ? <>
          <label htmlFor={`memory-${entry.id}`}>{t('content')}</label>
          <textarea id={`memory-${entry.id}`} style={field} maxLength={2000} rows={3} value={draft} onChange={event => { setDraft(event.target.value) }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={button} disabled={busy || !draft.trim()} onClick={() => { void change('edit', { id: entry.id, content: draft, expectedRevision: state.revision }) }}>{t('save')}</button>
            <button type="button" style={button} onClick={() => { setEditing(undefined); setDraft('') }}>{t('cancel')}</button>
          </div>
        </> : <>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.content}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={button} disabled={busy} onClick={() => { setEditing(entry.id); setDraft(entry.content); setDeleting(undefined) }}>{t('edit')}</button>
            <button type="button" style={button} disabled={busy} onClick={() => { if (deleting === entry.id) void change('delete', { id: entry.id, expectedRevision: state.revision }); else setDeleting(entry.id) }}>{t(deleting === entry.id ? 'confirm' : 'delete')}</button>
            {deleting === entry.id && <button type="button" style={button} onClick={() => { setDeleting(undefined) }}>{t('cancel')}</button>}
          </div>
        </>}
      </div>)}
    </section>)}
    {state && <div style={card}>
      <label htmlFor="personal-memory-new">{t('content')}</label>
      <select style={field} aria-label={t('title')} value={kind} onChange={event => { setKind(event.target.value as Kind) }}>
        <option value="user">{t('user')}</option><option value="agent">{t('agent')}</option>
      </select>
      <textarea id="personal-memory-new" style={field} maxLength={2000} rows={3} placeholder={t('placeholder')} value={editing ? '' : draft}
        disabled={editing !== undefined} onChange={event => { setDraft(event.target.value) }} />
      <button type="button" style={button} disabled={busy || editing !== undefined || !draft.trim()} onClick={() => { void change('add', { kind, content: draft }) }}>{t('add')}</button>
    </div>}
  </div>
}

export const inject = ['slots', 'locale', 'connection']

/** Register an independent Settings section while this client plugin is enabled. */
export function apply(ctx: Context): void {
  const ns = 'settings.personalMemory'
  const connection = Reflect.get(ctx, 'connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register(ns, { en, zh }), 'personal-memory: dictionaries')
  ctx.effect(() => ctx.locale.register(ns, 'ru', ru), 'personal-memory: Russian dictionary')
  const t = ctx.locale.bind(ns)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'personal-memory', order: 35, label: () => t('nav'), locale: ns,
    inject: (): Face => ({ rpc: connection.rpc, t }),
  }, MemorySection))
}
