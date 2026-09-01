export type PetState = 'idle' | 'thinking' | 'answer' | 'error'

export interface HarnessAnswer {
  sessionId: string
  finalResponse: string
}

export interface HarnessStatus {
  state: PetState
  sessionId: string
}

export interface DragStart {
  windowX: number
  windowY: number
}

export interface HarnessPetApi {
  ask(prompt: string): Promise<HarnessAnswer>
  newConversation(): Promise<HarnessStatus>
  setMousePassthrough(passthrough: boolean): void
  setMotionPaused(paused: boolean): void
  getWindowPosition(): Promise<DragStart>
  moveWindow(x: number, y: number): void
  quit(): void
  onShowComposer(listener: () => void): () => void
  onMovement(listener: (moving: boolean) => void): () => void
}
