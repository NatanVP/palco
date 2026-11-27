---
name: palco-portal
description: Usa um portal de navegador no canvas do palco para navegar na web, interagir com páginas, preencher formulários e inspecionar conteúdo. Use quando o usuário pedir para abrir uma URL, testar uma interface web ou interagir com um site. Vale quando a variável PALCO_SOCKET existe (o terminal roda dentro do palco).
user-invocable: true
---

# Automação de navegador com portais do palco

Você está rodando dentro do palco, um espaço de desenvolvimento em canvas que liga agentes de IA, terminais, notas e portais de navegador.
O CLI `palco` já vem instalado e está no PATH. Se `palco` não for encontrado, use `"$PALCO_CLI"`; essa variável sempre aponta para o executável completo.

Portais são nós de navegador embutidos no canvas do palco. Você pode automatizá-los para navegar, clicar em elementos, preencher formulários, tirar screenshots e inspecionar o DOM — tudo sem precisar do foco da janela.

O nome do portal é sempre obrigatório. Rode `palco list` para ver os nomes dos portais conectados.

## Criando um portal

`palco portal create URL ["Nome"] [--size LxA]` — cria um portal novo no canvas, abre na URL dada e o conecta automaticamente ao seu terminal. O portal aparece à direita do seu terminal. Dá para passar um nome; se omitido, o padrão é "Portal". Passe `--size LxA` para abrir num viewport específico (útil para QA responsivo, por exemplo `--size 390x844`); senão ele abre num tamanho de desktop. Para garantir o viewport CSS exato, confira com `info` e ajuste com `resize`.

```
palco portal create http://localhost:3000
palco portal create https://example.com "Docs"
palco portal create http://localhost:3000 "Celular" --size 390x844
```

O comando espera a página terminar de carregar por até 15 segundos. Se esse prazo passar, ele informa que a página continua carregando; você pode seguir direto para `palco portal snapshot "Portal"`. Falhas de carregamento retornam um erro claro. Depois de criar, rode `palco list` para confirmar o nome do portal e use-o em todos os outros comandos de portal — não precisa inserir `sleep`.

## Editando um portal

`palco portal edit "Portal" --url URL` — aponta um portal conectado para uma URL nova.

```
palco portal edit "Preview" --url http://localhost:5173
```

## Fechando um portal

`palco portal close "Portal"` — remove do canvas um portal conectado.

**Destrutivo. Só rode quando o usuário pedir explicitamente para fechar o portal.** Nunca feche um portal por iniciativa própria, nem para arrumar depois de terminar uma tarefa.

```
palco portal close "Preview"
```

## Snapshot e seletores

O comando **snapshot** é o mais importante — ele devolve uma árvore de acessibilidade com **refs** (`@e1`, `@e2`...) que servem de seletor para todos os outros comandos:

```
palco portal snapshot "Portal"
```

Devolve algo como:
```
viewport: 780x520  url: https://example.com  title: Example
@e1 a "Home" [10,5 60x20]
@e2 input type=text "Search" [200,50 300x32] *focused*
@e3 button "Submit" [510,50 80x32]
@e4 a "Sign In" href=https://example.com/login [700,5 60x20]
```

**Seletores** — todo comando que recebe seletor aceita:
- `@e3` — ref do snapshot (o mais confiável)
- `#submit` — seletor CSS
- `350,200` — coordenadas x,y

## Comandos

### Navegação
- `palco portal navigate "Portal" "url"` — vai para a URL e espera o carregamento terminar; falhas retornam erro
- `palco portal back "Portal"` / `forward` — volta ou avança no histórico do portal
- `palco portal reload "Portal"` — recarrega a página (também tenta de novo uma que falhou ao carregar)
- `palco portal info "Portal"` — URL atual, título e tamanho do viewport
- `palco portal screenshot "Portal"` — captura um screenshot (devolve o caminho de um arquivo temporário)
- `palco portal check "Portal"` — sem alvo, é uma espiada: o mesmo que `screenshot`

### Interação
- `palco portal click "Portal" @e3` — clica no elemento
- `palco portal fill "Portal" @e2 "teste@example.com"` — limpa o campo e define o valor
- `palco portal type "Portal" @e2 "olá"` — acrescenta texto ao campo (ou digita no elemento com foco: `type "Portal" "olá"`)
- `palco portal key "Portal" "Enter"` — aperta uma tecla (Enter, Tab, Escape, Backspace, ArrowUp/Down/Left/Right, Space)
- `palco portal key "Portal" "ctrl+a"` — tecla com modificadores (ctrl, shift, alt — por exemplo `ctrl+a`, `shift+tab`)
- `palco portal selectall "Portal"` — seleciona todo o texto do elemento com foco (ou indique um seletor: `selectall "Portal" @e2`)
- `palco portal clear "Portal"` — limpa o campo com foco (ou indique um seletor: `clear "Portal" @e2`)
- `palco portal hover "Portal" @e3` — passa o mouse sobre o elemento
- `palco portal drag "Portal" @e3 @e7` — arrasta com o mouse de um elemento até outro (arrastar e soltar nativo do HTML5 não responde a este arrasto)
- `palco portal focus "Portal" @e2` — dá foco ao elemento
- `palco portal select "Portal" @e5 "Texto da Opção"` — escolhe uma opção de um dropdown
- `palco portal check "Portal" @e6` / `uncheck` — marca ou desmarca um checkbox
- `palco portal upload "Portal" @e4 ./relatorio.pdf` — envia arquivos (liste vários para um input múltiplo) pelo input de arquivo ou pelo botão que o abre. Não use `click` num input de arquivo para enviar: isso abre um diálogo de arquivo no computador do usuário que você não consegue preencher.

### Rolagem
- `palco portal scroll "Portal" down 300` — rola 300 px para baixo a partir do centro do viewport (up/down/left/right)
- `palco portal scroll "Portal" down 300 400,250` — rola o contêiner sob o ponto (400,250)
- `palco portal scroll "Portal" down 300 @e5` — rola o contêiner sob o elemento @e5
- `palco portal scrollintoview "Portal" @e10` — rola até o elemento ficar visível

### Leitura
- `palco portal snapshot "Portal"` — árvore de acessibilidade com refs (o melhor para entender a estrutura da página)
- `palco portal text "Portal" @e1` — texto de um elemento
- `palco portal wait "Portal" @e3 5000` — espera o elemento aparecer (prazo em ms; padrão 5000) e falha se não aparecer; `palco portal a11y "Portal"` é o mesmo que `snapshot`
- `palco portal html "Portal"` — HTML completo da página
- `palco portal evaluate "Portal" "document.title"` — avalia JavaScript

### Console
- `palco portal logs-start "Portal"` — começa a capturar a saída do console (chame uma vez depois do navigate)
- `palco portal logs "Portal"` — devolve os logs capturados (e limpa o buffer)

### Testes responsivos
Portais abrem num tamanho de desktop (~1900 px de largura). Redimensione um para testar breakpoints responsivos sem arrastar o nó à mão.

- `palco portal resize "Portal" 390 844` — define o viewport CSS (`window.innerWidth`/`innerHeight`) em exatamente L×A px. Devolve o viewport obtido (por exemplo `viewport: 390x844`). Para emular um aparelho, passe as dimensões lógicas dele: iPhone SE `375 667`, iPhone 12 Pro `390 844`, Pixel 7 `412 915`, iPad Mini `768 1024`. Confirme com `info` ou rodando `snapshot` de novo (o cabeçalho dele imprime o viewport).
- `palco portal ua "Portal" ios` — troca o user agent por um preset e recarrega, para que sites que olham o UA sirvam a variante móvel (ou outra). Combine com `resize` para emular um aparelho de verdade (por exemplo `resize 390 844` + `ua ios`). Presets: `ios`, `android`, `firefox-android`, `edge-android`, `chrome`, `firefox`, `edge`, `desktop` (limpa a troca). Omita o argumento para ler o UA atual e listar os presets.

## Fluxo recomendado

1. `palco portal snapshot "Portal"` — entenda a estrutura da página e pegue as refs
2. Use as refs para interagir: `click @e3`, `fill @e2 "valor"`, `key "Enter"`
3. `palco portal snapshot "Portal"` de novo para conferir o resultado
4. Se as refs ficarem velhas (a página mudou), rode o snapshot de novo para pegar refs novas

Um comando de portal que falha (elemento não encontrado, verbo desconhecido, erro de JavaScript no `evaluate`) imprime `palco: erro: <motivo>` no stderr e sai com código diferente de zero, para que scripts possam parar nele.

Use `screenshot` quando precisar ver o layout visual. Use `snapshot` quando precisar entender os elementos interativos. Prefira `snapshot` + refs a `screenshot` + coordenadas — refs são mais precisas.

## Popups

Se uma página abrir um popup (por exemplo, um login OAuth), ele abre numa janela própria e aparece no `palco list` como um portal novo chamado `[Pai] #2`. Use-o pelo nome como qualquer outro portal. Popups fecham sozinhos quando o site termina de usá-los.
