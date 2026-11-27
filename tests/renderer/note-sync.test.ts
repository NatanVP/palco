import { describe, expect, it } from 'vitest'
import { NoteSync } from '../../src/renderer/src/nodes/note-sync'

describe('NoteSync', () => {
  it('sem edição local, conteúdo externo é aplicado mesmo com foco e o blur não regrava', () => {
    const s = new NoteSync('A')
    s.focus()
    expect(s.external('B')).toBe('B')
    expect(s.text).toBe('B')
    expect(s.blur()).toBeUndefined()
  })

  it('com edição local, o externo não sobrescreve e o blur grava o texto local', () => {
    const s = new NoteSync('A')
    s.focus()
    s.edit('A+')
    expect(s.external('B')).toBeUndefined()
    expect(s.text).toBe('A+')
    expect(s.blur()).toBe('A+')
    expect(s.blur()).toBeUndefined()
  })

  it('depois que a edição foi enviada (debounce), o externo volta a ser aplicado', () => {
    const s = new NoteSync('A')
    s.edit('A2')
    expect(s.flush()).toBe('A2')
    expect(s.external('C')).toBe('C')
    expect(s.flush()).toBeUndefined()
  })

  it('o eco do próprio conteúdo não conta como mudança', () => {
    const s = new NoteSync('A')
    s.edit('A2')
    s.flush()
    expect(s.external('A2')).toBeUndefined()
  })
})
