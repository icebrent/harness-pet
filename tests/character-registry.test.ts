import { describe, expect, it } from 'vitest'
import {
  characterRegistry,
  DEFAULT_CHARACTER_ID,
  getCharacter,
  KANBAN_EXPRESSION_NAMES,
  KANBAN_STATE_EXPRESSIONS,
  kanbanCharacter,
  SPRITE_NAMES,
} from '../src/renderer/character-registry.js'

describe('character registry', () => {
  it('registers all character packs with every sprite state', () => {
    expect(characterRegistry.map(character => character.id)).toEqual([
      'deepseek-blue',
      'claude-orange',
      'gpt-white',
    ])
    expect(characterRegistry.map(character => character.displayName)).toEqual([
      'DeepSeek Blue',
      'Claude Orange',
      'GPT White',
    ])
    for (const character of characterRegistry) {
      expect(character.persona.length).toBeGreaterThan(40)
      expect(Object.keys(character.sprites)).toEqual(SPRITE_NAMES)
      expect(Object.values(character.sprites).every(url => typeof url === 'string' && url.length > 0)).toBe(true)
    }
  })

  it('falls back safely when a persisted character id no longer exists', () => {
    expect(getCharacter('removed-character').id).toBe(DEFAULT_CHARACTER_ID)
  })

  it('registers qwen-purple as a complete Kanban-only expression pack', () => {
    expect(kanbanCharacter.id).toBe('qwen-purple')
    expect(kanbanCharacter.persona.length).toBeGreaterThan(40)
    expect(Object.keys(kanbanCharacter.expressions)).toEqual(KANBAN_EXPRESSION_NAMES)
    expect(KANBAN_STATE_EXPRESSIONS).toEqual({
      idle: 'idle',
      thinking: 'think',
      answer: 'talk',
      error: 'error',
    })
  })
})
