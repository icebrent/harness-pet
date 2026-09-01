import idleUrl from '../../assets/sprites/idle.png'
import happyUrl from '../../assets/sprites/happy.png'
import greetUrl from '../../assets/sprites/greet.png'
import thinkUrl from '../../assets/sprites/think.png'
import walk1Url from '../../assets/sprites/walk-1.png'
import walk2Url from '../../assets/sprites/walk-2.png'
import back1Url from '../../assets/sprites/back-1.png'
import back2Url from '../../assets/sprites/back-2.png'
import sleepUrl from '../../assets/sprites/sleep.png'
import type { PetState } from '../shared/contracts'

type SpriteName = 'idle' | 'happy' | 'greet' | 'think' | 'walk-1' | 'walk-2' | 'back-1' | 'back-2' | 'sleep'

const spriteUrls: Record<SpriteName, string> = {
  idle: idleUrl,
  happy: happyUrl,
  greet: greetUrl,
  think: thinkUrl,
  'walk-1': walk1Url,
  'walk-2': walk2Url,
  'back-1': back1Url,
  'back-2': back2Url,
  sleep: sleepUrl,
}

const canvas = document.querySelector<HTMLCanvasElement>('#pet-canvas')!
const context = canvas.getContext('2d', { willReadFrequently: true })!
const petWrap = document.querySelector<HTMLElement>('#pet-wrap')!
const bubble = document.querySelector<HTMLElement>('#bubble')!
const bubbleText = document.querySelector<HTMLElement>('#bubble-text')!
const bubbleReplyButton = document.querySelector<HTMLButtonElement>('#bubble-reply')!
const bubbleDismissButton = document.querySelector<HTMLButtonElement>('#bubble-dismiss')!
const composer = document.querySelector<HTMLFormElement>('#composer')!
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt')!
const sendButton = document.querySelector<HTMLButtonElement>('#send')!
const newConversationButton = document.querySelector<HTMLButtonElement>('#new-conversation')!
const quitButton = document.querySelector<HTMLButtonElement>('#quit')!
const statusLabel = document.querySelector<HTMLElement>('#status-label')!
const thinkingDots = document.querySelector<HTMLElement>('#thinking-dots')!

const sprites = new Map<SpriteName, HTMLImageElement>()
let currentSprite: SpriteName = 'idle'
let currentState: PetState = 'idle'
let walkingFrame = 0
let walkingTimer: number | undefined
let answerTimer: number | undefined
let answerDeadline = 0
let answerRemainingMs = 0
let sleepTimer: number | undefined
let wakeTimer: number | undefined
let composerVisible = false
let dragging = false
let dragMoved = false
let dragStartScreenX = 0
let dragStartScreenY = 0
let dragStartWindowX = 0
let dragStartWindowY = 0
let passthrough = true

async function loadSprites(): Promise<void> {
  await Promise.all(Object.entries(spriteUrls).map(async ([name, url]) => {
    const image = new Image()
    image.src = url
    await image.decode()
    sprites.set(name as SpriteName, image)
  }))
  drawSprite('idle')
  scheduleSleep()
}

function drawSprite(name: SpriteName): void {
  const image = sprites.get(name)
  if (!image) return
  currentSprite = name
  if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
}

function setState(state: PetState): void {
  currentState = state
  petWrap.dataset.state = state
  thinkingDots.classList.toggle('is-hidden', state !== 'thinking')
  if (state === 'thinking') drawSprite('think')
  else if (state === 'answer') drawSprite('happy')
  else if (state === 'error') drawSprite('think')
  else if (walkingTimer === undefined) drawSprite('idle')
}

function showComposer(): void {
  composerVisible = true
  clearAnswerTimer()
  bubble.classList.add('is-hidden')
  composer.classList.remove('is-hidden')
  window.harnessPet.setMotionPaused(true)
  setPassthrough(false)
  window.setTimeout(() => promptInput.focus(), 0)
  resetSleepClock()
}

function hideComposer(): void {
  if (currentState === 'thinking') return
  composerVisible = false
  composer.classList.add('is-hidden')
  window.harnessPet.setMotionPaused(false)
  updatePassthroughFromPointer()
}

function showBubble(text: string, isError = false): void {
  composerVisible = false
  composer.classList.add('is-hidden')
  bubbleText.textContent = text
  bubbleText.scrollTop = 0
  bubble.classList.remove('is-hidden')
  setState(isError ? 'error' : 'answer')
  window.harnessPet.setMotionPaused(true)
  setPassthrough(false)
  clearAnswerTimer()
  const visibleMs = isError ? 20_000 : Math.min(60_000, Math.max(20_000, text.length * 80))
  startAnswerTimer(visibleMs)
}

function dismissBubble(): void {
  clearAnswerTimer()
  bubble.classList.add('is-hidden')
  setState('idle')
  window.harnessPet.setMotionPaused(false)
  updatePassthroughFromPointer()
}

function startAnswerTimer(durationMs = answerRemainingMs): void {
  if (durationMs <= 0 || bubble.classList.contains('is-hidden')) return
  answerRemainingMs = durationMs
  answerDeadline = Date.now() + durationMs
  answerTimer = window.setTimeout(dismissBubble, durationMs)
}

function pauseAnswerTimer(): void {
  if (answerTimer === undefined) return
  answerRemainingMs = Math.max(0, answerDeadline - Date.now())
  window.clearTimeout(answerTimer)
  answerTimer = undefined
}

function resumeAnswerTimer(): void {
  if (answerTimer !== undefined || bubble.classList.contains('is-hidden')) return
  startAnswerTimer(Math.max(1_500, answerRemainingMs))
}

function clearAnswerTimer(): void {
  if (answerTimer !== undefined) window.clearTimeout(answerTimer)
  answerTimer = undefined
  answerDeadline = 0
  answerRemainingMs = 0
}

function setPassthrough(next: boolean): void {
  if (passthrough === next) return
  passthrough = next
  window.harnessPet.setMousePassthrough(next)
}

function isOpaqueAt(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect()
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false
  const x = Math.floor((clientX - rect.left) * canvas.width / rect.width)
  const y = Math.floor((clientY - rect.top) * canvas.height / rect.height)
  return context.getImageData(x, y, 1, 1).data[3]! > 24
}

function updatePassthroughFromPointer(event?: PointerEvent | MouseEvent): void {
  if (composerVisible || !bubble.classList.contains('is-hidden') || dragging) {
    setPassthrough(false)
    return
  }
  if (!event) {
    setPassthrough(true)
    return
  }
  setPassthrough(!isOpaqueAt(event.clientX, event.clientY))
}

function startWalking(): void {
  if (currentState !== 'idle' || composerVisible) return
  if (wakeTimer !== undefined) wakeFromSleep()
  if (walkingTimer !== undefined) return
  walkingFrame = 0
  drawSprite('walk-1')
  walkingTimer = window.setInterval(() => {
    walkingFrame += 1
    drawSprite(walkingFrame % 2 === 0 ? 'walk-1' : 'walk-2')
  }, 220)
}

function stopWalking(): void {
  if (walkingTimer !== undefined) window.clearInterval(walkingTimer)
  walkingTimer = undefined
  if (currentState === 'idle') drawSprite('idle')
}

function scheduleSleep(): void {
  if (sleepTimer !== undefined) window.clearTimeout(sleepTimer)
  sleepTimer = window.setTimeout(() => {
    if (currentState !== 'idle' || composerVisible || dragging) {
      scheduleSleep()
      return
    }
    stopWalking()
    drawSprite('sleep')
    window.harnessPet.setMotionPaused(true)
    wakeTimer = window.setTimeout(wakeFromSleep, 14_000)
  }, 55_000)
}

function wakeFromSleep(): void {
  if (wakeTimer !== undefined) window.clearTimeout(wakeTimer)
  wakeTimer = undefined
  if (currentState === 'idle') drawSprite('idle')
  window.harnessPet.setMotionPaused(composerVisible)
  scheduleSleep()
}

function resetSleepClock(): void {
  if (wakeTimer !== undefined) wakeFromSleep()
  else scheduleSleep()
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault()
  const prompt = promptInput.value.trim()
  if (!prompt || currentState === 'thinking') return

  sendButton.disabled = true
  promptInput.disabled = true
  statusLabel.textContent = 'Harness 思考中…'
  setState('thinking')
  window.harnessPet.setMotionPaused(true)
  try {
    const answer = await window.harnessPet.ask(prompt)
    promptInput.value = ''
    statusLabel.textContent = '就绪'
    showBubble(answer.finalResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusLabel.textContent = '请求失败'
    showBubble(`Harness 出错了：${message}`, true)
  } finally {
    sendButton.disabled = false
    promptInput.disabled = false
  }
})

promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    composer.requestSubmit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    hideComposer()
  }
})

newConversationButton.addEventListener('click', async () => {
  try {
    await window.harnessPet.newConversation()
    promptInput.value = ''
    statusLabel.textContent = '已开始新对话'
    promptInput.focus()
  } catch (error) {
    statusLabel.textContent = error instanceof Error ? error.message : '无法开始新对话'
  }
})

bubbleReplyButton.addEventListener('click', showComposer)
bubbleDismissButton.addEventListener('click', dismissBubble)
bubble.addEventListener('pointerenter', pauseAnswerTimer)
bubble.addEventListener('pointerleave', () => {
  if (!bubble.contains(document.activeElement)) resumeAnswerTimer()
})
bubble.addEventListener('focusin', pauseAnswerTimer)
bubble.addEventListener('focusout', () => {
  window.setTimeout(() => {
    if (!bubble.matches(':hover') && !bubble.contains(document.activeElement)) resumeAnswerTimer()
  }, 0)
})

quitButton.addEventListener('click', () => window.harnessPet.quit())

canvas.addEventListener('pointerdown', async (event) => {
  if (event.button !== 0) return
  resetSleepClock()
  dragging = true
  dragMoved = false
  dragStartScreenX = event.screenX
  dragStartScreenY = event.screenY
  const position = await window.harnessPet.getWindowPosition()
  dragStartWindowX = position.windowX
  dragStartWindowY = position.windowY
  canvas.setPointerCapture(event.pointerId)
  setPassthrough(false)
})

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) {
    updatePassthroughFromPointer(event)
    return
  }
  const dx = event.screenX - dragStartScreenX
  const dy = event.screenY - dragStartScreenY
  if (Math.abs(dx) + Math.abs(dy) > 5) dragMoved = true
  if (dragMoved) window.harnessPet.moveWindow(dragStartWindowX + dx, dragStartWindowY + dy)
})

canvas.addEventListener('pointerup', (event) => {
  if (!dragging) return
  dragging = false
  canvas.releasePointerCapture(event.pointerId)
  if (!dragMoved) {
    if (composerVisible) hideComposer()
    else showComposer()
  }
  updatePassthroughFromPointer(event)
})

canvas.addEventListener('pointercancel', () => {
  dragging = false
  updatePassthroughFromPointer()
})

document.addEventListener('mousemove', (event) => updatePassthroughFromPointer(event))
document.addEventListener('keydown', resetSleepClock)
document.addEventListener('pointerdown', resetSleepClock)

window.harnessPet.onShowComposer(showComposer)
window.harnessPet.onMovement((moving) => moving ? startWalking() : stopWalking())

void loadSprites()
