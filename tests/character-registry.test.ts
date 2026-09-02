import { describe, expect, it } from 'vitest'
import {
  characterRegistry,
  DEFAULT_CHARACTER_ID,
  getCharacter,
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
      'deepseek',
      'claude',
      'gpt',
    ])
    for (const character of characterRegistry) {
      expect(Object.keys(character.sprites)).toEqual(SPRITE_NAMES)
      expect(Object.values(character.sprites).every(url => typeof url === 'string' && url.length > 0)).toBe(true)
    }
  })

  it('falls back safely when a persisted character id no longer exists', () => {
    expect(getCharacter('removed-character').id).toBe(DEFAULT_CHARACTER_ID)
  })
})
