import type { MenuItemConstructorOptions } from 'electron'
import { characterDefinitions, type CharacterId } from '../shared/characters.js'
import { KANBAN_CHARACTER_ID, type DisplayMode } from '../shared/display-mode.js'

export interface TrayMenuState {
  displayMode: DisplayMode
  characterId: CharacterId
  activeRun: boolean
  movementPaused: boolean
}

export interface TrayMenuActions {
  summon(): void
  newConversation(): void
  selectCharacter(characterId: CharacterId): void
  toggleMovement(): void
  quit(): void
}

export function charactersForTray(displayMode: DisplayMode) {
  return displayMode === 'kanban'
    ? characterDefinitions.filter(character => character.id === KANBAN_CHARACTER_ID)
    : characterDefinitions.filter(character => character.id !== KANBAN_CHARACTER_ID)
}

export function buildTrayMenuTemplate(
  state: TrayMenuState,
  actions: TrayMenuActions,
): MenuItemConstructorOptions[] {
  const characters = charactersForTray(state.displayMode)
  const template: MenuItemConstructorOptions[] = [
    { label: 'HarnessPet', enabled: false },
    { type: 'separator' },
    { id: 'summon-pet', label: '找到桌宠', click: actions.summon },
    { id: 'new-conversation', label: '新对话', enabled: !state.activeRun, click: actions.newConversation },
  ]

  if (characters.length > 1) {
    template.push({
      id: 'characters',
      label: '角色',
      enabled: !state.activeRun,
      submenu: characters.map(character => ({
        id: character.id,
        label: character.displayName,
        type: 'radio',
        checked: character.id === state.characterId,
        click: () => actions.selectCharacter(character.id),
      })),
    })
  }

  if (state.displayMode === 'chibi') {
    template.push({
      id: 'toggle-movement',
      label: state.movementPaused ? '恢复移动' : '暂停移动',
      click: actions.toggleMovement,
    })
  }

  template.push(
    { type: 'separator' },
    { id: 'quit', label: '退出 HarnessPet', click: actions.quit },
  )
  return template
}
