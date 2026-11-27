import { askBatch } from '../../src/cli/batch'
it('batch starts all requests before waiting and preserves per-target failures', async () => {
 const starts:string[]=[];let finish!:()=>void
 const result=askBatch({A:'a',B:'b',C:'c'},async(name,prompt)=>{
  starts.push(name);expect(prompt).toBe(name.toLowerCase())
  if(name==='A')await new Promise<void>(r=>{finish=r})
  if(name==='C')throw new Error('offline')
  return {status:name==='B'?404:200,body:name==='B'?'not found':'answer'}
 })
 expect(starts).toEqual(['A','B','C']);finish()
 expect(await result).toEqual([{name:'A',output:'answer'},{name:'B',error:'not found'},{name:'C',error:'offline'}])
})
