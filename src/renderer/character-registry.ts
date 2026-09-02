import {
  characterDefinitions,
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  type CharacterId,
} from '../shared/characters.js'
import { KANBAN_CHARACTER_ID } from '../shared/display-mode.js'
import type { PetState } from '../shared/contracts.js'

export const SPRITE_NAMES = [
  'idle', 'happy', 'greet',
  'think', 'walk-1', 'walk-2',
  'back-1', 'back-2', 'sleep',
] as const

export type SpriteName = typeof SPRITE_NAMES[number]
export type ChibiCharacterId = Exclude<CharacterId, typeof KANBAN_CHARACTER_ID>

export const KANBAN_EXPRESSION_NAMES = [
  'idle', 'happy', 'think', 'talk', 'error', 'rest',
] as const

export type KanbanExpressionName = typeof KANBAN_EXPRESSION_NAMES[number]

export const KANBAN_STATE_EXPRESSIONS: Readonly<Record<PetState, KanbanExpressionName>> = {
  idle: 'idle',
  thinking: 'think',
  answer: 'talk',
  error: 'error',
}

export interface CharacterDefinition {
  id: ChibiCharacterId
  displayName: string
  persona: string
  sprites: Record<SpriteName, string>
}

export interface KanbanCharacterDefinition {
  id: typeof KANBAN_CHARACTER_ID
  displayName: string
  persona: string
  expressions: Record<KanbanExpressionName, string>
}

const spriteModules = import.meta.glob<string>(
  '../../assets/characters/*/sprites/*.png',
  { eager: true, import: 'default', query: '?url' },
)

function spritesFor(characterId: ChibiCharacterId): Record<SpriteName, string> {
  return Object.fromEntries(SPRITE_NAMES.map((name) => {
    const path = `../../assets/characters/${characterId}/sprites/${name}.png`
    const url = spriteModules[path]
    if (!url) throw new Error(`Missing sprite '${name}' for character '${characterId}'.`)
    return [name, url]
  })) as Record<SpriteName, string>
}

export { DEFAULT_CHARACTER_ID }

const chibiDefinitions = characterDefinitions.filter(
  (character): character is typeof character & { id: ChibiCharacterId } => character.id !== KANBAN_CHARACTER_ID,
)

export const characterRegistry: readonly CharacterDefinition[] = chibiDefinitions.map(character => ({
  ...character,
  sprites: spritesFor(character.id),
}))

const kanbanMetadata = characterDefinitions.find(character => character.id === KANBAN_CHARACTER_ID)!

export const kanbanCharacter: KanbanCharacterDefinition = {
  ...kanbanMetadata,
  expressions: Object.fromEntries(KANBAN_EXPRESSION_NAMES.map((name) => {
    const path = `../../assets/characters/${KANBAN_CHARACTER_ID}/sprites/${name}.png`
    const url = spriteModules[path]
    if (!url) throw new Error(`Missing Kanban expression '${name}' for '${KANBAN_CHARACTER_ID}'.`)
    return [name, url]
  })) as Record<KanbanExpressionName, string>,
}

export function getCharacter(characterId: string): CharacterDefinition {
  const resolved = getCharacterDefinition(characterId).id
  const safeId = resolved === KANBAN_CHARACTER_ID ? DEFAULT_CHARACTER_ID : resolved
  return characterRegistry.find(character => character.id === safeId)!
}
