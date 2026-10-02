// @vitest-environment jsdom
/** File actions preflight before starting a browser download. */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DownloadAction, apply, en, ru, zh } from '../src/client.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('renders the action independently of desktop availability and downloads on successful HEAD', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.getAttribute('href')).toBe('api/artifact.download?sessionId=owner&seq=7&index=0')
    expect(this.hasAttribute('download')).toBe(true)
  })
  const view = render(<DownloadAction actionUrl="api/present.open?sessionId=owner&seq=7&index=0" t={key => ru[key]} />)
  fireEvent.click(view.getByRole('button', { name: ru.download }))
  await waitFor(() => expect(click).toHaveBeenCalledOnce())
  expect(fetcher).toHaveBeenCalledWith('api/artifact.download?sessionId=owner&seq=7&index=0',
    expect.objectContaining({ method: 'HEAD' }))
  expect(view.getByRole('alert').textContent).toContain(ru.started)
})

it('shows a localized error and leaves the card action available after a missing file', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
  const view = render(<DownloadAction actionUrl="api/present.open?sessionId=owner&seq=7&index=0" t={key => en[key]} />)
  fireEvent.click(view.getByRole('button', { name: en.download }))
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain(en.missing))
  expect(view.getByRole('button', { name: en.download }).hasAttribute('disabled')).toBe(false)
  expect([en.download, zh.download, ru.download]).toEqual(['Download', '下载', 'Скачать'])
})

it('uses the selected changed-file coordinates in review without desktop availability', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const view = render(<DownloadAction actionUrl="api/changes.open?sessionId=owner&seq=7&index=0" t={key => ru[key]} />)
  fireEvent.click(view.getByRole('button', { name: ru.download }))
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
  view.rerender(<DownloadAction actionUrl="api/changes.open?sessionId=owner&seq=7&index=1" t={key => ru[key]} />)
  fireEvent.click(view.getByRole('button', { name: ru.download }))
  await waitFor(() => expect(click).toHaveBeenCalledTimes(2))
  expect(fetcher).toHaveBeenNthCalledWith(2, 'api/artifact.download?sessionId=owner&seq=7&index=1',
    expect.objectContaining({ method: 'HEAD' }))
})

it('registers the action on presented cards and changed-file review', () => {
  const names: string[] = []
  const ctx = {
    effect: (factory: () => () => void) => { factory() },
    locale: { register: () => () => {}, bind: () => () => '' },
    slots: {
      inject: (name: string, register: () => void) => { names.push(name); register() },
      register: () => () => {},
    },
  }
  apply(ctx as never)
  expect(names).toEqual(['deliverables.file.actions', 'deliverables.review.file.actions'])
})
