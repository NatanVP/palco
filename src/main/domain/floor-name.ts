/** A display name becomes a bounded path/branch component, never a path. */
export function slugFloorName(name: string): string {
  const latin: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', þ: 'th', æ: 'ae', œ: 'oe', ß: 'ss', ı: 'i', ŧ: 't', ħ: 'h', ŋ: 'n', ə: 'e' }
  const normalized = name.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '')
    .replace(/[łøđðþæœßıŧħŋə]/g, letter => latin[letter]!)
  const invalid = (): never => { throw new Error('nome de floor inválido: use letras a-z, números e hífen') }
  if (/\p{L}/u.test(normalized.replace(/[a-z]/g, ''))) return invalid()
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
  if (!slug) return invalid()
  return slug
}
