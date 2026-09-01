import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { createInterface } from 'node:readline'

interface AskMessage {
  type: 'ask'
  requestId: string
  prompt: string
  sessionId: string
}

interface CloseMessage {
  type: 'close'
}

const profilePatchPath = process.argv[2]
if (!profilePatchPath) throw new Error('HarnessPet profile patch path is required.')

const harness = new DeepSeekHarness({
  profile: 'sdk',
  patches: [profilePatchPath],
  cwd: process.cwd(),
  processCwd: process.cwd(),
  initializeTimeoutMs: 60_000,
  maxTokens: 4_096,
})

let queue = Promise.resolve()
let closing = false

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handleAsk(message: AskMessage): Promise<void> {
  try {
    const result = await harness.run(message.prompt, { sessionId: message.sessionId })
    send({
      type: 'result',
      requestId: message.requestId,
      sessionId: result.sessionId,
      finalResponse: result.finalResponse,
    })
  } catch (error) {
    send({
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function close(): Promise<void> {
  if (closing) return
  closing = true
  await harness.close()
  send({ type: 'closed' })
  process.exit(0)
}

createInterface({ input: process.stdin }).on('line', line => {
  let message: AskMessage | CloseMessage
  try {
    message = JSON.parse(line) as AskMessage | CloseMessage
  } catch {
    return
  }
  if (message.type === 'close') {
    void close()
    return
  }
  if (message.type === 'ask') queue = queue.then(() => handleAsk(message))
})

process.once('SIGTERM', () => void close())
process.once('SIGINT', () => void close())
