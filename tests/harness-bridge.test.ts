import { describe, expect, it, vi } from 'vitest'
import { HarnessBridge } from '../src/main/harness-bridge.js'

describe('HarnessBridge', () => {
  it('reuses a session until newConversation is requested', async () => {
    const run = vi.fn(async (_input: string, options: { sessionId: string }) => ({
      sessionId: options.sessionId,
      finalResponse: 'ok',
    }))
    const close = vi.fn(async () => undefined)
    const bridge = new HarnessBridge('D:\\workspace', async () => ({ run, close }))

    const first = await bridge.ask('first')
    const second = await bridge.ask('second')
    expect(second.sessionId).toBe(first.sessionId)

    const next = bridge.newConversation()
    const third = await bridge.ask('third')
    expect(third.sessionId).toBe(next.sessionId)
    expect(third.sessionId).not.toBe(first.sessionId)

    await bridge.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('validates prompts before starting the runtime', async () => {
    const factory = vi.fn()
    const bridge = new HarnessBridge('D:\\workspace', factory)
    await expect(bridge.ask('   ')).rejects.toThrow('Please enter a message')
    expect(factory).not.toHaveBeenCalled()
  })
})
