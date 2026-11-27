import { join } from 'node:path'

export interface RuntimePaths { cli: string; cliBundle: string; skills: string; icons: string }
export interface RuntimePathOptions { packaged: boolean; resourcesPath: string; appPath: string }

/** Localiza os arquivos que precisam existir como arquivos reais fora do pacote asar. */
export function resolveRuntimePaths(options: RuntimePathOptions): RuntimePaths {
  if (options.packaged) {
    const cliRoot = join(options.resourcesPath, 'palco-cli')
    return {
      cli: join(cliRoot, 'bin', 'palco'),
      cliBundle: join(cliRoot, 'out', 'cli', 'palco.cjs'),
      skills: join(options.resourcesPath, 'skills'),
      icons: join(options.resourcesPath, 'icons')
    }
  }
  return {
    cli: join(options.appPath, 'bin', 'palco'),
    cliBundle: join(options.appPath, 'out', 'cli', 'palco.cjs'),
    skills: join(options.appPath, 'resources', 'skills'),
    icons: join(options.appPath, 'resources', 'icons')
  }
}
