let resolver: ((id: string) => Record<string,string> | undefined) | undefined
export function installAccountRuntime(value: NonNullable<typeof resolver>): () => void { resolver = value; return () => { if (resolver === value) resolver = undefined } }
export function accountRuntime(id: string): Record<string,string> | undefined { return resolver?.(id) }
