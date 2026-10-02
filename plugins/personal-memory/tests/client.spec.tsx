// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { MemorySection, en } from '../src/client.tsx'

afterEach(() => { cleanup() })

describe('personal memory Settings section', () => {
  it('loads entries, edits and deletes through the Host channel', async () => {
    const entry = { id: 'memory-1', kind: 'user' as const, content: 'I like tea.',
      createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z' }
    let state = { revision: 1, entries: [entry] }
    const call = vi.fn(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === 'personal-memory/edit') {
        state = { revision: 2, entries: [{ ...entry, content: (payload as { content: string }).content }] }
      } else if (endpoint === 'personal-memory/delete') state = { revision: 3, entries: [] }
      return { ok: true as const, value: state }
    })
    render(<MemorySection rpc={{ call } as ClientConnectionRpc} t={key => en[key]} />)
    await screen.findByText('I like tea.')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'I like coffee.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('I like coffee.')
    expect(call).toHaveBeenCalledWith('/api', 'personal-memory/edit', { id: entry.id,
      content: 'I like coffee.', expectedRevision: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.queryByText('I like coffee.')).toBeNull())
    expect(call).toHaveBeenCalledWith('/api', 'personal-memory/delete', { id: entry.id, expectedRevision: 2 })
  })

  it('shows localized copy for Host errors', async () => {
    const entry = { id: 'memory-1', kind: 'agent' as const, content: 'Be concise.',
      createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z' }
    const call = vi.fn(async (_channel: string, endpoint: string) => endpoint === 'personal-memory/list'
      ? { ok: true as const, value: { revision: 1, entries: [entry] } }
      : { ok: false as const, error: { code: 'memory/conflict', message: 'internal Host details' } })
    render(<MemorySection rpc={{ call } as ClientConnectionRpc} t={key => en[key]} />)
    await screen.findByText('Be concise.')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Be precise.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.changed)
    expect(screen.queryByText('internal Host details')).toBeNull()
  })
})
