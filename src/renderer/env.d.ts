import type { HarnessPetApi } from '../shared/contracts'

declare global {
  interface Window {
    harnessPet: HarnessPetApi
  }
}

export {}
