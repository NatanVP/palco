import type { Size, Vec } from '../../../shared/model'

/** Retângulo tracejado do gesto de colocação, em coordenadas de mundo (dentro do `.world`). */
export function PlacementLayer({ frame }: { frame: { pos: Vec; size: Size } | null }) {
  if (!frame) return null
  return (
    <div
      aria-hidden="true"
      className="placement-preview"
      style={{ left: frame.pos.x, top: frame.pos.y, width: frame.size.w, height: frame.size.h }}
    />
  )
}
