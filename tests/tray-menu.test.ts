import { describe, expect, it, vi } from 'vitest'
import { characterDefinitions } from '../src/shared/characters.js'
import { buildTrayMenuTemplate, charactersForTray } from '../src/main/tray-menu.js'

function actions() {
  return {
    summon: vi.fn(),
    newConversation: vi.fn(),
    selectCharacter: vi.fn(),
    toggleMovement: vi.fn(),
    quit: vi.fn(),
  }
}

function item(template: ReturnType<typeof buildTrayMenuTemplate>, id: string) {
  return template.find(entry => entry.id === id)
}

describe('Tray menu', () => {
  it('builds the Chibi character submenu from the shared registry with the current character checked', () => {
    const handlers = actions()
    const template = buildTrayMenuTemplate({
      displayMode: 'chibi',
      characterId: 'claude-orange',
      activeRun: false,
      movementPaused: false,
    }, handlers)
    const characterItem = item(template, 'characters')!
    const submenu = characterItem.submenu as Electron.MenuItemConstructorOptions[]
    const expected = characterDefinitions.filter(character => character.id !== 'qwen-purple')

    expect(charactersForTray('chibi')).toEqual(expected)
    expect(submenu.map(entry => entry.id)).toEqual(expected.map(character => character.id))
    expect(submenu.find(entry => entry.id === 'claude-orange')?.checked).toBe(true)
    expect(item(template, 'toggle-movement')?.label).toBe('暂停移动')

    submenu.find(entry => entry.id === 'gpt-white')?.click?.({} as never, {} as never, {} as never)
    expect(handlers.selectCharacter).toHaveBeenCalledWith('gpt-white')
  })

  it('disables character switching during an active request and restores it afterward', () => {
    const handlers = actions()
    const active = buildTrayMenuTemplate({
      displayMode: 'chibi', characterId: 'deepseek-blue', activeRun: true, movementPaused: false,
    }, handlers)
    const idle = buildTrayMenuTemplate({
      displayMode: 'chibi', characterId: 'deepseek-blue', activeRun: false, movementPaused: false,
    }, handlers)

    expect(item(active, 'characters')?.enabled).toBe(false)
    expect(item(active, 'new-conversation')?.enabled).toBe(false)
    expect(item(idle, 'characters')?.enabled).toBe(true)
  })

  it('omits the single character and movement controls in Kanban mode', () => {
    const template = buildTrayMenuTemplate({
      displayMode: 'kanban', characterId: 'qwen-purple', activeRun: false, movementPaused: false,
    }, actions())

    expect(charactersForTray('kanban').map(character => character.id)).toEqual(['qwen-purple'])
    expect(item(template, 'characters')).toBeUndefined()
    expect(item(template, 'toggle-movement')).toBeUndefined()
    expect(item(template, 'summon-pet')).toBeDefined()
    expect(item(template, 'new-conversation')).toBeDefined()
    expect(item(template, 'quit')).toBeDefined()
  })

  it('changes the movement command wording with the persisted Tray state', () => {
    const template = buildTrayMenuTemplate({
      displayMode: 'chibi', characterId: 'deepseek-blue', activeRun: false, movementPaused: true,
    }, actions())
    expect(item(template, 'toggle-movement')?.label).toBe('恢复移动')
  })
})
