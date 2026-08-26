import { readFileSync } from 'node:fs'
import path from 'node:path'

export type CatalogCharacter = {
  id: string
  characterName: string
  type: string
  costume: string
  aliases: string[]
  thumbnail?: string
}

let cache: CatalogCharacter[] | null = null

export function loadCharacters(): CatalogCharacter[] {
  if (cache) return cache
  const file = path.join(process.cwd(), 'config', 'characters.json')
  cache = JSON.parse(readFileSync(file, 'utf8')) as CatalogCharacter[]
  return cache
}

export function findCharacter(characterId: string) {
  return loadCharacters().find((item) => item.id === characterId) || null
}

export function characterLabel(character: CatalogCharacter) {
  const suffix = character.type || character.costume
  return suffix ? `${character.characterName} (${suffix})` : character.characterName
}
