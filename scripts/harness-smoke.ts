import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { mkdirSync } from 'node:fs'
import { HARNESS_PROFILE_PATCH_PATH, HARNESS_WORKSPACE_PATH } from '../src/main/harness-config.js'

mkdirSync(HARNESS_WORKSPACE_PATH, { recursive: true })

const harness = new DeepSeekHarness({
  profile: 'sdk',
  patches: [HARNESS_PROFILE_PATCH_PATH],
  cwd: HARNESS_WORKSPACE_PATH,
  processCwd: HARNESS_WORKSPACE_PATH,
  initializeTimeoutMs: 60_000,
  maxTokens: 256,
})

try {
  const sessionId = `harness-pet-smoke-${Date.now()}`
  const first = await harness.run('Reply with exactly HARNESSPET_OK and nothing else.', { sessionId })
  const second = await harness.run('What exact token did you just reply with? Reply with only that token.', { sessionId })
  console.log(JSON.stringify({
    sessionStable: first.sessionId === second.sessionId,
    firstResponse: first.finalResponse.trim(),
    secondResponse: second.finalResponse.trim(),
  }, null, 2))
} finally {
  await harness.close()
}
