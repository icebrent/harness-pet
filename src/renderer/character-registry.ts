export const SPRITE_NAMES = [
  'idle', 'happy', 'greet',
  'think', 'walk-1', 'walk-2',
  'back-1', 'back-2', 'sleep',
] as const

export type SpriteName = typeof SPRITE_NAMES[number]

export interface CharacterDefinition {
  id: string
  displayName: string
  sprites: Record<SpriteName, string>
}

const spriteModules = import.meta.glob<string>(
  '../../assets/characters/*/sprites/*.png',
  { eager: true, import: 'default', query: '?url' },
)

function spritesFor(characterId: string): Record<SpriteName, string> {
  return Object.fromEntries(SPRITE_NAMES.map((name) => {
    const path = `../../assets/characters/${characterId}/sprites/${name}.png`
    const url = spriteModules[path]
    if (!url) throw new Error(`Missing sprite '${name}' for character '${characterId}'.`)
    return [name, url]
  })) as Record<SpriteName, string>
}

export const DEFAULT_CHARACTER_ID = 'deepseek-blue'

export const characterRegistry: readonly CharacterDefinition[] = [
  { id: 'deepseek-blue', displayName: 'deepseek', sprites: spritesFor('deepseek-blue') },
  { id: 'claude-orange', displayName: 'claude', sprites: spritesFor('claude-orange') },
  { id: 'gpt-white', displayName: 'gpt', sprites: spritesFor('gpt-white') },
]

export function getCharacter(characterId: string): CharacterDefinition {
  return characterRegistry.find(character => character.id === characterId)
    ?? characterRegistry.find(character => character.id === DEFAULT_CHARACTER_ID)!
}
