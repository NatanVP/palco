import { deflateRawSync,inflateRawSync } from 'node:zlib'
const MAX=512*1024*1024, COUNT=20000
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);return c>>>0})
export function crc32(bytes:Buffer):number{let crc=0xffffffff;for(const b of bytes)crc=(crc>>>8)^CRC_TABLE[(crc^b)&255]!;return(crc^0xffffffff)>>>0}
function name(value:string):string{if(!value||value.length>4096||value.includes('\\')||value.includes('\0')||value.startsWith('/')||/^[a-z]:/i.test(value)||value.split('/').some(p=>p==='..'||p==='.'||p===''))throw new Error('Caminho inseguro no ZIP.');return value}
/** Standard ZIP (UTF-8, deflate, CRC32); bounded ZIP32 only. Never extracts directly into a live data root. */
export function encodeZip(files:Map<string,Buffer>):Buffer{
 if(files.size>COUNT)throw new Error('Arquivos demais no backup.')
 const local:Buffer[]=[],central:Buffer[]=[],seen=new Set<string>();let offset=0,total=0
 for(const[raw,bytes]of files){const path=name(raw),fold=path.toLowerCase();if(seen.has(fold))throw new Error('Caminho duplicado.');seen.add(fold);total+=bytes.length;if(total>MAX)throw new Error('Backup excede 512 MB.')
  const filename=Buffer.from(path),compressed=deflateRawSync(bytes),crc=crc32(bytes),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(filename.length,26)
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(bytes.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42)
  local.push(h,filename,compressed);central.push(c,filename);offset+=h.length+filename.length+compressed.length
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
 return Buffer.concat([...local,directory,end])
}
export function decodeZip(zip:Buffer):Map<string,Buffer>{
 const fail=():never=>{throw new Error('ZIP inválido, corrompido ou não suportado.')},range=(o:number,n:number)=>{if(o<0||n<0||o+n>zip.length)fail()}
 if(zip.length<22||zip.length>MAX)fail();let end=-1
 for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50&&i+22+zip.readUInt16LE(i+20)===zip.length){end=i;break}
 if(end<0)fail();const count=zip.readUInt16LE(end+10),size=zip.readUInt32LE(end+12),start=zip.readUInt32LE(end+16)
 if(count>COUNT||zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6)||count!==zip.readUInt16LE(end+8)||start+size!==end)fail()
 let at=start,total=0;const result=new Map<string,Buffer>(),seen=new Set<string>()
 for(let n=0;n<count;n++){range(at,46);if(zip.readUInt32LE(at)!==0x02014b50)fail();const flags=zip.readUInt16LE(at+8),method=zip.readUInt16LE(at+10),crc=zip.readUInt32LE(at+16),packed=zip.readUInt32LE(at+20),length=zip.readUInt32LE(at+24),names=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42),mode=(zip.readUInt32LE(at+38)>>>16)&0xf000
  if(flags&1||![0,8].includes(method)||mode===0xa000||length>MAX||packed>MAX)fail();range(at+46,names+extra+comment)
  let path:string;try{path=new TextDecoder('utf-8',{fatal:true}).decode(zip.subarray(at+46,at+46+names))}catch{fail()}
  const directory=path!.endsWith('/');path=name(directory?path!.slice(0,-1):path!);const fold=path.toLowerCase();if(seen.has(fold))fail();seen.add(fold);total+=length;if(total>MAX)fail()
  range(local,30);if(zip.readUInt32LE(local)!==0x04034b50||zip.readUInt16LE(local+8)!==method||zip.readUInt16LE(local+6)&1)fail();const localNames=zip.readUInt16LE(local+26),localExtra=zip.readUInt16LE(local+28);range(local+30,localNames+localExtra+packed)
  if(!zip.subarray(local+30,local+30+localNames).equals(zip.subarray(at+46,at+46+names)))fail();const dataStart=local+30+localNames+localExtra;if(dataStart+packed>start)fail()
  let bytes:Buffer;try{bytes=method===0?Buffer.from(zip.subarray(dataStart,dataStart+packed)):inflateRawSync(zip.subarray(dataStart,dataStart+packed),{maxOutputLength:Math.max(1,length)})}catch{fail()}
  if(bytes!.length!==length||crc32(bytes!)!==crc)fail();if(!directory)result.set(path,bytes!);at+=46+names+extra+comment
 }
 if(at!==end)fail();const sorted=[...result.keys()].map(p=>p.toLowerCase()).sort();for(let n=1;n<sorted.length;n++)if(sorted[n]!.startsWith(sorted[n-1]!+'/'))fail()
 return result
}
