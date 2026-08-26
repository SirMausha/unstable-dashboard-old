import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { characterLabel, findCharacter, searchCharacters, type CatalogCharacter } from './characters'

function UmaThumb({ character, size = 36 }: { character: CatalogCharacter | null; size?: number }) {
  if (!character?.thumbnail) {
    return <span className="uma-thumb uma-thumb-empty" style={{ width: size, height: size }} aria-hidden />
  }
  return <img
    className="uma-thumb"
    src={character.thumbnail}
    alt=""
    width={size}
    height={size}
    loading="lazy"
    referrerPolicy="no-referrer"
  />
}

export function CharacterPicker({
  value,
  onChange,
  disabled = false,
  placeholder = 'Search Uma…',
  compact = false,
  stacked = false,
}: {
  value: string | null
  onChange: (characterId: string | null) => void
  disabled?: boolean
  placeholder?: string
  compact?: boolean
  stacked?: boolean
}) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const selected = value ? findCharacter(value) : null
  const [query, setQuery] = useState(selected ? characterLabel(selected) : '')
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const thumbSize = stacked ? 72 : compact ? 40 : 48

  useEffect(() => {
    setQuery(selected ? characterLabel(selected) : '')
  }, [value])

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [])

  useLayoutEffect(() => {
    if (!open || !fieldRef.current) return
    const rect = fieldRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setDropUp(spaceBelow < 260)
  }, [open, query])

  const results = useMemo(() => searchCharacters(query, 10), [query])
  const className = [
    'character-picker',
    compact ? 'compact' : '',
    stacked ? 'stacked' : '',
    disabled ? 'read-only' : '',
  ].filter(Boolean).join(' ')

  if (disabled) {
    return <div className={className}>
      <UmaThumb character={selected} size={thumbSize} />
      <span className="character-picker-label">
        {selected ? characterLabel(selected) : <span className="muted">—</span>}
      </span>
    </div>
  }

  return <div className={className} ref={rootRef}>
    <UmaThumb character={selected} size={thumbSize} />
    <div className="character-picker-field" ref={fieldRef}>
      <input
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        onFocus={() => { if (!disabled) setOpen(true) }}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          if (!event.target.value.trim()) onChange(null)
        }}
      />
      {selected ? (
        <button type="button" className="character-picker-clear" onClick={() => { onChange(null); setQuery(''); setOpen(false) }}>
          Clear
        </button>
      ) : null}
      {open ? (
        <ul
          id={listId}
          className={`character-picker-list ${dropUp ? 'drop-up' : ''}`}
          role="listbox"
        >
          {results.length === 0 ? (
            <li className="muted">No matches</li>
          ) : results.map((character) => (
            <li key={character.id}>
              <button
                type="button"
                role="option"
                aria-selected={character.id === value}
                onClick={() => {
                  onChange(character.id)
                  setQuery(characterLabel(character))
                  setOpen(false)
                }}
              >
                <UmaThumb character={character} size={32} />
                <span>
                  <strong>{characterLabel(character)}</strong>
                  {character.aliases[0] ? <small>{character.aliases[0]}</small> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  </div>
}
