import { describe, expect, it } from 'vitest'
import { normalizePortalUrl } from '../../src/renderer/src/nodes/PortalView'

describe('normalizePortalUrl', () => {
  it.each([
    ['exemplo.com', 'https://exemplo.com/'],
    ['  https://a.com/x?y=1 ', 'https://a.com/x?y=1'],
    ['http://localhost:3000', 'http://localhost:3000/'],
    ['localhost:3000/app', 'https://localhost:3000/app'],
    ['file:///tmp/p.html', 'file:///tmp/p.html']
  ])('%s -> %s', (input, expected) => {
    expect(normalizePortalUrl(input)).toBe(expected)
  })

  it.each(['', '   ', 'javascript:alert(1)', 'data:text/html,x', 'ftp://a.com', 'chrome://gpu', 'about:blank'])('recusa %j', (input) => {
    expect(normalizePortalUrl(input)).toBeNull()
  })
})
