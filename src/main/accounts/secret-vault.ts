import { rmSync } from 'node:fs'
import { readEnvelope, writeEnvelopeAtomic } from '../domain/envelope'
export interface SecureCrypto { available(): boolean; encrypt(text: string): Buffer; decrypt(bytes: Buffer): string }
interface Entry { cipher: string; last4: string }
/** Only safeStorage ciphertext is persisted. No plaintext fallback, including Linux basic_text. */
export class SecretVault {
 constructor(private readonly file: string, private readonly crypto: SecureCrypto) {}
 available(): boolean { return this.crypto.available() }
 private entries(): Record<string, Entry> {
  const e = readEnvelope<Record<string, Entry>>(this.file,'encrypted-account-keys',1)
  if (e.readOnly || e.payload !== null && (typeof e.payload !== 'object' || Array.isArray(e.payload))) throw new Error('Cofre somente leitura.')
  for (const v of Object.values(e.payload ?? {})) if (!v || typeof v.cipher !== 'string' || typeof v.last4 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(v.cipher) || v.last4.length > 4) throw new Error('Cofre inválido; arquivo preservado.')
  return e.payload ?? {}
 }
 set(id: string, value: string): void {
  if (!this.available()) throw new Error('Armazenamento seguro indisponível. Configure o keyring do sistema.')
  if (typeof value !== 'string' || !value.trim() || value.length > 32768 || /[\r\n\0]/.test(value)) throw new Error('Chave inválida.')
  const entries = this.entries(); let cipher: Buffer
  try { cipher = this.crypto.encrypt(value.trim()) } catch { throw new Error('Não foi possível proteger a chave no armazenamento seguro.') }
  entries[id] = { cipher: cipher.toString('base64'), last4: value.trim().slice(-4) }; this.write(entries)
 }
 last4(id: string): string | undefined { return Object.hasOwn(this.entries(),id) ? this.entries()[id]?.last4 : undefined }
 get(id: string): string | undefined {
  if (!this.available()) throw new Error('Armazenamento seguro indisponível.')
  const entry = this.entries()[id]; if (!entry) return undefined
  try { return this.crypto.decrypt(Buffer.from(entry.cipher,'base64')) } catch { throw new Error('Não foi possível abrir a chave protegida.') }
 }
 remove(id: string): void { const entries = this.entries(); delete entries[id]; this.write(entries) }
 /** Sem cópia anterior: o `.bak` do envelope guardaria a chave substituída ou removida, e nada lê o cofre a partir dele. */
 private write(entries: Record<string, Entry>): void { writeEnvelopeAtomic(this.file,'encrypted-account-keys',1,entries); rmSync(`${this.file}.bak`, { force: true }) }
}
