/**
 * O jsdom se declara `en-US` e a máquina de CI pode estar em qualquer língua: os testes de tela conferem os textos em pt-BR (a fonte),
 * então o "idioma do sistema" do ambiente de teste é fixo. Quem testa outro idioma passa a preferência ou chama `setLocale`.
 */
if (typeof navigator !== 'undefined') Object.defineProperty(navigator, 'language', { get: () => 'pt-BR', configurable: true })
