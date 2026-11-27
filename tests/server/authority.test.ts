import { describe, expect, it } from 'vitest'
import { canDismiss, floorAuthorityError } from '../../src/main/server/authority'

const term = (over: Record<string, unknown> = {}) => ({ id: 'c', name: 'C', floorId: null as string | null, ...over })
const floor = { id: 'f1', name: 'ui' }

describe('autoridade de floor', () => {
  it('Ground e o próprio floor podem; outro floor não', () => {
    expect(floorAuthorityError(term(), floor, 'integrar')).toBeNull()
    expect(floorAuthorityError(term({ floorId: 'f1' }), floor, 'integrar')).toBeNull()
    expect(floorAuthorityError(term({ floorId: 'f2' }), floor, 'excluir')).toMatch(/só o Ground ou o próprio floor pode excluir 'ui'/)
  })

  it('maestro pode integrar e excluir floors de qualquer lugar', () => {
    expect(floorAuthorityError(term({ floorId: 'f2', maestro: true }), floor, 'integrar')).toBeNull()
    expect(floorAuthorityError(term({ floorId: 'f2', maestro: true }), floor, 'excluir')).toBeNull()
  })
})

describe('autoridade de dismiss', () => {
  it('só quem recrutou encerra', () => {
    expect(canDismiss(term({ id: 'orq' }), { recruitedBy: 'orq' })).toBe(true)
    expect(canDismiss(term({ id: 'outro' }), { recruitedBy: 'orq' })).toBe(false)
    expect(canDismiss(term({ id: 'orq' }), {})).toBe(false)
  })

  it('maestro encerra qualquer terminal alcançável', () => {
    expect(canDismiss(term({ id: 'm', maestro: true }), {})).toBe(true)
    expect(canDismiss(term({ id: 'm', maestro: true }), { recruitedBy: 'outro' })).toBe(true)
  })
})
