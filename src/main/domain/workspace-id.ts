/** Only a single safe filename component; used for sidebar, migration and every open. */
export const validWorkspaceId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export function assertWorkspaceId(value: string): void { if (!validWorkspaceId(value)) throw new Error('id de workspace inválido') }
