/** Estado de edição de uma nota: o texto local só é preservado enquanto houver edição não enviada. */
export class NoteSync {
  text: string
  private base: string
  private dirty = false

  constructor(content: string) {
    this.text = content
    this.base = content
  }

  focus(): void {
    /* o foco sozinho não é edição; mantido por clareza do contrato */
  }

  edit(value: string): void {
    this.text = value
    this.dirty = value !== this.base
  }

  /** Conteúdo vindo do main. Devolve o texto a mostrar, ou undefined quando nada muda. */
  external(content: string): string | undefined {
    if (this.dirty) return undefined
    if (content === this.text) {
      this.base = content
      return undefined
    }
    this.base = content
    this.text = content
    return content
  }

  /** Marca a edição como enviada (debounce disparou). Devolve o texto a gravar, se houver edição. */
  flush(): string | undefined {
    if (!this.dirty) return undefined
    this.dirty = false
    this.base = this.text
    return this.text
  }

  blur(): string | undefined {
    return this.flush()
  }
}
