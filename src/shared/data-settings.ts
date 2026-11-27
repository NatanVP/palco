export interface BackupSnapshot { id:string; workspaceId:string; workspaceName:string; createdAt:string; size:number }
export interface PreparedBackup { token:string; workspaceCount:number; kind:'full'|'workspace'; createdAt:string; workspaceName?:string }
export interface DataUsage { total:number; workspaces:Array<{id:string;name:string;size:number}> }
export interface DataSettingsApi {
 state():Promise<{root:string;backupIntervalMinutes:number;snapshots:BackupSnapshot[];lastSaveAt?:string|null;lastBackupAt?:string|null;warning?:string}>
 usage():Promise<DataUsage>
 pickRoot():Promise<string|null>;moveRoot(path:string):Promise<void>;showFolder(backups?:boolean):Promise<void>
 backupNow():Promise<void>;exportZip():Promise<boolean>;pickImport():Promise<PreparedBackup|null>;prepareSnapshot(id:string):Promise<PreparedBackup>;restore(token:string):Promise<void>
 deleteSnapshot(id:string):Promise<void>;deleteGroup(workspaceId:string):Promise<void>
 signOutAll():Promise<string[]>;reset():Promise<void>;clearGlobal():Promise<void>
}
export const DATA_CH='palco:data:'
