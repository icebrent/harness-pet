import { contextBridge, ipcRenderer } from 'electron'
import type { DragStart, HarnessAnswer, HarnessPetApi, HarnessStatus } from '../shared/contracts.js'

const api: HarnessPetApi = {
  ask: (prompt: string) => ipcRenderer.invoke('harness:ask', prompt) as Promise<HarnessAnswer>,
  newConversation: () => ipcRenderer.invoke('harness:new-conversation') as Promise<HarnessStatus>,
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
}

contextBridge.exposeInMainWorld('harnessPet', api)
