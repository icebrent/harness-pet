import { describe, expect, it, vi } from 'vitest'
import { HarnessBridge } from '../src/main/harness-bridge.js'
import { getCharacterDefinition } from '../src/shared/characters.js'

function createRuntime() {
  const run = vi.fn(async (_input: string, options: { sessionId: string }) => ({
    sessionId: options.sessionId,
    finalResponse: 'ok',
  }))
  const close = vi.fn(async () => undefined)
  const factory = vi.fn(async () => ({ run, close }))
  return { run, close, factory }
}

describe('HarnessBridge', () => {
  it('bootstraps deepseek-blue only on the first successful turn', async () => {
    const runtime = createRuntime()
    const bridge = new HarnessBridge('D:\\workspace', runtime.factory)

    await bridge.ask('first')
    await bridge.ask('second')

    expect(runtime.run.mock.calls[0]![0]).toContain(getCharacterDefinition('deepseek-blue').persona)
    expect(runtime.run.mock.calls[0]![0]).toContain('<user-message>\nfirst\n</user-message>')
    expect(runtime.run.mock.calls[1]![0]).toBe('second')
    expect(bridge.status().sessionBootstrapped).toBe(true)
  })

  it.each(['claude-orange', 'gpt-white'] as const)(
    'bootstraps the %s persona in its new session',
    async (characterId) => {
      const runtime = createRuntime()
      const bridge = new HarnessBridge('D:\\workspace', runtime.factory)

      bridge.selectCharacter(characterId)
      await bridge.ask('你是谁')

      expect(runtime.run.mock.calls[0]![0]).toContain(getCharacterDefinition(characterId).persona)
      expect(bridge.status().characterId).toBe(characterId)
    },
  )

  it('bootstraps qwen-purple in the initial Kanban session', async () => {
    const runtime = createRuntime()
    const bridge = new HarnessBridge('D:\\workspace', runtime.factory, 'qwen-purple')

    expect(bridge.status().characterId).toBe('qwen-purple')
    expect(bridge.status().sessionBootstrapped).toBe(false)
    await bridge.ask('你好')

    expect(runtime.run.mock.calls[0]![0]).toContain(getCharacterDefinition('qwen-purple').persona)
    expect(bridge.status().sessionBootstrapped).toBe(true)
  })

  it('manual newConversation keeps the character and resets bootstrap', async () => {
    const runtime = createRuntime()
    const bridge = new HarnessBridge('D:\\workspace', runtime.factory)
    bridge.selectCharacter('claude-orange')
    const first = await bridge.ask('first')

    const next = bridge.newConversation()
    expect(next.sessionId).not.toBe(first.sessionId)
    expect(next.characterId).toBe('claude-orange')
    expect(next.sessionBootstrapped).toBe(false)

    await bridge.ask('second')
    expect(runtime.run.mock.calls[1]![0]).toContain(getCharacterDefinition('claude-orange').persona)
  })

  it('character switch changes the character and session and resets bootstrap', async () => {
    const runtime = createRuntime()
    const bridge = new HarnessBridge('D:\\workspace', runtime.factory)
    await bridge.ask('first')
    const before = bridge.status()

    const after = bridge.selectCharacter('gpt-white')

    expect(after.characterId).toBe('gpt-white')
    expect(after.sessionId).not.toBe(before.sessionId)
    expect(after.sessionBootstrapped).toBe(false)
  })

  it('retries the persona bootstrap when the first runtime run fails', async () => {
    const runtime = createRuntime()
    runtime.run.mockRejectedValueOnce(new Error('provider failed'))
    const bridge = new HarnessBridge('D:\\workspace', runtime.factory)

    await expect(bridge.ask('retry me')).rejects.toThrow('provider failed')
    expect(bridge.status().sessionBootstrapped).toBe(false)
    await bridge.ask('retry me')

    const persona = getCharacterDefinition('deepseek-blue').persona
    expect(runtime.run.mock.calls[0]![0]).toContain(persona)
    expect(runtime.run.mock.calls[1]![0]).toContain(persona)
  })

  it('keeps one runtime and does not initialize or reload it during character switch', async () => {
    const runtime = createRuntime()
    const bridge = new HarnessBridge('D:\\workspace', runtime.factory)

    await bridge.ask('blue')
    bridge.selectCharacter('claude-orange')
    expect(runtime.factory).toHaveBeenCalledOnce()
    await bridge.ask('orange')

    expect(runtime.factory).toHaveBeenCalledOnce()
    expect(runtime.close).not.toHaveBeenCalled()
  })

  it('rejects character switches while a Harness run is active', async () => {
    let finishRun!: () => void
    const run = vi.fn((_input: string, options: { sessionId: string }) => new Promise<{
      sessionId: string
      finalResponse: string
    }>((resolve) => {
      finishRun = () => resolve({ sessionId: options.sessionId, finalResponse: 'ok' })
    }))
    const bridge = new HarnessBridge('D:\\workspace', async () => ({
      run,
      close: vi.fn(async () => undefined),
    }))

    const pending = bridge.ask('working')
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    expect(() => bridge.selectCharacter('gpt-white')).toThrow('Wait for the current Harness request')
    expect(bridge.status().characterId).toBe('deepseek-blue')
    finishRun()
    await pending
  })

  it('falls back safely from an invalid character id', () => {
    const runtime = createRuntime()
    const bridge = new HarnessBridge('D:\\workspace', runtime.factory)
    bridge.selectCharacter('claude-orange')

    const status = bridge.selectCharacter('removed-character')

    expect(status.characterId).toBe('deepseek-blue')
    expect(status.sessionBootstrapped).toBe(false)
    expect(runtime.factory).not.toHaveBeenCalled()
  })

  it('validates prompts before starting the runtime', async () => {
    const factory = vi.fn()
    const bridge = new HarnessBridge('D:\\workspace', factory)
    await expect(bridge.ask('   ')).rejects.toThrow('Please enter a message')
    expect(factory).not.toHaveBeenCalled()
  })
})
