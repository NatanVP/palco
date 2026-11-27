import { expect,it } from 'vitest'
import { parseAccountStatus } from '../src/main/accounts/cli-auth'
it('expõe somente estado, email e plano da CLI, descartando chaves e campos arbitrários',()=>{
 expect(parseAccountStatus('{"loggedIn":true,"email":"test@example.test","subscriptionType":"pro","accessToken":"FAKE_NOT_A_SECRET"}')).toEqual({connected:true,email:'test@example.test',plan:'pro'})
 expect(parseAccountStatus('Logged in using ChatGPT')).toEqual({connected:true})
 expect(parseAccountStatus('{"loggedIn":false,"email":"test@example.test"}')).toEqual({connected:false})
})
it('Codex lê identidade pelo account/read sem ler auth.json nem devolver payload bruto',async()=>{
 const {accountCommand}=await import('../src/main/accounts/cli-auth');const {ACCOUNT_PROVIDERS}=await import('../src/main/providers/provider-library');const p=ACCOUNT_PROVIDERS.find(p=>p.id==='codex')!
 const result=await accountCommand({id:'a',name:'Codex',agent:'codex',configDir:'/fake/codex'},p,'status',async(_cmd,args,env,input,until)=>{expect(args).toEqual(['app-server','--stdio']);expect(env.CODEX_HOME).toBe('/fake/codex');expect(input.map(s=>JSON.parse(s).method)).toEqual(['initialize','initialized','account/read']);expect(until({id:2})).toBe(true);return {id:2,result:{account:{type:'chatgpt',email:'test@example.test',planType:'plus',ignored:'FAKE'}}}})
 expect(result).toEqual({connected:true,email:'test@example.test',plan:'plus'})
})
