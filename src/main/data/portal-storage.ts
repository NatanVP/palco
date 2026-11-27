import { PORTAL_PARTITION,isPortalPartition } from '../../shared/portal-settings'
interface PortalSession {clearStorageData():Promise<void>;clearCache():Promise<void>;clearAuthCache():Promise<void>}
interface Guest {session:PortalSession;stop():void;reload():void;isDestroyed():boolean;close?(options:{waitForBeforeUnload:boolean}):void}
/** Select only app-managed portal partitions, including orphaned ones when erasing all data. Never the app session. */
export async function clearPortalStorage(d:{session(partition:string):PortalSession;partitionNames():string[];knownPartitions():string[];guests():Guest[]},all:boolean):Promise<void>{
 const names=new Set([PORTAL_PARTITION]);if(all)for(const name of [...d.knownPartitions(),...d.partitionNames().map(n=>'persist:'+n)])if(isPortalPartition(name))names.add(name)
 for(const name of names){const session=d.session(name),guests=d.guests().filter(g=>g.session===session&&!g.isDestroyed());for(const g of guests){g.stop();if(all)g.close?.({waitForBeforeUnload:false})}
  await session.clearStorageData();await session.clearCache();await session.clearAuthCache();if(!all)for(const g of guests)if(!g.isDestroyed())g.reload()
 }
}
