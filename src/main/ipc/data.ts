import{mt}from'../i18n'
import { dialog,shell } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { IpcArea } from './area'
import type { DataService } from '../data/data-service'
import { DATA_CH as C } from '../../shared/data-settings'
interface Service {data:DataService;restart(operation:()=>void|Promise<void>):void;reset():Promise<void>}
const installed=new WeakMap<object,Service>()
export function attachData(registry:object,value:Service):()=>void{installed.set(registry,value);return()=>{installed.delete(registry)}}
const string=(v:unknown):string=>{if(typeof v!=='string'||!v||v.length>4096)throw new Error('Identificador inválido.');return v}
export const dataArea:IpcArea=({handle,deps})=>{
 const service=()=>{const s=installed.get(deps.registry);if(!s)throw new Error('Dados indisponíveis.');return s},data=()=>service().data
 handle(C+'state',()=>({root:data().root(),backupIntervalMinutes:60,snapshots:data().snapshots(),lastSaveAt:data().lastSaveAt(),lastBackupAt:data().lastBackupAt(),warning:data().warning}))
 handle(C+'usage',()=>data().usage())
 handle(C+'pickRoot',async()=>{const r=await dialog.showOpenDialog({title:mt('Escolher raiz de dados'),properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0]??null})
 handle(C+'moveRoot',value=>{const path=string(value),backend=data();backend.validateMove(path);service().restart(()=>backend.moveRoot(path))})
 handle(C+'showFolder',async backups=>{if(backups!==undefined&&typeof backups!=='boolean')throw new Error('Opção inválida.');const path=backups?join(data().root(),'backups'):data().root();mkdirSync(path,{recursive:true,mode:0o700});if(await shell.openPath(path))throw new Error('Não foi possível abrir a pasta.')})
 handle(C+'backupNow',()=>data().backupNow())
 handle(C+'exportZip',async()=>{const r=await dialog.showSaveDialog({title:mt('Exportar Backup Completo'),defaultPath:'palco-backup-'+new Date().toISOString().slice(0,10)+'.zip',filters:[{name:'Backup ZIP',extensions:['zip']}]});if(r.canceled||!r.filePath)return false;data().exportZip(r.filePath);return true})
 handle(C+'pickImport',async()=>{const r=await dialog.showOpenDialog({title:mt('Importar Backup'),properties:['openFile'],filters:[{name:'Backup ZIP',extensions:['zip']}]});return r.canceled||!r.filePaths[0]?null:data().prepareImport(r.filePaths[0])})
 handle(C+'prepareSnapshot',id=>data().prepareSnapshot(string(id)))
 handle(C+'restore',token=>{const value=string(token),backend=data();backend.validatePrepared(value);service().restart(()=>backend.applyImport(value))})
 handle(C+'deleteSnapshot',id=>data().deleteSnapshot(string(id)));handle(C+'deleteGroup',id=>data().deleteGroup(string(id)))
 handle(C+'signOutAll',()=>data().signOutAll());handle(C+'reset',()=>{service().restart(service().reset)});handle(C+'clearGlobal',()=>data().clearGlobal())
}
