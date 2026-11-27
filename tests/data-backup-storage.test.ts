import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync,renameSync,readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeZip,decodeZip } from '../src/main/data/zip'
import { DataRoot } from '../src/main/data/data-root'
import { DataService } from '../src/main/data/data-service'
import { writeEnvelopeAtomic } from '../src/main/domain/envelope'
const dirs:string[]=[];const temp=()=>{const d=mkdtempSync(join(tmpdir(),'palco-data-'));dirs.push(d);return d}
afterEach(()=>{vi.useRealTimers();dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}))})
function setup(rename?:typeof renameSync){const base=temp(),root=join(base,'data');mkdirSync(root);const locator=new DataRoot(join(base,'locator.json'),root);const flush=vi.fn(),clearGlobal=vi.fn(async()=>{});const service=new DataService({roots:locator,flush,clearGlobal,workspaces:()=>[{id:'w',name:'Meu projeto'}],signOutAll:async()=>[],...(rename?{rename}:{})});const ws={id:'w',name:'Meu projeto',nodes:{},connections:[],drawings:[],floors:{},activeFloor:null,camera:{offset:{x:0,y:0},zoom:1}};writeEnvelopeAtomic(join(root,'workspaces/w.json'),'workspace',2,ws);writeEnvelopeAtomic(join(root,'preferences.json'),'preferences',1,{test:'preservado'});return{base,root,locator,service,flush,clearGlobal,ws}}
it('ZIP portátil preserva bytes, recusa travessia, duplicatas e CRC corrompido',()=>{
 const zip=encodeZip(new Map([['data/a.txt',Buffer.from('texto')],['manifest.json',Buffer.from('{}')]]));expect(decodeZip(zip).get('data/a.txt')?.toString()).toBe('texto')
 expect(()=>encodeZip(new Map([['../escape',Buffer.from('x')]]))).toThrow()
 const corrupted=Buffer.from(zip);corrupted[40]=corrupted[40]!^255;expect(()=>decodeZip(corrupted)).toThrow()
})
it('Alterar raiz copia tudo, remapeia caminhos internos e persiste a escolha; recusa destino ocupado e links',()=>{
 const{base,root,locator}=setup();writeEnvelopeAtomic(join(root,'accounts.json'),'accounts',1,[{id:'a',configDir:join(root,'account-data/a')}]);const next=join(base,'next');locator.move(next)
 expect(new DataRoot(join(base,'locator.json'),root).current()).toBe(next);expect(existsSync(join(next,'workspaces/w.json'))).toBe(true)
 expect(readFileSync(join(next,'accounts.json'),'utf8')).toContain(join(next,'account-data/a'));expect(existsSync(root)).toBe(false)
 const occupied=join(base,'occupied');mkdirSync(occupied);writeFileSync(join(occupied,'mine'),'x');expect(()=>locator.move(occupied)).toThrow();expect(readFileSync(join(occupied,'mine'),'utf8')).toBe('x')
 symlinkSync(next,join(base,'link'));expect(()=>locator.move(join(base,'link'))).toThrow()
})
it('backups manuais/horários agrupam snapshots por workspace, validam conteúdo e excluem por id/grupo',async()=>{
 vi.useFakeTimers();const{service,flush}=setup();service.start();await vi.advanceTimersByTimeAsync(3600000);expect(service.snapshots().length).toBeGreaterThan(0);expect(flush).toHaveBeenCalled()
 const one=service.snapshots()[0]!;expect(one.workspaceId).toBe('w');const prepared=service.prepareSnapshot(one.id);expect(prepared.workspaceCount).toBe(1)
 service.deleteSnapshot(one.id);expect(service.snapshots().some(s=>s.id===one.id)).toBe(false);service.backupNow();service.deleteGroup('w');expect(service.snapshots()).toEqual([]);service.dispose()
})
it('exportar/importar ZIP substitui workspaces, preserva preferências/contas e faz cópia anterior',()=>{
 const{service,base,root,ws}=setup(),file=join(base,'backup.zip');service.exportZip(file)
 const payload=decodeZip(readFileSync(file));expect(payload.has('manifest.json')).toBe(true)
 writeEnvelopeAtomic(join(root,'workspaces/w.json'),'workspace',2,{...ws,name:'Novo'});const prepared=service.prepareImport(file);expect(prepared.workspaceCount).toBe(1);service.applyImport(prepared.token)
 expect(readFileSync(join(root,'workspaces/w.json'),'utf8')).toContain('Meu projeto');expect(readFileSync(join(root,'preferences.json'),'utf8')).toContain('preservado');expect(service.snapshots().length).toBeGreaterThan(0)
})
it('restaurar um snapshot só muda o workspace escolhido e backup inválido não altera nada',()=>{
 const{service,base,root,ws}=setup();service.backupNow();const snapshot=service.snapshots()[0]!;writeEnvelopeAtomic(join(root,'workspaces/w.json'),'workspace',2,{...ws,name:'Novo'});writeFileSync(join(root,'workspaces/other.txt'),'outro')
 service.applyImport(service.prepareSnapshot(snapshot.id).token);expect(readFileSync(join(root,'workspaces/other.txt'),'utf8')).toBe('outro')
 const bad=join(base,'bad.zip');writeFileSync(bad,encodeZip(new Map([['manifest.json',Buffer.from('{bad')]])));expect(()=>service.prepareImport(bad)).toThrow();expect(readFileSync(join(root,'workspaces/w.json'),'utf8')).toContain('Meu projeto')
})
it('backup não exporta credenciais das CLIs nem segue links; reset apaga só a raiz; portal só chama limpeza global',async()=>{
 const{service,base,root,clearGlobal}=setup();mkdirSync(join(root,'account-data'),{recursive:true});writeFileSync(join(root,'account-data/private'),'fixture sem credencial');const file=join(base,'full.zip');service.exportZip(file);expect([...decodeZip(readFileSync(file)).keys()].some(k=>k.includes('account-data'))).toBe(false)
 const outside=join(base,'outside');mkdirSync(outside);writeFileSync(join(outside,'keep'),'x');symlinkSync(outside,join(root,'link'));expect(()=>service.exportZip(join(base,'link.zip'))).toThrow();rmSync(join(root,'link'))
 await service.clearGlobal();expect(clearGlobal).toHaveBeenCalledOnce();service.reset();expect(existsSync(join(root,'workspaces/w.json'))).toBe(false);expect(readFileSync(join(outside,'keep'),'utf8')).toBe('x')
})
it('prévia continua válida depois de desligar temporizadores para restaurar antes do relançamento',()=>{
 const{service,base}=setup(),file=join(base,'backup.zip');service.exportZip(file);const p=service.prepareImport(file);service.dispose();expect(()=>service.applyImport(p.token)).not.toThrow()
})
it('decodificador recusa caminhos externos vindos de um ZIP produzido fora do app',()=>{
 const zip=encodeZip(new Map([['aa/escape',Buffer.from('x')]]));let at=zip.indexOf('aa/escape');while(at!==-1){zip.write('../escape',at);at=zip.indexOf('aa/escape',at+1)}expect(()=>decodeZip(zip)).toThrow(/Caminho/)
})
import { clearPortalStorage } from '../src/main/data/portal-storage'
it('limpeza global não toca sessões isoladas; apagar tudo alcança partições órfãs sem tocar na sessão do app',async()=>{
 const clears=new Map<string,()=>Promise<void>>(),session=(name:string)=>{const clear=clears.get(name)??vi.fn(async()=>{});clears.set(name,clear);return{clearStorageData:clear,clearCache:vi.fn(async()=>{}),clearAuthCache:vi.fn(async()=>{})}}
 const deps={session,partitionNames:()=>['palco-portal','portal-ws-w','portal-orphan','app-auth','../fora'],guests:()=>[],knownPartitions:()=>[]}
 await clearPortalStorage(deps,false);expect([...clears.keys()]).toEqual(['persist:palco-portal'])
 await clearPortalStorage(deps,true);expect(clears.has('persist:portal-orphan')).toBe(true);expect(clears.has('persist:app-auth')).toBe(false)
})
it('se instalar e reverter falharem, mantém a árvore de recuperação em vez de apagá-la no finally',()=>{
 const rename:typeof renameSync=(from,to)=>{if(String(from).includes('.palco-import-')||String(from).includes('.palco-rollback-'))throw new Error('falha simulada');renameSync(from,to)}
 const{service,base,root,ws}=setup(rename),file=join(base,'backup.zip');service.exportZip(file);writeEnvelopeAtomic(join(root,'workspaces/w.json'),'workspace',2,{...ws,name:'Estado atual'})
 const token=service.prepareImport(file).token;expect(()=>service.applyImport(token)).toThrow(/preservada/)
 const recovery=readdirSync(base).find(n=>n.startsWith('.palco-rollback-'))!;expect(readFileSync(join(base,recovery,'workspaces/w.json'),'utf8')).toContain('Estado atual')
})
it('os ZIPs não levam o cofre de chaves (a importação nem o usa)',()=>{
 const{service,base,root}=setup();for(const f of ['encrypted-account-keys.json','encrypted-account-keys.json.bak'])writeFileSync(join(root,f),'{"type":"encrypted-account-keys","schemaVersion":1,"payload":{}}')
 const file=join(base,'full.zip');service.exportZip(file);expect([...decodeZip(readFileSync(file)).keys()].filter(k=>k.includes('encrypted-account-keys'))).toEqual([])
})
