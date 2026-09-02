import {
  characterDefinitions,
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  type CharacterId,
} from '../shared/characters.js'

export const SPRITE_NAMES = [
  'idle', 'happy', 'greet',
  'think', 'walk-1', 'walk-2',
  'back-1', 'back-2', 'sleep',
] as const

export type SpriteName = typeof SPRITE_NAMES[number]

export interface CharacterDefinition {
  id: CharacterId
  displayName: string
  persona: string
  sprites: Record<SpriteName, string>
}

const spriteModules = import.meta.glob<string>(
  '../../assets/characters/*/sprites/*.png',
  { eager: true, import: 'default', query: '?url' },
)

function spritesFor(characterId: CharacterId): Record<SpriteName, string> {
  return Object.fromEntries(SPRITE_NAMES.map((name) => {
    const path = `../../assets/characters/${characterId}/sprites/${name}.png`
    const url = spriteModules[path]
    if (!url) throw new Error(`Missing sprite '${name}' for character '${characterId}'.`)
    return [name, url]
  })) as Record<SpriteName, string>
}

export { DEFAULT_CHARACTER_ID }

export const characterRegistry: readonly CharacterDefinition[] = characterDefinitions.map(character => ({
  ...character,
  sprites: spritesFor(character.id),
}))

export function getCharacter(characterId: string): CharacterDefinition {
  const safeId = getCharacterDefinition(characterId).id
  return characterRegistry.find(character => character.id === safeId)!
}
