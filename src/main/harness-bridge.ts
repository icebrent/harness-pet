import { randomUUID } from 'node:crypto'
import type { HarnessAnswer, HarnessStatus } from '../shared/contracts.js'
import { createNodeHarnessRuntime } from './harness-worker-client.js'

interface HarnessRunResult {
  sessionId: string
  finalResponse: string
}

interface HarnessRuntime {
  run(input: string, options: { sessionId: string }): Promise<HarnessRunResult>
  close(): Promise<void>
}

type HarnessFactory = () => Promise<HarnessRuntime>

function createSessionId(): string {
  return `harness-pet-${randomUUID().replaceAll('-', '')}`
}

export class HarnessBridge {
  private runtimePromise: Promise<HarnessRuntime> | undefined
  private sessionId = createSessionId()
  private activeRun = false
  private closed = false

  constructor(
    private readonly cwd: string,
    private readonly createRuntime: HarnessFactory = async () => createNodeHarnessRuntime(cwd),
  ) {}

  status(): HarnessStatus {
    return { state: 'idle', sessionId: this.sessionId }
  }

  async ask(rawPrompt: string): Promise<HarnessAnswer> {
    if (this.closed) throw new Error('Harness runtime has already been closed.')
    if (this.activeRun) throw new Error('Harness is already handling a request.')

    const prompt = rawPrompt.trim()
    if (!prompt) throw new Error('Please enter a message.')
    if (prompt.length > 4_000) throw new Error('Message is too long (maximum 4,000 characters).')

    this.activeRun = true
    try {
      const runtime = await this.runtime()
      const result = await runtime.run(prompt, { sessionId: this.sessionId })
      const finalResponse = result.finalResponse.trim()
      if (!finalResponse) throw new Error('Harness completed without a final text response.')
      return { sessionId: result.sessionId, finalResponse }
    } finally {
      this.activeRun = false
    }
  }

  newConversation(): HarnessStatus {
    if (this.activeRun) throw new Error('Wait for the current Harness request to finish.')
    this.sessionId = createSessionId()
    return this.status()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const runtimePromise = this.runtimePromise
    if (runtimePromise === undefined) return
    const runtime = await runtimePromise
    await runtime.close()
  }

  private runtime(): Promise<HarnessRuntime> {
    this.runtimePromise ??= this.createRuntime()
    return this.runtimePromise
  }
}
