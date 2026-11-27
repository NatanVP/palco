const clean = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path)
/** `path` é a própria raiz ou algo abaixo dela, sem "..". */
export function insideRoot(root: string, path: string): boolean {
  if (!path.startsWith('/') || path.split('/').includes('..')) return false
  const base = clean(root), at = clean(path)
  return at === base || at.startsWith(base.endsWith('/') ? base : `${base}/`)
}
export const parentFolder = (path: string): string => clean(path).slice(0, clean(path).lastIndexOf('/')) || '/'
export const folderName = (path: string): string => clean(path).split('/').pop() || '/'
/** Da pasta atual até a raiz, nesta ordem. */
export function folderTrail(path: string, root: string): string[] {
  const trail = [clean(path)]
  while (trail.at(-1) !== clean(root) && trail.at(-1) !== '/') trail.push(parentFolder(trail.at(-1)!))
  return trail
}
