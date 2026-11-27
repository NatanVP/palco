import { useEffect, useRef } from 'react'

export function ShutdownOverlay({ label, onPainted }: { label: string; onPainted(): void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    dialog.focus()
    const blockKeys = (event: KeyboardEvent): void => { event.preventDefault(); event.stopImmediatePropagation() }
    window.addEventListener('keydown', blockKeys, true)
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => { secondFrame = window.requestAnimationFrame(onPainted) })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
      window.removeEventListener('keydown', blockKeys, true)
      if (dialog.open) dialog.close()
    }
  }, [onPainted])

  return <dialog ref={dialogRef} className="shutdown-overlay" role="status" aria-live="polite" tabIndex={-1} onCancel={(event) => event.preventDefault()}>
    <span className="shutdown-spinner" aria-hidden="true" />
    <span>{label}</span>
  </dialog>
}
