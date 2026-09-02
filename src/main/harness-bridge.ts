import { randomUUID } from 'node:crypto'
import type { HarnessAnswer, HarnessStatus } from '../shared/contracts.js'
import {
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  type CharacterId,
} from '../shared/characters.js'
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
  private characterId: CharacterId = DEFAULT_CHARACTER_ID
  private sessionBootstrapped = false

  constructor(
    private readonly cwd: string,
    private readonly createRuntime: HarnessFactory = async () => createNodeHarnessRuntime(cwd),
    initialCharacterId: CharacterId = DEFAULT_CHARACTER_ID,
  ) {
    this.characterId = initialCharacterId
  }

  status(): HarnessStatus {
    return {
      state: 'idle',
      sessionId: this.sessionId,
      characterId: this.characterId,
      sessionBootstrapped: this.sessionBootstrapped,
    }
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
      const shouldBootstrap = !this.sessionBootstrapped
      const effectivePrompt = shouldBootstrap ? this.bootstrapPrompt(prompt) : prompt
      const result = await runtime.run(effectivePrompt, { sessionId: this.sessionId })
      const finalResponse = result.finalResponse.trim()
      if (!finalResponse) throw new Error('Harness completed without a final text response.')
      if (shouldBootstrap) this.sessionBootstrapped = true
      return { sessionId: result.sessionId, finalResponse }
    } finally {
      this.activeRun = false
    }
  }

  newConversation(): HarnessStatus {
    if (this.activeRun) throw new Error('Wait for the current Harness request to finish.')
    this.sessionId = createSessionId()
    this.sessionBootstrapped = false
    return this.status()
  }

  selectCharacter(rawCharacterId: string): HarnessStatus {
    if (this.activeRun) throw new Error('Wait for the current Harness request to finish.')
    const characterId = getCharacterDefinition(rawCharacterId).id
    if (characterId === this.characterId) return this.status()
    this.characterId = characterId
    return this.newConversation()
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

  private bootstrapPrompt(userMessage: string): string {
    const character = getCharacterDefinition(this.characterId)
    return `<character-persona>\n${character.persona}\n\n你当前在这个 conversation 中使用此角色身份和表达风格。\n在本 conversation 后续对话中保持一致。\n角色设定只影响表达、personality 和轻量行为偏好，不改变事实、任务语义、工具规则、安全规则或系统规则。\n</character-persona>\n\n<user-message>\n${userMessage}\n</user-message>`
  }
}
