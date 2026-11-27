import { which } from '../environments/system'
import { shell } from 'electron'
import type { IpcArea } from './area'
import type { AccountService } from '../accounts/account-service'
import type { ProviderLibrary } from '../providers/provider-library'
import { ACCOUNT_SETTINGS_CH as A, PROVIDERS_CH as P, type NewAccount } from '../../shared/account-settings'
import type { ProviderArea } from '../../shared/providers'
interface Service { accounts: AccountService; providers: Record<ProviderArea,ProviderLibrary>; setUsageEnabled(v: boolean): void; terminals(): Array<{ id: string; name: string; agent: string; accountId?: string }> }
const installed = new WeakMap<object,Service>()
export function attachAccountSettings(registry: object,service: Service): () => void { installed.set(registry,service); return () => { installed.delete(registry) } }
const id = (v: unknown): string => { if (typeof v !== 'string' || !v || v.length > 200) throw new Error('Identificador inválido.'); return v }
export const accountSettingsArea: IpcArea = ({handle,deps}) => {
 const service = () => { const s = installed.get(deps.registry); if (!s) throw new Error('Contas indisponíveis.'); return s }
 const lib = (area: unknown) => { if (!['accounts','usage'].includes(String(area))) throw new Error('Área inválida.'); return service().providers[area as ProviderArea] }
 handle(A+'list',() => service().accounts.list()); handle(A+'secureStorage',() => service().accounts.secureStorage()); handle(A+'terminals',() => service().terminals())
 handle(A+'add',value => service().accounts.add(value as NewAccount))
 handle(A+'check',value => service().accounts.check(id(value))); handle(A+'login',value => service().accounts.login(id(value))); handle(A+'logout',value => service().accounts.logout(id(value)))
 handle(A+'setColor',(value,color) => { if (color !== null && typeof color !== 'string') throw new Error('cor inválida (use #RRGGBB)'); service().accounts.setColor(id(value),color as string | null) })
 handle(A+'rename',(value,name) => service().accounts.rename(id(value),id(name)))
 handle(A+'replaceKey',(value,key) => { if (typeof key !== 'string') throw new Error('Chave inválida.'); service().accounts.replaceKey(id(value),key) })
 handle(A+'remove',value => service().accounts.remove(id(value)))
 handle(A+'assign',(terminal,account,restart) => { if (typeof restart !== 'boolean') throw new Error('Troca inválida.'); return service().accounts.assign(id(terminal),account === null ? null : id(account),restart) })
 handle(A+'setUsageEnabled',value => { if (typeof value !== 'boolean') throw new Error('Opção inválida.'); service().setUsageEnabled(value) })
 handle(P+'path',area => lib(area).dir)
 handle(P+'list',area => [...lib(area).list(),...lib(area).missing()].sort((a,b)=>{const order=['claude','codex','antigravity'];const rank=(id:string)=>order.includes(id)?order.indexOf(id):3;return rank(a.id)-rank(b.id)||a.name.localeCompare(b.name)}).map(p => ({...p, executablePath: p.spec ? which(p.spec.command) : null})))
 handle(P+'configure',(area,value,patch) => lib(area).configure(id(value),patch as {enabled?:boolean;color?:string}))
 handle(P+'restoreOne',(area,value)=>lib(area).restoreOne(id(value)))
 handle(P+'restore',(area,all) => { if (typeof all !== 'boolean') throw new Error('Opção inválida.'); lib(area).restore(all) })
 handle(P+'reload',area => lib(area).reload())
 handle(P+'showFolder',async area => { const l = lib(area); l.ensure(); if (await shell.openPath(l.dir)) throw new Error('Não foi possível abrir a pasta.') })
}
