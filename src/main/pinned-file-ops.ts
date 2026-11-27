import { constants, openSync, closeSync, realpathSync, lstatSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

export interface PinnedEntry {
  parentFd: number; homeFd: number; name: string; original: string; pinned: string
  close(): void
}
/** Open every parent relative to an already-open directory. Final symlinks remain entries, never targets. */
export function pinEntry(path: unknown, home: string): PinnedEntry {
  if (process.platform !== 'linux') throw new Error('Operações seguras de arquivos requerem Linux.')
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) throw new Error('o caminho precisa ser absoluto')
  const root = realpathSync(home), absolute = resolve(path), rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('só dá para mexer em arquivos dentro da pasta pessoal')
  if (rel === '.palco' || rel.startsWith('.palco' + sep)) throw new Error('a pasta de dados do palco não pode ser alterada por aqui')
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  const homeFd = openSync(root, flags)
  let parentFd = homeFd
  try {
    const parts = rel.split(sep)
    for (const part of parts.slice(0, -1)) {
      const next = openSync(`/proc/self/fd/${parentFd}/${part}`, flags)
      if (parentFd !== homeFd) closeSync(parentFd)
      parentFd = next
    }
    const name = parts.at(-1)!, pinned = `/proc/${process.pid}/fd/${parentFd}/${name}`
    lstatSync(pinned)
    let closed = false
    return { parentFd, homeFd, name, original: absolute, pinned, close: () => {
      if (closed) return
      closed = true
      if (parentFd !== homeFd) closeSync(parentFd)
      closeSync(homeFd)
    } }
  } catch (error) {
    if (parentFd !== homeFd) closeSync(parentFd)
    closeSync(homeFd)
    throw error
  }
}
/** Small Linux syscall adapter: Node exposes neither renameat2 nor dirfd-relative rename.
 * Python stdlib + libc only; descriptors are inherited as fd 3/4. Never pass file contents or credentials in argv.
 * No unsafe fallback when Python/kernel/cross-device support is unavailable.
 */
export const FILE_OPERATION_HELPER=String.raw`
import os,sys,ctypes,errno,json,uuid,datetime,urllib.parse
lib=ctypes.CDLL(None,use_errno=True)
def move(srcfd,src,dstfd,dst):
 r=lib.renameat2(srcfd,os.fsencode(src),dstfd,os.fsencode(dst),1)
 if r: raise OSError(ctypes.get_errno(),'exclusive rename failed')
def directory(parent,name):
 try: os.mkdir(name,0o700,dir_fd=parent)
 except FileExistsError: pass
 return os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
try:
 action,name,argument=sys.argv[1:]
 if action=='rename': move(3,name,3,argument)
 elif action=='trash':
  parent=os.dup(4)
  for part in ['.local','share','Trash']:
   child=directory(parent,part);os.close(parent);parent=child
  files=directory(parent,'files');info=directory(parent,'info')
  item=uuid.uuid4().hex+'-'+os.fsencode(name)[:160].decode('utf8','ignore');record=item+'.trashinfo'
  fd=os.open(record,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=info)
  try:
   with os.fdopen(fd,'w') as out:
    out.write('[Trash Info]\nPath='+urllib.parse.quote(argument,safe='/')+'\nDeletionDate='+datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')+'\n');out.flush();os.fsync(out.fileno())
   move(3,name,files,item)
  except:
   os.unlink(record,dir_fd=info);raise
 else: raise OSError(errno.EINVAL,'invalid operation')
 print(json.dumps({'ok':True}))
except OSError as error:
 print(json.dumps({'ok':False,'errno':error.errno}));sys.exit(1)
except Exception:
 print(json.dumps({'ok':False,'errno':errno.ENOSYS}));sys.exit(1)
`
export function operatePinned(entry: PinnedEntry, action: 'rename' | 'trash', argument: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-c', FILE_OPERATION_HELPER, action, entry.name, argument], {
      stdio: ['ignore', 'pipe', 'ignore', entry.parentFd, entry.homeFd]
    })
    let output = '', settled = false
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error) } }
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('A operação segura excedeu o prazo.')) }, 10000)
    child.stdout!.on('data', bytes => { if (output.length < 4096) output += String(bytes) })
    child.once('error', () => {
      clearTimeout(timer)
      fail(new Error('Não foi possível executar a operação segura (Linux e python3 são necessários).'))
    })
    child.once('close', code => {
      clearTimeout(timer)
      if (settled) return
      let result: { ok?: boolean; errno?: number } = {}
      try { result = JSON.parse(output) } catch { /* Generic error below; no raw child output is exposed. */ }
      if (code !== 0 || !result.ok) {
        fail(new Error(result.errno === 17 ? 'já existe um arquivo com esse nome' : result.errno === 18
          ? 'Não é possível mover entre sistemas de arquivos por esta operação segura.'
          : 'A operação segura falhou; nenhum destino foi substituído.'))
        return
      }
      settled = true
      resolve()
    })
  })
}
