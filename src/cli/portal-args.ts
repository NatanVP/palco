export const PORTAL_ARITY: Record<string, readonly number[]> = {
 type:[1,2],key:[1],selectall:[0,1],clear:[0,1],hover:[1],focus:[1],select:[2],check:[0,1],drag:[2],wait:[1,2],a11y:[0],uncheck:[1],upload:Array.from({length:99},(_,i)=>i+2),scroll:[2,3],scrollintoview:[1],html:[0],evaluate:[1],'logs-start':[0],logs:[0],resize:[2],ua:[0,1],
 navigate:[1],snapshot:[0],click:[1],fill:[2],text:[0,1],screenshot:[0,1],back:[0],reload:[0],forward:[0],info:[0],close:[0],edit:[2],
}
export interface PortalCommand { cmd:'portal'; name:string; action:string; args:string[] }
export function parsePortal(a:string[]): PortalCommand {
 const fail=():never=>{throw new Error('Uso: palco portal create URL [Nome] [--size LxA] | portal ação Nome [argumentos]')}
 if(a[1]==='create') {
  const args=a.slice(2),url=args.shift();if(!url)fail()
  let label='Portal', size:string|undefined
  if(args[0] && args[0]!=='--size')label=args.shift()!
  if(args.length){if(args.length!==2 || args[0]!=='--size' || !/^\d+x\d+$/.test(args[1]!))fail();size=args[1]}
  return {cmd:'portal',action:'create',name:label,args:[url!,...(size?[size]:[])]}
 }
 // Preserve the old name-first spelling while documenting verb-first.
 const verbFirst=Object.hasOwn(PORTAL_ARITY,a[1]??'')
 const action=(verbFirst?a[1]:a[2])!, name=(verbFirst?a[2]:a[1])!
 let literal=false; const args:string[]=[]
 for (const x of a.slice(3)) { if(x==='--' && !literal){literal=true;continue} if(!literal && x.startsWith('-') && !(action==='edit' && x==='--url')) throw new Error('Uso: valor começa com hífen; use -- antes do valor'); args.push(x) }
 if(!name?.trim() || !PORTAL_ARITY[action]?.includes(args.length))fail()
 if(action==='edit' && args[0]!=='--url')fail()
 return {cmd:'portal',action,name,args}
}
