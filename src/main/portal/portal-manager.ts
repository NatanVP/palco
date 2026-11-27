import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pageAction } from './page-actions'
import { tmpdir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import type { WebContents } from 'electron'
import { isPortalUrl } from '../security'
import { chromeMajorOf, userAgentPresets } from '../../shared/portal-settings'
import { guarded, pageClick, pageFill, pageSnapshot, pageText } from './page-scripts'
import { mt } from '../i18n'

export type WebContentsLike = Pick<WebContents, 'loadURL' | 'executeJavaScript' | 'capturePage' | 'goBack' | 'reload' | 'getURL' | 'isDestroyed'> & Partial<Pick<WebContents, 'goForward' | 'insertText' | 'sendInputEvent' | 'debugger' | 'getUserAgent' | 'setUserAgent' | 'isLoading' | 'on' | 'removeListener' | 'close'>>

export const SNAPSHOT_LIMIT = 20_000
export const TEXT_LIMIT = 20_000

/** O nó portal ainda não anexou o webview (fora da tela, recém-criado) ou ele já foi destruído. */
export class PortalClosedError extends Error {
  constructor() {
    super('portal não está aberto')
    this.name = 'PortalClosedError'
  }
}

export interface PortalDeps {
  fromId(id: number): WebContentsLike | undefined
  writeFile(path: string, data: Buffer): void
  /** Nome do nó, só para nomear capturas de tela. */
  nameOf?(nodeId: string): string | undefined
  resizeNode?(nodeId: string, deltaWidth: number, deltaHeight: number): Promise<void> | void
  now?(): number
}

type LoadState = { status: 'pending' | 'loading' | 'loaded' | 'failed'; error?: string; waiters: Set<() => void>; wc?: WebContentsLike; listeners?: Array<[string, (...args: any[]) => void]> }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'portal'

function requireText(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} deve ser texto`)
  return value
}

/** Controla os webviews dos nós portal pelo `webContents`, com scripts de página autocontidos. */
export class PortalManager {
  private readonly popupEntries = new Map<string, { parentContents: number; contents: number; ordinal: number }>()
  private readonly popupCounts = new Map<number, number>()
  private readonly logs = new Map<string, { wc: WebContentsLike; listener: (...args: any[]) => void; entries: string[] }>()
  private readonly originalUa = new Map<string, string>()
  private readonly busy = new Set<string>()
  private readonly contents = new Map<string, number>()
  private readonly loads = new Map<string, LoadState>()

  constructor(private readonly deps: PortalDeps) {}

  register(nodeId: string, webContentsId: number): void {
    if (this.contents.has(nodeId) && this.contents.get(nodeId) !== webContentsId) this.unregister(nodeId)
    this.contents.set(nodeId, webContentsId)
    const wc = this.deps.fromId(webContentsId)
    if (!wc) return
    let load = this.loads.get(nodeId)
    if (!load) { load = { status: 'pending', waiters: new Set() }; this.loads.set(nodeId, load) }
    this.detachLoadListeners(load)
    load.wc = wc
    const url = wc.getURL?.() ?? ''
    load.status = wc.isLoading?.() ? 'loading' : url && url !== 'about:blank' ? 'loaded' : 'loading'
    if (load.waiters.size) this.attachLoadListeners(load)
    this.notifyLoadWaiters(load)
  }

  unregister(nodeId: string): void {
    for (const child of this.popups().filter(p => p.parentId === nodeId)) this.closePopup(child.id)
    const log = this.logs.get(nodeId)
    if (log) log.wc.removeListener?.('console-message', log.listener)
    this.logs.delete(nodeId); this.originalUa.delete(nodeId)
    this.contents.delete(nodeId)
    const load = this.loads.get(nodeId)
    if (load) {
      load.status = 'failed'; load.error = mt('portal fechado durante o carregamento'); this.detachLoadListeners(load)
      for (const waiter of [...load.waiters]) waiter()
      this.loads.delete(nodeId)
    }
  }

  /** Espera a navegação atual terminar; o timeout deixa o portal aberto para acompanhamento. */
  waitForLoad(nodeId: string, timeoutMs = 15_000): Promise<'loaded' | 'timeout'> {
    const load = this.loads.get(nodeId) ?? { status: 'pending' as const, waiters: new Set<() => void>() }
    this.loads.set(nodeId, load)
    if (load.status === 'loaded') return Promise.resolve('loaded')
    if (load.status === 'failed') return Promise.reject(new Error(load.error ?? mt('falha ao carregar a página')))
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        if (load.status === 'loaded') { settled = true; clearTimeout(timer); load.waiters.delete(finish); if (!load.waiters.size) this.detachLoadListeners(load); resolve('loaded') }
        else if (load.status === 'failed') { settled = true; clearTimeout(timer); load.waiters.delete(finish); if (!load.waiters.size) this.detachLoadListeners(load); reject(new Error(load.error ?? mt('falha ao carregar a página'))) }
      }
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        load.waiters.delete(finish)
        if (!load.waiters.size) this.detachLoadListeners(load)
        if (load.status === 'pending' && !load.wc && this.loads.get(nodeId) === load) this.loads.delete(nodeId)
        resolve('timeout')
      }, timeoutMs)
      load.waiters.add(finish)
      this.attachLoadListeners(load)
      finish()
    })
  }

  private detachLoadListeners(load: LoadState): void {
    if (load.wc) for (const [event, listener] of load.listeners ?? []) load.wc.removeListener?.(event as never, listener as never)
    load.listeners = undefined
  }

  private attachLoadListeners(load: LoadState): void {
    const wc = load.wc
    if (!wc?.on || load.listeners) return
    const started = (): void => { load.status = 'loading'; load.error = undefined; this.notifyLoadWaiters(load) }
    const finished = (): void => { load.status = 'loaded'; load.error = undefined; this.notifyLoadWaiters(load) }
    const failed = (_event: unknown, code: number, description: string, url: string, mainFrame: boolean): void => {
      if (!mainFrame || code === -3) return
      load.status = 'failed'; load.error = mt('falha ao carregar {p1}: {p2}', { p1: url, p2: description || String(code) }); this.notifyLoadWaiters(load)
    }
    load.listeners = [['did-start-loading', started], ['did-finish-load', finished], ['did-fail-load', failed]]
    for (const [event, listener] of load.listeners) wc.on(event as never, listener as never)
  }

  private notifyLoadWaiters(load: LoadState): void {
    for (const waiter of [...load.waiters]) waiter()
  }

  registerPopup(parentContents: number, contents: number): string {
    let root = parentContents
    for(let depth=0;depth<this.popupEntries.size;depth++){const p=[...this.popupEntries.values()].find(p=>p.contents===root);if(!p)break;root=p.parentContents}
    const id = `popup-${randomUUID()}`, ordinal = (this.popupCounts.get(root) ?? 1) + 1
    this.popupCounts.set(root,ordinal)
    this.popupEntries.set(id,{parentContents,contents,ordinal});this.contents.set(id,contents)
    return id
  }

  popups(): Array<{id:string;parentId:string;name:string}> {
    const rootOf=(contents:number,seen=new Set<number>()):string|undefined=>{
      if(seen.has(contents))return;seen.add(contents)
      for(const [id,wc] of this.contents)if(wc===contents){const popup=this.popupEntries.get(id);return popup?rootOf(popup.parentContents,seen):id}
    }
    return [...this.popupEntries].flatMap(([id,p])=>{
      const parentId=rootOf(p.parentContents)
      if(!parentId)return []
      return [{id,parentId,name:`[${this.deps.nameOf?.(parentId)??parentId}] #${p.ordinal}`}]
    })
  }

  closePopup(id:string):void {
    const popup=this.popupEntries.get(id);if(!popup)return
    for(const [child,p] of [...this.popupEntries])if(p.parentContents===popup.contents)this.closePopup(child)
    this.popupEntries.delete(id)
    const wc=this.deps.fromId(popup.contents)
    this.unregister(id)
    if(wc&&!wc.isDestroyed())wc.close?.()
  }

  unregisterContents(contentsId: number): void {
    for (const [id, contents] of [...this.contents]) if(contents === contentsId) {
      if(this.popupEntries.has(id))this.closePopup(id);else this.unregister(id)
    }
    this.popupCounts.delete(contentsId)
  }

  dispose(): void {
    for(const id of [...this.popupEntries.keys()])this.closePopup(id)
    for(const id of [...this.contents.keys()])this.unregister(id)
    for (const load of this.loads.values()) this.detachLoadListeners(load)
    this.loads.clear(); this.popupCounts.clear()
  }

  /** Serialized per guest: uploads/debugger, focus+type and resize cannot interfere with each other. */
  async action(nodeId: string, action: string, args: string[]): Promise<string> {
    if (this.busy.has(nodeId)) throw new Error('portal ocupado; aguarde a ação anterior')
    this.busy.add(nodeId)
    try { return await this.perform(nodeId, action, args) }
    finally { this.busy.delete(nodeId) }
  }

  private async perform(nodeId: string, action: string, args: string[]): Promise<string> {
    const wc = this.open(nodeId)
    // `check` sem alvo é "espiar" o portal (devolve o caminho de uma captura); com alvo marca o checkbox.
    if (action === 'check' && args.length === 0) return this.screenshot(nodeId)
    if (action === 'a11y') return this.snapshot(nodeId)
    if (action === 'wait') {
      const timeout = args[1] === undefined ? 5000 : Number(args[1])
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 600_000) throw new Error('prazo inválido (0 a 600000 ms)')
      for (const end = Date.now() + timeout; ;) {
        if (await this.exec(nodeId, guarded(pageAction, 'exists', args[0]!)) === 'yes') return 'ok'
        if (Date.now() >= end) throw new Error(`o elemento '${args[0]}' não apareceu no prazo de ${timeout} ms`)
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    if (action === 'drag') {
      if (!wc.sendInputEvent) throw new Error('mouse indisponível')
      const point = async (target: string): Promise<{ x: number; y: number }> => JSON.parse(await this.exec(nodeId, guarded(pageAction, 'hover', target))) as { x: number; y: number }
      const from = await point(args[0]!), to = await point(args[1]!)
      wc.sendInputEvent({ type: 'mouseMove', x: from.x, y: from.y })
      wc.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 })
      // Alguns passos no caminho: bibliotecas de arrastar só começam depois de o ponteiro andar.
      for (let i = 1; i <= 4; i++) wc.sendInputEvent({ type: 'mouseMove', x: Math.round(from.x + (to.x - from.x) * i / 4), y: Math.round(from.y + (to.y - from.y) * i / 4), button: 'left', modifiers: ['leftbuttondown'] })
      wc.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 })
      return 'ok'
    }
    if (action === 'evaluate') {
      const script = `(async()=>{try{const v=await(0,eval)(${JSON.stringify(args[0])});return {ok:true,value:typeof v==='string'?v:JSON.stringify(v)}}catch(e){return {ok:false,error:String(e&&e.message||e)}}})()`
      return this.exec(nodeId,script)
    }
    if (action === 'html') return this.exec(nodeId,guarded(pageAction,'html'))
    if (action === 'type') {
      if (args.length === 2) await this.exec(nodeId,guarded(pageAction,'focus',args[0]))
      if (!wc.insertText) throw new Error('digitação indisponível')
      await wc.insertText(args[args.length-1]!); return 'ok'
    }
    if (action === 'key') {
      if (!wc.sendInputEvent) throw new Error('teclas indisponíveis')
      const parts = args[0]!.toLowerCase().split('+'), key = parts.pop()!
      const modifiers: Array<'control'|'shift'|'alt'|'meta'> = []
      for (const part of parts) {const m:Record<string,'control'|'shift'|'alt'|'meta'>={ctrl:'control',control:'control',shift:'shift',alt:'alt',meta:'meta',cmd:'meta'};if(!m[part])throw new Error('modificador de tecla inválido');modifiers.push(m[part]!)}
      const keys:Record<string,string>={enter:'Enter',tab:'Tab',escape:'Escape',backspace:'Backspace',delete:'Delete',arrowup:'Up',arrowdown:'Down',arrowleft:'Left',arrowright:'Right',space:'Space',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown'}
      const keyCode = keys[key] ?? (/^[a-z0-9]$/.test(key)?key.toUpperCase():undefined)
      if(!keyCode)throw new Error('tecla inválida')
      wc.sendInputEvent({type:'keyDown',keyCode,modifiers});if(key.length===1&&!modifiers.some(m=>m!=='shift'))wc.sendInputEvent({type:'char',keyCode:modifiers.includes('shift')?key.toUpperCase():key,modifiers});wc.sendInputEvent({type:'keyUp',keyCode,modifiers});return 'ok'
    }
    if (action === 'logs-start') {
      if(this.logs.has(nodeId))return 'ok'
      if(!wc.on)throw new Error('console indisponível')
      const entries:string[]=[]
      const listener=(...a:any[]):void=>{
        const d=a[0],message=typeof d?.message==='string'?d.message:String(a[2]??'')
        entries.push(message.slice(0,4000));if(entries.length>250)entries.shift()
      }
      wc.on('console-message',listener);this.logs.set(nodeId,{wc,listener,entries});return 'ok'
    }
    if(action==='logs') {
      const log=this.logs.get(nodeId);return JSON.stringify(log?log.entries.splice(0):[])
    }
    if(action==='ua') {
      if(!wc.getUserAgent||!wc.setUserAgent)throw new Error('user agent indisponível')
      const groups=userAgentPresets(chromeMajorOf(wc.getUserAgent()))
      // A ordem das listas de `userAgentPresets`: computador (Chrome, Firefox, Edge) e celular (iPhone, Chrome, Firefox, Edge).
      const [desk,mobile]=groups.map(g=>g.items.map(i=>i.ua)) as [string[],string[]]
      const presets:Record<string,string>={ios:mobile[0]!,android:mobile[1]!,'firefox-android':mobile[2]!,'edge-android':mobile[3]!,chrome:desk[0]!,firefox:desk[1]!,edge:desk[2]!}
      if(!args.length)return JSON.stringify({ua:wc.getUserAgent(),presets:[...Object.keys(presets),'desktop']})
      const preset=args[0]!;if(preset!=='desktop'&&!Object.hasOwn(presets,preset))throw new Error('preset UA inválido')
      if(!this.originalUa.has(nodeId))this.originalUa.set(nodeId,wc.getUserAgent())
      wc.setUserAgent(preset==='desktop'?this.originalUa.get(nodeId)!:presets[preset]!);wc.reload();return 'ok'
    }
    if(action==='resize') {
      const width=Number(args[0]),height=Number(args[1])
      if(![width,height].every(n=>Number.isInteger(n)&&n>=200&&n<=4096))throw new Error('tamanho deve ficar entre 200 e 4096 px')
      if(!this.deps.resizeNode)throw new Error('resize indisponível')
      for(let i=0;i<20;i++) {
        const measured:unknown=JSON.parse(await this.info(nodeId))
        const v=measured as {width:number;height:number}
        if(!Number.isFinite(v.width)||!Number.isFinite(v.height))throw new Error('viewport inválido')
        if(v.width===width&&v.height===height)return `viewport: ${width}x${height}`
        // Give the renderer time to acknowledge the preceding correction before measuring again.
        if(i%5===0)await this.deps.resizeNode(nodeId,width-v.width,height-v.height)
        await new Promise(r=>setTimeout(r,20))
      }
      throw new Error('viewport não confirmou o tamanho solicitado')
    }
    if(action==='upload') {
      const files=args.slice(1).map(file=>resolve(file))
      if(!files.length)throw new Error('upload exige arquivo')
      for(const file of files){let regular=false;try{regular=statSync(file).isFile()}catch{/* absent */}if(!regular)throw new Error(`arquivo inexistente ou inválido: ${file}`)}
      const debug=wc.debugger;if(!debug)throw new Error('upload indisponível')
      const owned=!debug.isAttached();if(owned)debug.attach('1.3')
      let objectId:string|undefined
      try {
        const found=await debug.sendCommand('Runtime.evaluate',{expression:`(${pageAction.toString()})(document,'upload-target',${JSON.stringify(args[0])})`})
        if(found.exceptionDetails || !found.result?.objectId)throw new Error('input de arquivo não encontrado')
        objectId=found.result.objectId
        await debug.sendCommand('DOM.setFileInputFiles',{objectId,files});return 'ok'
      } finally {
        if(objectId)await debug.sendCommand('Runtime.releaseObject',{objectId}).catch(()=>{})
        if(owned&&debug.isAttached())debug.detach()
      }
    }
    if(action==='hover') {
      if(!wc.sendInputEvent)throw new Error('mouse indisponível')
      const point=JSON.parse(await this.exec(nodeId,guarded(pageAction,'hover',args[0]))) as {x:number;y:number}
      wc.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});return 'ok'
    }
    if(action==='scroll') {
      if(!['up','down','left','right'].includes(args[0]!)||!Number.isFinite(Number(args[1]))||Number(args[1])<0||Number(args[1])>1_000_000)throw new Error('direção/distância inválida')
      return this.exec(nodeId,guarded(pageAction,'scroll',args[2]??'',args[0],Number(args[1])))
    }
    if(['selectall','clear','hover','focus','select','check','uncheck','scrollintoview'].includes(action))return this.exec(nodeId,guarded(pageAction,action,args[0]??'',args[1]??''))
    throw new Error(`ação desconhecida: ${action}`)
  }

  async navigate(nodeId: string, url: string): Promise<string> {
    const target = requireText(url, 'a URL')
    let parsed: URL
    try {
      parsed = new URL(target)
    } catch {
      throw new Error(`URL inválida: ${target}`)
    }
    if (!isPortalUrl(parsed.href)) throw new Error('só http, https e file são permitidos')
    const wc = this.open(nodeId)
    try {
      await wc.loadURL(target)
    } catch (err) {
      throw new Error(`falha ao carregar ${target}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return wc.getURL()
  }

  snapshot(nodeId: string): Promise<string> {
    return this.exec(nodeId, guarded(pageSnapshot, SNAPSHOT_LIMIT))
  }

  text(nodeId: string): Promise<string> {
    return this.exec(nodeId, guarded(pageText, TEXT_LIMIT))
  }

  async click(nodeId: string, target: string): Promise<string> {
    return this.exec(nodeId, guarded(pageClick, requireText(target, 'o alvo')))
  }

  async fill(nodeId: string, target: string, value: string): Promise<string> {
    return this.exec(nodeId, guarded(pageFill, requireText(target, 'o alvo'), requireText(value, 'o valor')))
  }

  async back(nodeId: string): Promise<string> {
    const wc = this.open(nodeId)
    wc.goBack()
    return wc.getURL()
  }

  async forward(nodeId: string): Promise<string> {
    const wc = this.open(nodeId)
    if (!wc.goForward) throw new Error('avançar indisponível')
    wc.goForward(); return wc.getURL()
  }

  info(nodeId: string): Promise<string> {
    return this.exec(nodeId, `JSON.stringify({url:location.href,title:document.title,width:innerWidth,height:innerHeight})`)
  }

  elementText(nodeId: string, target: string): Promise<string> {
    const ref = target.replace(/^@(?=e\d+$)/, '')
    const selector = /^e\d+$/.test(ref) ? `[data-palco-ref="${ref}"]` : ref
    return this.exec(nodeId, `(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('elemento não encontrado');return (e.innerText??e.textContent??'').slice(0,${TEXT_LIMIT})})()`)
  }

  async reload(nodeId: string): Promise<string> {
    const wc = this.open(nodeId)
    wc.reload()
    return wc.getURL()
  }

  /** "Copiar Captura de Tela" do menu do portal: o PNG do que está visível. */
  async capturePng(nodeId: string): Promise<Buffer> {
    return (await this.open(nodeId).capturePage()).toPNG()
  }

  async screenshot(nodeId: string, path?: string): Promise<string> {
    const wc = this.open(nodeId)
    let target = path
    if (target === undefined) {
      const name = slug(this.deps.nameOf?.(nodeId) ?? nodeId)
      target = join(tmpdir(), `palco-${name}-${(this.deps.now ?? Date.now)()}.png`)
    } else if (!isAbsolute(target) || !target.toLowerCase().endsWith('.png') || target.split(sep).includes('..')) {
      throw new Error('caminho inválido: use um caminho absoluto, sem "..", terminado em .png')
    }
    const image = await wc.capturePage()
    this.deps.writeFile(target, image.toPNG())
    return target
  }

  private async exec(nodeId: string, script: string): Promise<string> {
    const envelope: unknown = await this.open(nodeId).executeJavaScript(script)
    // A página devolve {ok,value}|{ok:false,error}: a mensagem de erro dela chega inteira ao agente.
    const boxed = typeof envelope === 'object' && envelope !== null && 'ok' in envelope ? (envelope as { ok: boolean; value?: unknown; error?: unknown }) : null
    if (boxed && !boxed.ok) throw new Error(typeof boxed.error === 'string' ? boxed.error : 'a página recusou a ação')
    const result: unknown = boxed ? boxed.value : envelope
    return typeof result === 'string' ? result : result === undefined || result === null ? '' : String(result)
  }

  private open(nodeId: string): WebContentsLike {
    const id = this.contents.get(nodeId)
    const wc = id === undefined ? undefined : this.deps.fromId(id)
    if (!wc || wc.isDestroyed()) {
      this.unregister(nodeId)
      throw new PortalClosedError()
    }
    return wc
  }
}
