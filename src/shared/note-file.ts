/** Uma nota só se liga a texto: é a única coisa que o palco lê e regrava no disco por conta dela. */
export const NOTE_FILE_EXT = /\.(md|markdown|txt)$/i
export const isNoteFilePath = (path: unknown): path is string =>
  typeof path === 'string' && path.length <= 4096 && path.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(path) && NOTE_FILE_EXT.test(path)
/** O nome da nota ligada é o do arquivo, sem a extensão. */
export const noteFileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(NOTE_FILE_EXT, '') || 'nota'
