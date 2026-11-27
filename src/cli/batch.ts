/** Each target has an independent request; a failed target never hides the other answers. */
export function askBatch(prompts: Record<string, string>, ask: (name: string, prompt: string) => Promise<{status: number; body: string}>): Promise<Array<{name: string; output: string} | {name: string; error: string}>> {
  return Promise.all(Object.entries(prompts).map(async ([name, prompt]) => {
    try {
      const reply = await ask(name, prompt)
      return reply.status === 200 ? { name, output: reply.body } : { name, error: reply.body.trim() }
    } catch (error) { return { name, error: error instanceof Error ? error.message : String(error) } }
  }))
}
