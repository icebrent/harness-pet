import type { PetState } from '../shared/contracts'
import { KANBAN_CHARACTER_ID, type DisplayMode } from '../shared/display-mode'
import {
  characterRegistry,
  DEFAULT_CHARACTER_ID,
  getCharacter,
  KANBAN_EXPRESSION_NAMES,
  KANBAN_STATE_EXPRESSIONS,
  kanbanCharacter,
  SPRITE_NAMES,
  type KanbanExpressionName,
  type SpriteName,
} from './character-registry'

const CHARACTER_STORAGE_KEY = 'harness-pet:character-id'

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
const characterSelect = document.querySelector<HTMLSelectElement>('#character-select')!

const sprites = new Map<string, Map<SpriteName, HTMLImageElement>>()
const kanbanExpressions = new Map<KanbanExpressionName, HTMLImageElement>()
let displayMode: DisplayMode = 'chibi'
let currentCharacterId: string = DEFAULT_CHARACTER_ID
let currentSprite: SpriteName = 'idle'
let currentKanbanExpression: KanbanExpressionName = 'idle'
let currentState: PetState = 'idle'
let characterTransitioning = false
let walkingFrame = 0
let walkingTimer: number | undefined
let answerTimer: number | undefined
let answerDeadline = 0
let answerRemainingMs = 0
let sleepTimer: number | undefined
let wakeTimer: number | undefined
let kanbanRestTimer: number | undefined
let kanbanWakeTimer: number | undefined
let composerVisible = false
let dragging = false
let dragMoved = false
let dragStartScreenX = 0
let dragStartScreenY = 0
let dragStartWindowX = 0
let dragStartWindowY = 0
let passthrough = true

async function loadSprites(): Promise<void> {
  if (displayMode === 'kanban') {
    await Promise.all(KANBAN_EXPRESSION_NAMES.map(async (name) => {
      const image = new Image()
      image.src = kanbanCharacter.expressions[name]
      await image.decode()
      kanbanExpressions.set(name, image)
    }))
    drawKanbanExpression('idle')
    scheduleKanbanRest()
    return
  }

  for (const character of characterRegistry) {
    const characterSprites = new Map<SpriteName, HTMLImageElement>()
    await Promise.all(SPRITE_NAMES.map(async (name) => {
      const image = new Image()
      image.src = character.sprites[name]
      await image.decode()
      characterSprites.set(name, image)
    }))
    sprites.set(character.id, characterSprites)
  }
  populateCharacterSelect()
  drawSprite('idle')
  scheduleSleep()
}

function drawSprite(name: SpriteName): void {
  const image = sprites.get(currentCharacterId)?.get(name)
  if (!image) return
  currentSprite = name
  if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
}

function drawKanbanExpression(name: KanbanExpressionName): void {
  const image = kanbanExpressions.get(name)
  if (!image) return
  currentKanbanExpression = name
  if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0)
}

function restoreCharacterId(): string {
  try {
    const saved = window.localStorage.getItem(CHARACTER_STORAGE_KEY)
    return saved && characterRegistry.some(character => character.id === saved)
      ? saved
      : DEFAULT_CHARACTER_ID
  } catch {
    return DEFAULT_CHARACTER_ID
  }
}

function populateCharacterSelect(): void {
  characterSelect.replaceChildren(...characterRegistry.map((character) => {
    const option = document.createElement('option')
    option.value = character.id
    option.textContent = character.displayName
    return option
  }))
  characterSelect.value = getCharacter(currentCharacterId).id
}

function persistCharacterId(): void {
  if (displayMode === 'kanban') return
  characterSelect.value = currentCharacterId
  try {
    window.localStorage.setItem(CHARACTER_STORAGE_KEY, currentCharacterId)
  } catch {
    // The visual switch still works if persistent storage is unavailable.
  }
}

async function switchCharacter(characterId: string): Promise<void> {
  if (displayMode === 'kanban') return
  if (currentState === 'thinking' || characterTransitioning) return
  const previousCharacterId = currentCharacterId
  const nextCharacter = getCharacter(characterId)
  if (nextCharacter.id === previousCharacterId) return

  currentCharacterId = nextCharacter.id
  characterSelect.value = currentCharacterId
  drawSprite(currentSprite)
  characterTransitioning = true
  setConversationControlsDisabled(true)
  try {
    const status = await window.harnessPet.selectCharacter(currentCharacterId)
    currentCharacterId = status.characterId
    persistCharacterId()
    clearAnswerTimer()
    bubble.classList.add('is-hidden')
    setState('idle')
    statusLabel.textContent = `${getCharacter(currentCharacterId).displayName} · 新对话`
  } catch (error) {
    currentCharacterId = previousCharacterId
    characterSelect.value = currentCharacterId
    drawSprite(currentSprite)
    statusLabel.textContent = error instanceof Error ? error.message : 'Unable to switch character'
  } finally {
    characterTransitioning = false
    setConversationControlsDisabled(false)
  }
}

function setConversationControlsDisabled(disabled: boolean): void {
  sendButton.disabled = disabled
  newConversationButton.disabled = disabled
  characterSelect.disabled = disabled
}

function setState(state: PetState): void {
  currentState = state
  petWrap.dataset.state = state
  thinkingDots.classList.toggle('is-hidden', state !== 'thinking')
  if (displayMode === 'kanban') {
    drawKanbanExpression(KANBAN_STATE_EXPRESSIONS[state])
  } else if (state === 'thinking') drawSprite('think')
  else if (state === 'answer') drawSprite('happy')
  else if (state === 'error') drawSprite('think')
  else if (walkingTimer === undefined) drawSprite('idle')
}

function showComposer(): void {
  composerVisible = true
  clearAnswerTimer()
  bubble.classList.add('is-hidden')
  if (displayMode === 'kanban') setState('idle')
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
  if (displayMode === 'kanban') return
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

function scheduleKanbanRest(): void {
  if (kanbanRestTimer !== undefined) window.clearTimeout(kanbanRestTimer)
  kanbanRestTimer = window.setTimeout(() => {
    if (currentState !== 'idle' || composerVisible || dragging) {
      scheduleKanbanRest()
      return
    }
    drawKanbanExpression('rest')
    kanbanWakeTimer = window.setTimeout(() => {
      kanbanWakeTimer = undefined
      if (currentState === 'idle') drawKanbanExpression('idle')
      scheduleKanbanRest()
    }, 14_000)
  }, 75_000)
}

function resetKanbanRestClock(): void {
  if (kanbanWakeTimer !== undefined) window.clearTimeout(kanbanWakeTimer)
  kanbanWakeTimer = undefined
  if (currentState === 'idle' && currentKanbanExpression === 'rest') drawKanbanExpression('idle')
  scheduleKanbanRest()
}

function wakeFromSleep(): void {
  if (wakeTimer !== undefined) window.clearTimeout(wakeTimer)
  wakeTimer = undefined
  if (currentState === 'idle') drawSprite('idle')
  window.harnessPet.setMotionPaused(composerVisible)
  scheduleSleep()
}

function resetSleepClock(): void {
  if (displayMode === 'kanban') {
    resetKanbanRestClock()
    return
  }
  if (wakeTimer !== undefined) wakeFromSleep()
  else scheduleSleep()
}

composer.addEventListener('submit', async (event) => {
  event.preventDefault()
  const prompt = promptInput.value.trim()
  if (!prompt || currentState === 'thinking' || characterTransitioning) return

  setConversationControlsDisabled(true)
  promptInput.disabled = true
  statusLabel.textContent = 'Harness is thinking…'
  setState('thinking')
  window.harnessPet.setMotionPaused(true)
  try {
    const answer = await window.harnessPet.ask(prompt)
    promptInput.value = ''
    statusLabel.textContent = 'Ready'
    showBubble(answer.finalResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    statusLabel.textContent = 'Request failed'
    showBubble(`Harness error: ${message}`, true)
  } finally {
    setConversationControlsDisabled(false)
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
  if (currentState === 'thinking' || characterTransitioning) return
  setConversationControlsDisabled(true)
  try {
    await window.harnessPet.newConversation()
    promptInput.value = ''
    clearAnswerTimer()
    bubble.classList.add('is-hidden')
    setState('idle')
    statusLabel.textContent = 'New conversation started'
    promptInput.focus()
  } catch (error) {
    statusLabel.textContent = error instanceof Error ? error.message : 'Unable to start a new conversation'
  } finally {
    setConversationControlsDisabled(false)
  }
})

characterSelect.addEventListener('change', () => void switchCharacter(characterSelect.value))

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
window.harnessPet.onMovement((moving) => {
  if (displayMode === 'chibi') moving ? startWalking() : stopWalking()
})

async function initialize(): Promise<void> {
  setConversationControlsDisabled(true)
  displayMode = await window.harnessPet.getDisplayMode()
  document.body.dataset.displayMode = displayMode
  currentCharacterId = displayMode === 'kanban' ? KANBAN_CHARACTER_ID : restoreCharacterId()
  if (displayMode === 'kanban') {
    characterSelect.closest('.character-picker')?.classList.add('is-hidden')
    petWrap.setAttribute('aria-label', 'Qwen Purple Kanban desktop pet')
  }
  await loadSprites()
  setState('idle')
  const status = await window.harnessPet.selectCharacter(currentCharacterId)
  currentCharacterId = status.characterId
  persistCharacterId()
  setConversationControlsDisabled(false)
}

void initialize().catch((error) => {
  statusLabel.textContent = error instanceof Error ? error.message : 'Unable to initialize HarnessPet'
  setConversationControlsDisabled(false)
})
