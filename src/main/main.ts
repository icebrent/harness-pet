import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HarnessBridge } from './harness-bridge.js'
import { HARNESS_WORKSPACE_PATH } from './harness-config.js'
import { DEFAULT_CHARACTER_ID, isCharacterId, type CharacterId } from '../shared/characters.js'
import {
  KANBAN_CHARACTER_ID,
  autonomousMovementAllowed,
  parseDisplayMode,
  randomMovementEnabled,
  type DisplayMode,
} from '../shared/display-mode.js'
import { getSummonPosition } from './summon-pet.js'
import { buildTrayMenuTemplate } from './tray-menu.js'

const MOVE_STEP_MS = 30
const DISPLAY_MODE = parseDisplayMode(process.argv)
const WINDOW_CONFIG: Record<DisplayMode, { width: number; height: number; right: number; bottom: number }> = {
  chibi: { width: 430, height: 560, right: 24, bottom: 12 },
  kanban: { width: 520, height: 720, right: 20, bottom: 8 },
}

let petWindow: BrowserWindow | undefined
let tray: Tray | undefined
let bridge: HarnessBridge | undefined
let movementTimer: NodeJS.Timeout | undefined
let movementInterval: NodeJS.Timeout | undefined
let rendererMotionPaused = false
let userMotionPaused = false
let shuttingDown = false

const currentDir = fileURLToPath(new URL('.', import.meta.url))

function createPetWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay().workArea
  const geometry = WINDOW_CONFIG[DISPLAY_MODE]
  const window = new BrowserWindow({
    width: geometry.width,
    height: geometry.height,
    x: display.x + display.width - geometry.width - geometry.right,
    y: display.y + display.height - geometry.height - geometry.bottom,
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
  ipcMain.handle('app:get-display-mode', () => DISPLAY_MODE)

  ipcMain.handle('harness:ask', async (_event, prompt: unknown) => {
    if (typeof prompt !== 'string') throw new TypeError('Prompt must be text.')
    if (!bridge) throw new Error('Harness is not ready.')
    const request = bridge.ask(prompt)
    refreshTrayMenu()
    try {
      return await request
    } finally {
      refreshTrayMenu()
    }
  })

  ipcMain.handle('harness:new-conversation', () => newConversation(false))

  ipcMain.handle('harness:select-character', (_event, characterId: unknown) => {
    if (typeof characterId !== 'string') throw new TypeError('Character id must be text.')
    return selectCharacter(DISPLAY_MODE === 'kanban' ? KANBAN_CHARACTER_ID : characterId, false)
  })

  ipcMain.on('window:set-mouse-passthrough', (_event, passthrough: unknown) => {
    if (typeof passthrough !== 'boolean') return
    petWindow?.setIgnoreMouseEvents(passthrough, { forward: true })
  })

  ipcMain.on('pet:set-motion-paused', (_event, paused: unknown) => {
    if (typeof paused !== 'boolean') return
    rendererMotionPaused = paused
    if (isMotionPaused()) stopCurrentMovement()
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

function isMotionPaused(): boolean {
  return !autonomousMovementAllowed(DISPLAY_MODE, rendererMotionPaused, userMotionPaused)
}

function newConversation(notifyRenderer: boolean): ReturnType<HarnessBridge['newConversation']> {
  if (!bridge) throw new Error('Harness is not ready.')
  const status = bridge.newConversation()
  refreshTrayMenu()
  if (notifyRenderer && petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('conversation:new', status)
  }
  return status
}

function selectCharacter(rawCharacterId: string, notifyRenderer: boolean): ReturnType<HarnessBridge['selectCharacter']> {
  if (!bridge) throw new Error('Harness is not ready.')
  const characterId = DISPLAY_MODE === 'kanban'
    ? KANBAN_CHARACTER_ID
    : (isCharacterId(rawCharacterId) && rawCharacterId !== KANBAN_CHARACTER_ID
        ? rawCharacterId
        : DEFAULT_CHARACTER_ID)
  const status = bridge.selectCharacter(characterId)
  refreshTrayMenu()
  if (notifyRenderer && petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('character:changed', status)
  }
  return status
}

function summonPet(options: { openComposer: boolean }): void {
  if (!petWindow || petWindow.isDestroyed()) return
  stopCurrentMovement()
  const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const position = getSummonPosition(
    petWindow.getBounds(),
    screen.getAllDisplays().map(display => display.workArea),
    cursorDisplay.workArea,
    WINDOW_CONFIG[DISPLAY_MODE],
  )
  if (position) petWindow.setPosition(position.x, position.y)
  if (!petWindow.isVisible()) petWindow.show()
  petWindow.moveTop()
  petWindow.focus()
  if (options.openComposer) {
    petWindow.setIgnoreMouseEvents(false)
    petWindow.webContents.send('composer:show')
  }
}

function toggleUserMovementPause(): void {
  userMotionPaused = !userMotionPaused
  if (userMotionPaused) stopCurrentMovement()
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray || tray.isDestroyed() || !bridge) return
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
    displayMode: DISPLAY_MODE,
    characterId: bridge.status().characterId,
    activeRun: bridge.isRunActive(),
    movementPaused: userMotionPaused,
  }, {
    summon: () => summonPet({ openComposer: false }),
    newConversation: () => {
      try {
        newConversation(true)
      } catch (error) {
        console.error('Unable to start a new conversation from Tray:', error)
      }
    },
    selectCharacter: (characterId: CharacterId) => {
      try {
        selectCharacter(characterId, true)
      } catch (error) {
        console.error('Unable to switch character from Tray:', error)
      }
    },
    toggleMovement: toggleUserMovementPause,
    quit: () => app.quit(),
  })))
}

function createTray(): Tray {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets', 'tray-icon.png'))
  const nextTray = new Tray(icon.resize({ width: 32, height: 32 }))
  nextTray.setToolTip('HarnessPet')
  nextTray.on('click', () => summonPet({ openComposer: false }))
  tray = nextTray
  refreshTrayMenu()
  return nextTray
}

function clampToWorkArea(x: number, y: number): { x: number; y: number } {
  const geometry = WINDOW_CONFIG[DISPLAY_MODE]
  const windowBounds = { x, y, width: geometry.width, height: geometry.height }
  const area = screen.getDisplayMatching(windowBounds).workArea
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - geometry.width),
    y: Math.min(Math.max(y, area.y), area.y + area.height - geometry.height),
  }
}

function scheduleRandomMovement(): void {
  if (!randomMovementEnabled(DISPLAY_MODE)) return
  if (movementTimer !== undefined) clearTimeout(movementTimer)
  const delay = 9_000 + Math.floor(Math.random() * 8_000)
  movementTimer = setTimeout(() => {
    if (!isMotionPaused()) moveRandomly()
    scheduleRandomMovement()
  }, delay)
}

function moveRandomly(): void {
  if (!randomMovementEnabled(DISPLAY_MODE)) return
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
    if (!petWindow || petWindow.isDestroyed() || isMotionPaused()) {
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
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = undefined
  await bridge?.close()
}

app.whenReady().then(() => {
  if (!app.isPackaged) console.log(`[HarnessPet] argv: ${JSON.stringify(process.argv)}`)
  console.log(`[HarnessPet] display mode: ${DISPLAY_MODE}`)
  mkdirSync(HARNESS_WORKSPACE_PATH, { recursive: true })
  bridge = new HarnessBridge(
    HARNESS_WORKSPACE_PATH,
    undefined,
    DISPLAY_MODE === 'kanban' ? KANBAN_CHARACTER_ID : DEFAULT_CHARACTER_ID,
  )
  registerIpc()
  petWindow = createPetWindow()
  createTray()
  if (randomMovementEnabled(DISPLAY_MODE)) scheduleRandomMovement()

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    summonPet({ openComposer: true })
  })
})

app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  void shutdownHarness().finally(() => app.quit())
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = undefined
})

app.on('window-all-closed', () => app.quit())
