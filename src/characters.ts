import { characters, type CatalogCharacter } from './catalog/characters'

export type { CatalogCharacter }

export function characterLabel(character: CatalogCharacter) {
  const suffix = character.type || character.costume
  return suffix ? `${character.characterName} (${suffix})` : character.characterName
}

export function findCharacter(characterId: string): CatalogCharacter | null {
  return characters.find((item: CatalogCharacter) => item.id === characterId) || null
}

export function searchCharacters(query: string, limit = 12): CatalogCharacter[] {
  const q = query.trim().toLowerCase()
  if (!q) return characters.slice(0, limit)
  const scored = characters.map((character: CatalogCharacter) => {
    const label = characterLabel(character).toLowerCase()
    const hay = [
      label,
      character.characterName.toLowerCase(),
      character.type.toLowerCase(),
      character.costume.toLowerCase(),
      ...character.aliases.map((alias: string) => alias.toLowerCase()),
    ]
    let score = 0
    if (hay.some((item) => item === q)) score = 100
    else if (hay.some((item) => item.startsWith(q))) score = 80
    else if (hay.some((item) => item.includes(q))) score = 50
    else return null
    return { character, score }
  }).filter(Boolean) as Array<{ character: CatalogCharacter; score: number }>
  return scored
    .sort((a, b) => b.score - a.score || a.character.characterName.localeCompare(b.character.characterName))
    .slice(0, limit)
    .map((item) => item.character)
}
