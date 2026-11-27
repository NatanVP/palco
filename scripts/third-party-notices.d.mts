export interface ThirdPartyPackage { name: string; version: string; license: string; texts: number[]; note?: string }
export function collectNotices(root: string): { packages: ThirdPartyPackage[]; texts: string[] }
