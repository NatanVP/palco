import { operatePinned } from '../src/main/pinned-file-ops'
import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync,symlinkSync,existsSync,lstatSync,rmSync} from 'node:fs'
import {join}from'node:path'
import{tmpdir}from'node:os'
import{openAttachment}from'../src/main/chat/attach'
import{ChatStore}from'../src/main/chat/chat-store'
import{trashEntry,renameEntry,storeAttachment}from'../src/main/file-ops'
import{nodesForDrop}from'../src/renderer/src/canvas/drop'
import{defaultPreferences}from'../src/shared/preferences'
const dirs:string[]=[];const temp=()=>{const d=mkdtempSync(join(tmpdir(),'palco-review-fs-'));dirs.push(d);return d};afterEach(()=>{vi.restoreAllMocks();dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}))})
it("a cópia do chat usa o fd validado mesmo quando o nome é substituído por um link",()=>{
 const home=temp(),file=join(home,'ok.txt');writeFileSync(file,'original');const opened=openAttachment(file,home);expect(opened.ok).toBe(true);if(!opened.ok)return
 try{renameSync(file,file+'.old');writeFileSync(join(home,'other.txt'),'substituto');symlinkSync(join(home,'other.txt'),file);const store=new ChatStore(join(home,'chat'));const e=store.append('t','blue',{role:'user',kind:'message',text:'x'},[{name:opened.name,fd:opened.fd,maxBytes:25*1024*1024,kind:opened.kind}]);expect(readFileSync(store.attachmentPath('t','blue',e.attachments![0]!.id)!,'utf8')).toBe('original')}finally{opened.close()}
})
it("lixeira recebe o link selecionado, não a pasta de projeto que ele aponta",async()=>{
 const home=temp(),project=join(home,'project');mkdirSync(project);const link=join(home,'shortcut');symlinkSync(project,link)
 await trashEntry(link,home,async pinned=>{expect(lstatSync(pinned).isSymbolicLink()).toBe(true)});expect(existsSync(project)).toBe(true)
})
it("trocar o pai por link depois de validar não redireciona a operação para fora da home",async()=>{
 const home=temp(),outside=temp(),parent=join(home,'p');mkdirSync(parent);writeFileSync(join(parent,'a'),'original');writeFileSync(join(outside,'a'),'fora')
 await trashEntry(join(parent,'a'),home,async pinned=>{renameSync(parent,parent+'.old');symlinkSync(outside,parent);expect(readFileSync(pinned,'utf8')).toBe('original')});expect(readFileSync(join(outside,'a'),'utf8')).toBe('fora')
})
it("renomear não substitui um destino já existente, inclusive um link pendente",async()=>{
 const home=temp(),a=join(home,'a'),b=join(home,'b');writeFileSync(a,'original');symlinkSync(join(home,'missing'),b)
 await expect(renameEntry(a,'b',home)).rejects.toThrow(/já existe/);expect(readFileSync(a,'utf8')).toBe('original');expect(lstatSync(b).isSymbolicLink()).toBe(true)
})
it("uma colisão de nome de cópia nunca modifica o anexo anterior",async()=>{
 const home=temp(),source=join(home,'file.txt'),store=join(home,'copies');writeFileSync(source,'primeiro')
 const first=await storeAttachment(source,store,()=> 'fixed');writeFileSync(source,'segundo');await expect(storeAttachment(source,store,()=> 'fixed')).rejects.toThrow();expect(readFileSync(first,'utf8')).toBe('primeiro')
})
it("Sempre copiar recusa criar nó de arquivo quando a cópia falha",()=>{
 const p=defaultPreferences();p.alwaysCopyAttachments=true
 expect(nodesForDrop([{path:'/tmp/a.pdf',kind:'file',note:false}],{x:0,y:0},p,null,{})).toEqual([])
})

it("o commit atômico recusa destino criado depois da inspeção inicial",async()=>{
 const home=temp(),a=join(home,'a'),b=join(home,'b');writeFileSync(a,'original')
 await expect(renameEntry(a,'b',home,async(entry,action,arg)=>{writeFileSync(b,'concorrente');await operatePinned(entry,action,arg)})).rejects.toThrow()
 expect(readFileSync(b,'utf8')).toBe('concorrente');expect(readFileSync(a,'utf8')).toBe('original')
})

it("lixeira real move somente o link e registra o caminho original para restaurar",async()=>{
 const home=temp(),outside=temp(),target=join(outside,'project');mkdirSync(target);const link=join(home,'shortcut');symlinkSync(target,link)
 await trashEntry(link,home);expect(existsSync(link)).toBe(false);expect(existsSync(target)).toBe(true)
 const {readdirSync}=await import('node:fs');const trash=join(home,'.local/share/Trash'),item=readdirSync(join(trash,'files'))[0]!
 expect(lstatSync(join(trash,'files',item)).isSymbolicLink()).toBe(true);expect(readFileSync(join(trash,'info',item+'.trashinfo'),'utf8')).toContain('\nPath='+link+'\n')
})
it("renomear link preserva o nome e os bytes do alvo",async()=>{
 const home=temp(),target=join(home,'target');writeFileSync(target,'preservado');symlinkSync(target,join(home,'link'))
 const result=await renameEntry(join(home,'link'),'renamed',home);expect(lstatSync(result).isSymbolicLink()).toBe(true);expect(readFileSync(target,'utf8')).toBe('preservado')
})
it("a renomeação real permanece no diretório aberto após troca do pai por link",async()=>{
 const home=temp(),outside=temp(),parent=join(home,'p');mkdirSync(parent);writeFileSync(join(parent,'a'),'original');writeFileSync(join(outside,'a'),'fora')
 await renameEntry(join(parent,'a'),'b',home,async(entry,action,arg)=>{renameSync(parent,parent+'.old');symlinkSync(outside,parent);await operatePinned(entry,action,arg)})
 expect(readFileSync(join(parent+'.old','b'),'utf8')).toBe('original');expect(readFileSync(join(outside,'a'),'utf8')).toBe('fora');expect(existsSync(join(outside,'b'))).toBe(false)
})
