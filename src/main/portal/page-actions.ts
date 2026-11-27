/** Self-contained: executed in the isolated portal page, with JSON-encoded arguments. */
export function pageAction(doc: Document, action: string, target = '', value = '', amount = 0): unknown {
  if(action==='html') return doc.documentElement.outerHTML.slice(0,1_000_000)
  const roots: Array<Document|ShadowRoot>=[doc]
  let el: Element|null=null
  const coordinates=/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(target)
  const selector=/^@?e\d+$/.test(target)?`[data-palco-ref="${target.replace(/^@/,'')}"]`:target
  if(!target) {
    el=doc.activeElement
    for(let i=0;i<20&&el;i++){let next:Element|null=null;try {next=el.shadowRoot?.activeElement??(el.tagName==='IFRAME'?(el as HTMLIFrameElement).contentDocument?.activeElement??null:null)}catch{/* cross-origin */}if(!next||next===el)break;el=next}
  }
  else if(coordinates) el=doc.elementFromPoint(Number(coordinates[1]),Number(coordinates[2]))
  else for(let i=0;i<roots.length && !el;i++) {
    el=roots[i]!.querySelector(selector)
    if(!el) for(const child of roots[i]!.querySelectorAll('*')) {
      if(child.shadowRoot) roots.push(child.shadowRoot)
      if(child.tagName==='IFRAME') {try {const inner=(child as HTMLIFrameElement).contentDocument;if(inner)roots.push(inner)}catch{/* cross-origin */}}
    }
  }
  // `portal wait`: só pergunta se já está lá.
  if(action==='exists') return el?'yes':'no'
  if(!el) throw new Error('elemento não encontrado')
  if(action==='upload-target') {
    if(el.tagName!=='INPUT' || (el as HTMLInputElement).type!=='file') throw new Error('upload exige input de arquivo; não clique no botão')
    return el
  }
  if(action==='focus') {(el as HTMLElement).focus();return 'ok'}
  if(action==='hover') {
    el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();let x=r.x+r.width/2,y=r.y+r.height/2
    for(let view=el.ownerDocument.defaultView;view&&view!==doc.defaultView;){const frame=view.frameElement;if(!frame)break;const bounds=frame.getBoundingClientRect();x+=bounds.left;y+=bounds.top;view=frame.ownerDocument.defaultView}
    return JSON.stringify({x:Math.round(x),y:Math.round(y)})
  }
  if(action==='scrollintoview') {el.scrollIntoView({block:'center',inline:'center'});return 'ok'}
  if(action==='scroll') {
    const node = !target ? (doc.elementFromPoint?.((doc.defaultView?.innerWidth??0)/2,(doc.defaultView?.innerHeight??0)/2)??doc.scrollingElement??doc.documentElement) : el
    let scroller:Element|null=node
    while(scroller && scroller!==doc.documentElement) {
      const style=doc.defaultView!.getComputedStyle(scroller),vertical=value==='up'||value==='down'
      if(/auto|scroll/.test(vertical?style.overflowY:style.overflowX) && (vertical?scroller.scrollHeight>scroller.clientHeight:scroller.scrollWidth>scroller.clientWidth))break
      scroller=scroller.parentElement
    }
    scroller??=doc.scrollingElement??doc.documentElement
    scroller.scrollBy({top:value==='down'?amount:value==='up'?-amount:0,left:value==='right'?amount:value==='left'?-amount:0});return 'ok'
  }
  if((el as HTMLInputElement).disabled) throw new Error('elemento desabilitado')
  const view=el.ownerDocument.defaultView!, field=el as HTMLInputElement
  if(action==='check'||action==='uncheck') {
    if(el.tagName!=='INPUT'||!['checkbox','radio'].includes(field.type))throw new Error('elemento não é checkbox/radio')
    if(field.checked !== (action==='check')) {
      if(field.type==='radio' && action==='uncheck') {field.checked=false;el.dispatchEvent(new view.Event('input',{bubbles:true}));el.dispatchEvent(new view.Event('change',{bubbles:true}))}
      else field.click()
    }
    return 'ok'
  }
  if(action==='select') {
    if(el.tagName!=='SELECT')throw new Error('elemento não é select')
    const select=el as HTMLSelectElement, option=[...select.options].find(o=>o.value===value||o.text===value)
    if(!option)throw new Error('opção não encontrada')
    if(option.disabled)throw new Error('opção desabilitada')
    select.value=option.value
  } else if(action==='selectall'||action==='clear') {
    (el as HTMLElement).focus()
    if(el.tagName==='INPUT'||el.tagName==='TEXTAREA') {
      if(field.type==='file')throw new Error('use upload para input de arquivo')
      if(action==='selectall'){field.select();return 'ok'}
      if(field.readOnly)throw new Error('campo somente leitura')
      const prototype=el.tagName==='INPUT'?view.HTMLInputElement.prototype:view.HTMLTextAreaElement.prototype
      Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(el,'')
    } else if((el as HTMLElement).isContentEditable) {
      if(action==='clear')el.textContent=''
      else {const range=el.ownerDocument.createRange();range.selectNodeContents(el);const selection=view.getSelection();selection?.removeAllRanges();selection?.addRange(range);return 'ok'}
    } else throw new Error('elemento não é editável')
  } else throw new Error(`ação desconhecida: ${action}`)
  el.dispatchEvent(new view.Event('input',{bubbles:true}));el.dispatchEvent(new view.Event('change',{bubbles:true}));return 'ok'
}
