import { t } from '../i18n'
/** Lado do PNG do ícone do workspace (tamanho ideal do upload: quadrada, 128×128). */
export const ICON_SIZE = 128

/** Retângulo onde desenhar a imagem num quadrado `size`×`size`: escala para caber, sem recorte, centralizada. */
export function fitInSquare(w: number, h: number, size = ICON_SIZE): { x: number; y: number; w: number; h: number } | null {
  if (!(w > 0) || !(h > 0)) return null
  const scale = Math.min(size / w, size / h)
  const dw = Math.round(w * scale)
  const dh = Math.round(h * scale)
  return { x: Math.round((size - dw) / 2), y: Math.round((size - dh) / 2), w: dw, h: dh }
}

/** Lê o arquivo como `data:` (a CSP do app aceita `data:` em imagens, não `blob:`). */
function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(t('sidebar.icon-fit.leitura_falhou')))
    reader.readAsDataURL(file)
  })
}

/** Decodifica sem URL quando dá (`createImageBitmap`); SVG e afins caem no `<img>` com `data:`. */
async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; close(): void }> {
  try {
    const bitmap = await createImageBitmap(file)
    return { source: bitmap, w: bitmap.width, h: bitmap.height, close: () => bitmap.close() }
  } catch {
    const img = new Image()
    img.src = await readAsDataUrl(file)
    await img.decode()
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} }
  }
}

/** Decodifica o arquivo escolhido e devolve o PNG 128×128 (fundo transparente), ou `null` se não for imagem. */
export async function fitIconImage(file: Blob): Promise<{ dataUrl: string; png: Uint8Array } | null> {
  let image: Awaited<ReturnType<typeof decode>> | undefined
  try {
    image = await decode(file)
    const box = fitInSquare(image.w, image.h)
    if (!box) return null
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image.source, box.x, box.y, box.w, box.h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    return { dataUrl: canvas.toDataURL('image/png'), png: new Uint8Array(await blob.arrayBuffer()) }
  } catch {
    return null
  } finally {
    image?.close()
  }
}
