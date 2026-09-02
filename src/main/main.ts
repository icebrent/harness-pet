import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessBridge } from './harness-bridge.js'
import { HARNESS_WORKSPACE_PATH } from './harness-config.js'

const WINDOW_WIDTH = 430
const WINDOW_HEIGHT = 560
const MOVE_STEP_MS = 30

let petWindow: BrowserWindow | undefined
let bridge: HarnessBridge | undefined
let movementTimer: NodeJS.Timeout | undefined
let movementInterval: NodeJS.Timeout | undefined
let motionPaused = false
let shuttingDown = false

const currentDir = fileURLToPath(new URL('.', import.meta.url))

function createPetWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay().workArea
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: display.x + display.width - WINDOW_WIDTH - 24,
    y: display.y + display.height - WINDOW_HEIGHT - 12,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setIgnoreMouseEvents(true, { forward: true })

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`HarnessPet preload failed (${preloadPath}):`, error)
  })
  window.once('ready-to-show', () => window.showInactive())

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'))
  }

  return window
}

function registerIpc(): void {
  ipcMain.handle('harness:ask', async (_event, prompt: unknown) => {
    if (typeof prompt !== 'string') throw new TypeError('Prompt must be text.')
    return bridge?.ask(prompt)
  })

  ipcMain.handle('harness:new-conversation', () => bridge?.newConversation())

  ipcMain.handle('harness:select-character', (_event, characterId: unknown) => {
    if (typeof characterId !== 'string') throw new TypeError('Character id must be text.')
    return bridge?.selectCharacter(characterId)
  })

  ipcMain.on('window:set-mouse-passthrough', (_event, passthrough: unknown) => {
    if (typeof passthrough !== 'boolean') return
    petWindow?.setIgnoreMouseEvents(passthrough, { forward: true })
  })

  ipcMain.on('pet:set-motion-paused', (_event, paused: unknown) => {
    if (typeof paused === 'boolean') motionPaused = paused
  })

  ipcMain.handle('window:get-position', () => {
    const [windowX, windowY] = petWindow?.getPosition() ?? [0, 0]
    return { windowX, windowY }
  })

  ipcMain.on('window:move', (_event, x: unknown, y: unknown) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    stopCurrentMovement()
    const point = clampToWorkArea(Math.round(x as number), Math.round(y as number))
    petWindow?.setPosition(point.x, point.y)
  })

  ipcMain.on('app:quit', () => app.quit())
}

function clampToWorkArea(x: number, y: number): { x: number; y: number } {
  const windowBounds = { x, y, width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
  const area = screen.getDisplayMatching(windowBounds).workArea
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - WINDOW_WIDTH),
    y: Math.min(Math.max(y, area.y), area.y + area.height - WINDOW_HEIGHT),
  }
}

function scheduleRandomMovement(): void {
  if (movementTimer !== undefined) clearTimeout(movementTimer)
  const delay = 9_000 + Math.floor(Math.random() * 8_000)
  movementTimer = setTimeout(() => {
    if (!motionPaused) moveRandomly()
    scheduleRandomMovement()
  }, delay)
}

function moveRandomly(): void {
  if (!petWindow || petWindow.isDestroyed() || movementInterval !== undefined) return
  const position = petWindow.getPosition()
  const startX = position[0]!
  const startY = position[1]!
  const distance = 36 + Math.floor(Math.random() * 72)
  const direction = Math.random() < 0.5 ? -1 : 1
  const target = clampToWorkArea(startX + distance * direction, startY)
  const delta = target.x - startX
  if (delta === 0) return

  const steps = Math.max(1, Math.ceil(Math.abs(delta) / 2))
  let step = 0
  petWindow.webContents.send('pet:movement', true)
  movementInterval = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || motionPaused) {
      stopCurrentMovement()
      return
    }
    step += 1
    const progress = Math.min(1, step / steps)
    petWindow.setPosition(Math.round(startX + delta * progress), startY)
    if (progress >= 1) stopCurrentMovement()
  }, MOVE_STEP_MS)
}

function stopCurrentMovement(): void {
  if (movementInterval === undefined) return
  clearInterval(movementInterval)
  movementInterval = undefined
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet:movement', false)
}

async function shutdownHarness(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  stopCurrentMovement()
  if (movementTimer !== undefined) clearTimeout(movementTimer)
  await bridge?.close()
}

app.whenReady().then(() => {
  mkdirSync(HARNESS_WORKSPACE_PATH, { recursive: true })
  bridge = new HarnessBridge(HARNESS_WORKSPACE_PATH)
  registerIpc()
  petWindow = createPetWindow()
  scheduleRandomMovement()

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    petWindow?.show()
    petWindow?.focus()
    petWindow?.setIgnoreMouseEvents(false)
    petWindow?.webContents.send('composer:show')
  })
})

app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  void shutdownHarness().finally(() => app.quit())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => app.quit())
