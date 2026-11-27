export interface LocalFont { family: string; fullName: string; postscriptName: string; style: string }
/**
 * Estilos (faces) da família: só aparecem quando há mais de uma. O campo da fonte pode guardar o nome da família ou o `postscriptName` de uma
 * face (a escolha do seletor de Estilo); nos dois casos acha as faces da mesma família.
 */
export function familyOf(fonts: readonly LocalFont[], value: string): string | undefined { return fonts.find(f => f.family === value || f.postscriptName === value || f.fullName === value)?.family }
export function facesOf(fonts: readonly LocalFont[], value: string): Array<{ value: string; label: string }> {
  const family = fonts.find(f => f.family === value || f.postscriptName === value || f.fullName === value)?.family
  const faces = family === undefined ? [] : fonts.filter(f => f.family === family)
  return faces.length > 1 ? faces.map(f => ({ value: f.postscriptName, label: f.style || f.fullName })) : []
}
