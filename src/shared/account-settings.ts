import type { Account } from './model'
export interface AccountView extends Account { mode: 'cli' | 'apiKey'; status: 'checking' | 'connected' | 'disconnected' | 'unknown' | 'notInstalled'; terminalCount: number; email?: string; plan?: string; keyLast4?: string }
export interface NewAccount { name: string; providerId: string; mode: 'cli' | 'apiKey'; key?: string; endpoint?: string; dir?: string }
export interface AccountSettingsApi {
 setColor(id: string, color: string | null): Promise<void>
 terminals(): Promise<Array<{ id: string; name: string; agent: string; accountId?: string }>>;
 list(): Promise<AccountView[]>; secureStorage(): Promise<boolean>; add(input: NewAccount): Promise<AccountView>
 check(id: string): Promise<AccountView>; login(id: string): Promise<void>; logout(id: string): Promise<void>; rename(id: string,name: string): Promise<void>; replaceKey(id: string,key: string): Promise<void>; remove(id: string): Promise<void>
 /** Applies metadata now; `restart=false` leaves the live process untouched until its next start. */
 assign(terminalId: string, accountId: string | null, restart: boolean): Promise<void>
 setUsageEnabled(value: boolean): Promise<void>
}
export const ACCOUNT_SETTINGS_CH = 'palco:accountSettings:'
export const PROVIDERS_CH = 'palco:providers:'
