import { codexTurn, lastAssistantText, parseCodexNotify } from '../../src/cli/hooks'

it('uses the direct Stop message without touching a transcript, including empty text', () => {
  const cannotRead = () => { throw new Error('must not read') }
  expect(lastAssistantText(JSON.stringify({ last_assistant_message: 'finished\nanswer', transcript_path: 'never' }), cannotRead)).toBe('finished\nanswer')
  expect(lastAssistantText('{"last_assistant_message":""}', cannotRead)).toBe('')
})
it('takes text blocks from the final assistant record, ignoring users and tool blocks', () => {
  const transcript = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'old answer' }] } },
    { type: 'user', message: { content: 'question' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'last' }, { type: 'tool_use', text: 'not prose' }, { type: 'text', text: 'answer' }] } },
    { type: 'user', message: { content: 'later input' } }
  ].map(row => JSON.stringify(row)).join('\n')
  expect(lastAssistantText('{"transcript_path":"fixture.jsonl"}', path => {
    if (path !== 'fixture.jsonl') throw new Error('unexpected path')
    return transcript
  })).toBe('last\nanswer')
})
it('does not fall back to stale assistant text when the final assistant has only tool calls', () => {
  const transcript = '{"type":"assistant","message":{"content":[{"type":"text","text":"stale"}]}}\n'
    + '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"tool"}]}}'
  expect(lastAssistantText('{"transcript_path":"fixture"}', () => transcript)).toBeUndefined()
})
it('ignores malformed transcript lines and fails quietly for absent/unreadable hook data', () => {
  expect(lastAssistantText('{"transcript_path":"fixture"}', () => 'broken\n{"type":"assistant","message":{"content":[{"type":"text","text":"good"}]}}\n')).toBe('good')
  expect(lastAssistantText('{"transcript_path":"missing"}', () => { throw new Error('ENOENT') })).toBeUndefined()
  for (const input of ['broken', 'null', '[]', '{}', '{"transcript_path":1}']) {
    expect(lastAssistantText(input, () => '')).toBeUndefined()
  }
})
it('accepts only completed Codex turns with a textual final answer', () => {
  expect(parseCodexNotify('{"type":"agent-turn-complete","last-assistant-message":"finished"}')).toBe('finished')
  expect(parseCodexNotify('{"type":"agent-turn-complete","last-assistant-message":""}')).toBe('')
  for (const payload of ['broken', 'null', '[]', '{}', '{"type":"other","last-assistant-message":"ignore"}', '{"type":"agent-turn-complete","last-assistant-message":1}']) {
    expect(parseCodexNotify(payload)).toBeUndefined()
  }
})

describe('codexTurn', () => {
  it('ignora eventos que não são fim de turno', () => {
    expect(codexTurn('{"type":"other"}')).toBeNull()
    expect(codexTurn('quebrado')).toBeNull()
  })

  it('repassa JSON title para o broker decidir com o prompt ativo', () => {
    const title = JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': '{"title":"Responder oi do codex"}', 'input-messages': ['x'] })
    expect(codexTurn(title)).toEqual({ lastMessage: '{"title":"Responder oi do codex"}', inputMessages: ['x'] })
  })

  it('repassa a mensagem e as input-messages do turno', () => {
    const turn = JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': 'oi do codex', 'input-messages': ['responda só: oi do codex', 7] })
    expect(codexTurn(turn)).toEqual({ lastMessage: 'oi do codex', inputMessages: ['responda só: oi do codex'] })
  })

  it('mensagem JSON com outras chaves não é título', () => {
    const turn = JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': '{"title":"a","body":"b"}' })
    expect(codexTurn(turn)).toEqual({ lastMessage: '{"title":"a","body":"b"}' })
  })
})
