import{mt}from'./i18n'
import{readEnvelope,writeEnvelopeAtomic}from'./domain/envelope'
export interface DiagnosticFacts{appVersion:string;electron:string;chrome:string;node:string;platform:string;arch:string;release:string;memoryMB:number;cpuCount:number;workspaceCount:number;terminalCount:number}
/** Explicit allowlist: no logs, environment dump, credentials, names, commands, paths or prompt contents. */
export class Diagnostics{
 constructor(private readonly onboardingFile:string,private readonly facts:()=>DiagnosticFacts){}
 report():string{const d=this.facts();return mt('Diagnóstico do palco\nGerado em: {p1}\nVersão: {p2}\nElectron: {p3}\nChromium: {p4}\nNode: {p5}\nSistema: {p6} {p7} ({p8})\nMemória (MB): {p9}\nCPUs: {p10}\nEspaços de trabalho: {p11}\nTerminais: {p12}\n\nEste relatório não inclui logs, credenciais, nomes, caminhos, comandos ou conteúdo dos espaços de trabalho.\n',{p1:new Date().toISOString(),p2:d.appVersion,p3:d.electron,p4:d.chrome,p5:d.node,p6:d.platform,p7:d.release,p8:d.arch,p9:d.memoryMB,p10:d.cpuCount,p11:d.workspaceCount,p12:d.terminalCount})}
 onboardingCompleted():boolean{const e=readEnvelope<{completed:boolean}>(this.onboardingFile,'onboarding',1);return e.payload?.completed===true}
 private set(completed:boolean):void{const e=readEnvelope(this.onboardingFile,'onboarding',1);if(e.readOnly)throw new Error('Estado de boas-vindas somente leitura.');writeEnvelopeAtomic(this.onboardingFile,'onboarding',1,{completed})}
 completeOnboarding():void{this.set(true)}reopenOnboarding():void{this.set(false)}
}
