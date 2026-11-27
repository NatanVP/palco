import { dialogOpen, promptLanded } from '../../src/main/pty/prompt-landing'

describe('promptLanded', () => {
  it('Claude: só o hook confirma (colagem longa vira [Pasted text] na tela)', () => {
    expect(promptLanded('claude', 'qualquer tela', 'oi', true)).toBe(true)
    expect(promptLanded('claude', '❯ oi', 'oi', false)).toBe(false)
  })

  it('Codex: o início do prompt aparece na tela, ignorando quebras e espaços', () => {
    const prompt = 'rode pwd e responda só o caminho do diretório atual sem mais nada'
    expect(promptLanded('codex', '› rode pwd e responda só o caminho do\n  diretório atual sem mais nada', prompt, false)).toBe(true)
    expect(promptLanded('codex', 'Approaching rate limits\n› 1. Switch to gpt-6-luna', prompt, false)).toBe(false)
  })

  it('Codex: colagem grande escondida ou o indicador de trabalho também confirmam', () => {
    const longo = 'x'.repeat(5000)
    expect(promptLanded('codex', '› [Pasted Content 5000 chars]', longo, false)).toBe(true)
    expect(promptLanded('codex', '• Working (3s • esc to interrupt)', longo, false)).toBe(true)
  })

  it('Codex: um hook de fim de turno também confirma', () => {
    expect(promptLanded('codex', 'tela sem o prompt', 'x', true)).toBe(true)
  })

  it('shell não é verificado', () => {
    expect(promptLanded('shell', '', 'ls', false)).toBe(true)
  })
})

describe('dialogOpen', () => {
  it('reconhece o diálogo de seleção do Codex (cota) e o de confirmação do Claude', () => {
    const codexModal = ' Approaching rate limits\n Switch to gpt-6-luna for lower credit usage?\n› 1. Switch to gpt-6-luna\n  enter select · esc back'
    expect(dialogOpen('codex', codexModal)).toContain('Approaching rate limits')
    expect(dialogOpen('claude', 'Quick safety check\n❯ No, exit\nEnter to confirm · Esc to cancel')).toContain('Enter to confirm')
  })

  it('tela normal e shell não bloqueiam', () => {
    expect(dialogOpen('codex', '› Ask Codex to do anything\n  ← for agents · ? for shortcuts')).toBeNull()
    expect(dialogOpen('shell', 'enter select · esc back')).toBeNull()
  })
})
