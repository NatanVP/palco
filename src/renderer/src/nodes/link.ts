import type { FloorId, NewNode, Vec } from '../../../shared/model'
import { isWebUrl, linkHost } from '../../../shared/link'
import { uniqueName } from '../canvas/selection/group'

export { linkText } from '../../../shared/link'
export const LINK_SIZE = { w: 280, h: 48 }
export const LINK_MIN = { w: 140, h: 40 }

/** O cartão que um endereço colado vira, centrado no ponto; `null` se não é um endereço da web. */
export function linkNode(url: string, at: Vec, floorId: FloorId, existingNames: readonly string[]): NewNode | null {
  const address = url.trim()
  if (!isWebUrl(address)) return null
  const name = uniqueName(linkHost(address), new Set(existingNames.map((n) => n.toLowerCase())))
  return { kind: 'link', floorId, name, url: address, pos: { x: Math.round(at.x - LINK_SIZE.w / 2), y: Math.round(at.y - LINK_SIZE.h / 2) }, size: { ...LINK_SIZE } }
}
