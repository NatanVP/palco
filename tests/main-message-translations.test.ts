import { afterEach, describe, expect, it } from 'vitest'
import { localizeError, localizeMessage, localizeResult, localized, mt, setMainLocaleSource } from '../src/main/i18n'
import { UNMERGED_WORK } from '../src/shared/floor-errors'
import { mainMessages } from './helpers/main-messages'
import { commandError } from '../src/renderer/src/dialogs/new-terminal'
import { setLocale } from '../src/shared/i18n/runtime'

/** Literais do main que não são mensagem para o usuário (ou que a tela traduz por outro caminho). */
const NOT_UI = [
  /^\(function\(\)\{/, // script injetado na página do portal
  /^Espaços de Trabalho$/, // nome padrão gravado nos dados
  /^\{p1\} preset\{p2\}/, // plural montado: coberto pelas duas formas no catálogo
  /export PALCO_CLI|export PATH|^#!\/bin\/sh|^exec "|^\s*import os,/, // scripts gerados
  /^Mozilla\/5\.0/, /^Cascadia Mono, /, /^Claude Code$|^Agent Skills$|^Backup ZIP$/, /^CLI (Claude|Codex): /, // identidades e nomes
  /^\{p1\} (ask|hook)\b/, // linhas de log
  /^\[Pasted Content$|^esc to interrupt$|^enter select|^Approaching rate limits$|^Enter to confirm|^Do you want to proceed\?$/, // telas das CLIs que o palco reconhece
  /^No threads with messages\.$/, // resposta ao CLI palco
  /# Prompts salvos do palco\n/ // AGENTS.md escrito na pasta de prompts, lido por agentes
]
const SHORTCUT_FILE = 'src/shared/shortcuts.ts' // rótulos: a tela usa tr(); as validações abaixo continuam conferidas
const sample = (template: string): string => (template === '\n(tempo esgotado)' ? `{p1}${template}` : template).replace(/\{p(\d+)\}/g, 'X$1')
const reset = (): void => setMainLocaleSource(() => ({ preference: null, system: 'pt-BR' }))
afterEach(reset)

describe('mensagens do main em inglês', () => {
  it('todo texto do main que chega à janela tem tradução', () => {
    const left = mainMessages().filter((m) => !NOT_UI.some((r) => r.test(m.template)) && !(m.file === SHORTCUT_FILE && /^[A-ZÀ-Ú]/.test(m.template)))
      .filter((m) => localizeMessage(sample(m.template), 'en') === sample(m.template)).map((m) => `${m.file}:${m.line} ${m.template}`)
    expect(left).toEqual([])
  })
  it('em pt-BR nada muda; texto desconhecido fica como veio', () => {
    expect(localizeMessage('arquivo ilegível', 'pt-BR')).toBe('arquivo ilegível')
    expect(localizeMessage('fatal: something from git', 'en')).toBe('fatal: something from git')
  })
  it('captura os parâmetros e traduz o que vier aninhado', () => {
    expect(localizeMessage("o floor 'ui' já existe", 'en')).toBe("floor 'ui' already exists")
    expect(localizeMessage('túnel indisponível: o ssh não foi encontrado no PATH', 'en')).toBe('tunnel unavailable: ssh was not found in PATH')
    expect(localizeMessage('payload inválido: monitor deve ser booleano', 'en')).toBe('invalid payload: monitor must be a boolean')
    expect(localizeMessage('3 presets inválidos ignorados em presets.json', 'en')).toBe('3 invalid presets ignored in presets.json')
  })
  it('o erro mantém o nome da classe; o resultado só tem os campos de mensagem traduzidos', () => {
    class FloorError extends Error { override name = 'FloorError' }
    setMainLocaleSource(() => ({ preference: 'en', system: 'pt-BR' }))
    const e = localizeError(new FloorError('o floor tem mudanças não commitadas')) as Error
    expect([e.name, e.message]).toEqual(['FloorError', 'the floor has uncommitted changes'])
    const input = { accepted: false, reason: 'arquivo ilegível', text: 'arquivo ilegível', items: [{ name: 'arquivo ilegível', problem: 'Definição inválida.' }] }
    expect(localizeResult(input)).toEqual({ accepted: false, reason: 'unreadable file', text: 'arquivo ilegível', items: [{ name: 'arquivo ilegível', problem: 'Invalid definition.' }] })
    expect(input.reason).toBe('arquivo ilegível')
  })
  it('o envelope do IPC traduz retorno e erro, síncronos e assíncronos', async () => {
    setMainLocaleSource(() => ({ preference: null, system: 'en-US' }))
    expect(localized(() => ({ error: 'portal não está aberto' }))).toEqual({ error: 'the portal is not open' })
    expect(() => localized(() => { throw new Error('nó inexistente') })).toThrow('node does not exist')
    await expect(localized(async () => { throw new Error('nó inexistente') }) as Promise<unknown>).rejects.toThrow('node does not exist')
    await expect(localized(async () => ({ warning: 'Pede sua atenção.' })) as Promise<unknown>).resolves.toEqual({ warning: 'Needs your attention.' })
  })
  it('textos nativos seguem a preferência ou o idioma do sistema', () => {
    reset(); expect(mt('Mostrar palco')).toBe('Mostrar palco')
    setMainLocaleSource(() => ({ preference: null, system: 'de-DE' })); expect(mt('Mostrar palco')).toBe('Show palco') // de ainda não é oferecido
    setMainLocaleSource(() => ({ preference: 'en', system: 'pt-BR' })); expect(mt('Entrar em {p1}', { p1: 'X' })).toBe('Sign in to X')
    setMainLocaleSource(() => ({ preference: 'pt-BR', system: 'en-US' })); expect(mt('Entrar em {p1}', { p1: 'X' })).toBe('Entrar em X')
  })
  it('a janela continua reconhecendo "há trabalho que será perdido" nos dois idiomas', () => {
    for (const pt of ['o floor tem mudanças não commitadas (use --force)', 'a branch x tem commits não integrados (use --force ou --keep-branch)']) {
      expect(UNMERGED_WORK.test(pt)).toBe(true); expect(UNMERGED_WORK.test(localizeMessage(pt, 'en'))).toBe(true)
    }
    expect(UNMERGED_WORK.test(localizeMessage('o merge falhou', 'en'))).toBe(false)
  })
})

describe('validações de src/shared que rodam na própria janela', () => {
  it('o aviso do comando inválido sai no idioma em uso', () => {
    setLocale('en'); expect(commandError('claude "sem fim')).toContain('Unclosed quotes')
    setLocale('pt-BR'); expect(commandError('claude "sem fim')).toContain('Aspas sem fechamento')
  })
})
