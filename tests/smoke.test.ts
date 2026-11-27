import { HEADER_TERMINAL, ENV_SOCKET } from '../src/shared/model'

test('contratos compartilhados', () => {
  expect(HEADER_TERMINAL).toBe('x-palco-terminal')
  expect(ENV_SOCKET).toBe('PALCO_SOCKET')
})
