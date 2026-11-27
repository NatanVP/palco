// @vitest-environment happy-dom
import { TextDraft, TEXT_LIMIT } from '../../src/renderer/src/nodes/text-draft'
beforeEach(() => localStorage.clear())
it('rejects oversized input before replacing the current text or invoking persistence', () => {
  const draft = new TextDraft('a', 'keep', localStorage)
  expect(() => draft.edit('x'.repeat(TEXT_LIMIT + 1))).toThrow(/limite/)
  expect(draft.value).toBe('keep')
})
it('retains a failed save across editor remounts and clears the draft only after a successful save', async () => {
  const first = new TextDraft('a', 'old', localStorage); first.edit('new')
  await expect(first.save(async () => { throw new Error('IPC failed') })).rejects.toThrow('IPC failed')
  const reopened = new TextDraft('a', 'old', localStorage)
  expect(reopened.value).toBe('new')
  await reopened.save(async value => { expect(value).toBe('new') })
  expect(new TextDraft('a', 'new', localStorage).value).toBe('new')
  expect(localStorage.length).toBe(0)
})
it('serializes saves and an older response never discards the newer draft', async () => {
  const draft = new TextDraft('a', 'old', localStorage), calls: string[] = []
  let finish!: () => void
  draft.edit('one'); const one = draft.save(value => { calls.push(value); return new Promise<void>(resolve => { finish = resolve }) })
  await Promise.resolve()
  draft.edit('two'); const two = draft.save(async value => { calls.push(value) })
  expect(calls).toEqual(['one'])
  expect(new TextDraft('a', 'old', localStorage).value).toBe('two')
  finish(); await Promise.all([one, two])
  expect(calls).toEqual(['one', 'two'])
  expect(localStorage.length).toBe(0)
})
it('a blur without local edits never overwrites an external update', async () => {
  const draft = new TextDraft('a', 'old', localStorage), write = vi.fn(async () => {})
  const pending = draft.save(write)
  draft.receive('external')
  await pending
  expect(write).not.toHaveBeenCalled()
  expect(draft.value).toBe('external')
})
it('persists a deliberate revert even while the previous edited value is still being saved', async () => {
  const draft = new TextDraft('a', 'old', localStorage), writes: string[] = []
  let finish!: () => void
  draft.edit('new'); const first = draft.save(v => { writes.push(v); return new Promise<void>(resolve => { finish = resolve }) })
  await Promise.resolve()
  draft.edit('old'); const second = draft.save(async v => { writes.push(v) })
  finish(); await Promise.all([first, second])
  expect(writes).toEqual(['new', 'old'])
})
