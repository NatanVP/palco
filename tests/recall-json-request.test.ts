import{expect,it}from'vitest'
import{parseRecall,recallRequestPath}from'../src/cli/chat'
import{ChatService}from'../src/main/chat/chat-service'
it("recall --json chega ao servidor e devolve JSON também no tópico vazio",()=>{
 expect(recallRequestPath(parseRecall(['--json']))).toContain('json=1')
 const c=new ChatService({store:{activeThread:()=> 'blue',all:()=>[],filledThreads:()=>[]} as never,onTerminalData:()=>()=>{}}as never)
 expect(JSON.parse(c.recall('t',{json:true}))).toEqual({thread:'blue',entries:[]});c.dispose()
})
