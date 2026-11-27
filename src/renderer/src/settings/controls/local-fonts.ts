import { useEffect, useState } from 'react'
import type { LocalFont } from './font-faces'

/** Uma fonte é monoespaçada quando o `i` e o `M` medem o mesmo (diferença menor que 0,5 px a 72 px). */
export function isMonospace(widthOf: (text: string) => number): boolean { return Math.abs(widthOf('iiiiiiiiii') - widthOf('MMMMMMMMMM')) < 0.5 }

type FamilyOnly = { family: string }
let cache: Promise<string[]> | undefined
/** Famílias monoespaçadas instaladas (`queryLocalFonts`, quando a janela deixa); sem isso, só a digitação manual. */
function loadMonospaceFamilies(): Promise<string[]> {
  cache ??= (async () => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<FamilyOnly[]> }).queryLocalFonts
    if (!query) return []
    try {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
      if (!ctx) return []
      const families = [...new Set((await query()).map(f => f.family))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      return families.filter(f => { ctx.font = `72px "${f}"`; return isMonospace(t => ctx.measureText(t).width) })
    } catch { return [] }
  })()
  return cache
}
let allFonts: Promise<LocalFont[]> | undefined
/** Todas as faces instaladas (família, nome completo, postscriptName, estilo), para o seletor de Estilo. */
export function loadLocalFontFaces(): Promise<LocalFont[]> {
  // Só guarda resultado não vazio: sem a API (ou com erro) tenta de novo na próxima abertura.
  allFonts ??= (async () => {
    const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
    try { return query ? ((await query()) as LocalFont[]).map(f => ({ family: f.family, fullName: f.fullName, postscriptName: f.postscriptName, style: f.style })) : [] } catch { return [] }
  })()
  const pending = allFonts
  void pending.then(l => { if (l.length === 0 && allFonts === pending) allFonts = undefined })
  return pending
}
export function useLocalFontFaces(enabled: boolean): readonly LocalFont[] {
  const [faces, setFaces] = useState<LocalFont[]>([])
  useEffect(() => { if (!enabled) return; let on = true; void loadLocalFontFaces().then(l => { if (on) setFaces(l) }); return () => { on = false } }, [enabled])
  return faces
}
export function useLocalFonts(enabled: boolean): string[] {
  const [fonts, setFonts] = useState<string[]>([])
  useEffect(() => { if (!enabled) return; let on = true; void loadMonospaceFamilies().then(list => { if (on) setFonts(list) }); return () => { on = false } }, [enabled])
  return fonts
}
