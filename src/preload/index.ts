import { contextBridge, ipcRenderer } from 'electron'
import type { DragStart, HarnessAnswer, HarnessPetApi, HarnessStatus } from '../shared/contracts.js'

const api: HarnessPetApi = {
  getDisplayMode: () => ipcRenderer.invoke('app:get-display-mode') as Promise<import('../shared/display-mode.js').DisplayMode>,
  ask: (prompt: string) => ipcRenderer.invoke('harness:ask', prompt) as Promise<HarnessAnswer>,
  newConversation: () => ipcRenderer.invoke('harness:new-conversation') as Promise<HarnessStatus>,
  selectCharacter: (characterId: string) => ipcRenderer.invoke('harness:select-character', characterId) as Promise<HarnessStatus>,
  setMousePassthrough: (passthrough: boolean) => ipcRenderer.send('window:set-mouse-passthrough', passthrough),
  setMotionPaused: (paused: boolean) => ipcRenderer.send('pet:set-motion-paused', paused),
  getWindowPosition: () => ipcRenderer.invoke('window:get-position') as Promise<DragStart>,
  moveWindow: (x: number, y: number) => ipcRenderer.send('window:move', x, y),
  quit: () => ipcRenderer.send('app:quit'),
  onShowComposer: (listener: () => void) => {
    ipcRenderer.on('composer:show', listener)
    return () => ipcRenderer.off('composer:show', listener)
  },
  onMovement: (listener: (moving: boolean) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, moving: boolean): void => listener(moving)
    ipcRenderer.on('pet:movement', wrapped)
    return () => ipcRenderer.off('pet:movement', wrapped)
  },
  onCharacterChanged: (listener: (status: HarnessStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: HarnessStatus): void => listener(status)
    ipcRenderer.on('character:changed', wrapped)
    return () => ipcRenderer.off('character:changed', wrapped)
  },
  onNewConversation: (listener: (status: HarnessStatus) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: HarnessStatus): void => listener(status)
    ipcRenderer.on('conversation:new', wrapped)
    return () => ipcRenderer.off('conversation:new', wrapped)
  },
}

contextBridge.exposeInMainWorld('harnessPet', api)
