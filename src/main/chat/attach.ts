import { openVerifiedFile } from '../secure-files'
import { readSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, relative, sep } from 'node:path'

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export type AttachmentCheck = { ok: true; path: string; name: string; kind: 'image' | 'file'; size: number } | { ok: false; reason: string }

/** Pastas do usuário onde moram credenciais: nunca viram anexo, nem por link simbólico. */
const SENSITIVE_HOME = ['.ssh', '.gnupg', '.aws', '.kube', '.docker', '.password-store', '.config/gcloud', '.config/gh', '.config/git', '.local/share/keyrings', '.claude', '.codex', '.palco']
const SENSITIVE_NAME = /^\.env(\..*)?$|credentials|^auth[^/]*\.json$|^id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|p12|pfx|kdbx)$|^\.(netrc|npmrc|pgpass|git-credentials)$/i

function imageKind(head: Buffer): boolean {
  const hex = head.subarray(0, 12)
  return (hex[0] === 0x89 && hex.toString('latin1', 1, 4) === 'PNG') || (hex[0] === 0xff && hex[1] === 0xd8 && hex[2] === 0xff) || hex.toString('latin1', 0, 4) === 'GIF8'
    || (hex.toString('latin1', 0, 4) === 'RIFF' && hex.toString('latin1', 8, 12) === 'WEBP') || hex.toString('latin1', 0, 2) === 'BM'
}

/** Metadata-only compatibility API. Consumers that copy must use openAttachment and own its lifetime. */
export function validateAttachment(path:unknown,home:string):AttachmentCheck {
 const result=openAttachment(path,home)
 if(!result.ok)return result
 try{const {fd:_fd,close:_close,...meta}=result;return meta}finally{result.close()}
}
export function openAttachment(path:unknown,home:string):(Extract<AttachmentCheck,{ok:true}>&{fd:number;close():void})|Extract<AttachmentCheck,{ok:false}>{
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))return{ok:false,reason:'o caminho precisa ser absoluto'}
 let opened:ReturnType<typeof openVerifiedFile>|undefined
 try{
  opened=openVerifiedFile(path,MAX_ATTACHMENT_BYTES)
  const real=opened.path,rel=relative(realpathSync(home),real)
  if(!rel.startsWith('..'+sep)&&!isAbsolute(rel)&&SENSITIVE_HOME.some(d=>rel===d||rel.startsWith(d+sep)))throw new Error('este arquivo fica numa pasta de credenciais')
  for(const candidate of new Set([basename(path),basename(real)]))if(SENSITIVE_NAME.test(candidate))throw new Error('este arquivo parece guardar credenciais')
  const head=Buffer.alloc(12);readSync(opened.fd,head,0,12,0)
  return{ok:true,path:real,name:basename(real),kind:imageKind(head)?'image':'file',size:opened.size,fd:opened.fd,close:opened.close}
 }catch(e){opened?.close();return{ok:false,reason:e instanceof Error?e.message:'arquivo ilegível'}}
}
