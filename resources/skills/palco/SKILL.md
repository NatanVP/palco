---
name: palco
description: Envia mensagens a agentes conectados no canvas do palco e recebe as respostas; lê e escreve notas conectadas. Use quando a intenção do usuário for colaborar com outro agente no canvas do palco: "pede pro [nome]...", "fala pro [nome]...", "vê como o [nome] está", "cria/atualiza uma nota". Vale quando a variável PALCO_SOCKET existe (o terminal roda dentro do palco).
user-invocable: true
---

# Comunicação entre agentes no palco

Você está rodando dentro do palco, um espaço de desenvolvimento em canvas que liga agentes de IA, terminais, notas e portais de navegador.
O CLI `palco` já vem instalado e está no PATH. Se `palco` não for encontrado, use `"$PALCO_CLI"`; essa variável sempre aponta para o executável completo.

Agentes conectados trocam prompts e respostas pelo CLI `palco`.
Notas conectadas podem ser lidas e escritas pelo CLI `palco`.

## Comandos

- `palco list` — lista agentes, notas e portais conectados
- `palco ask "Nome do Agente" "seu prompt"` — manda um prompt a um agente conectado e recebe a resposta
- `palco ask --batch '{"Agente A": "prompt", "Agente B": "prompt"}'` — pergunta a vários agentes conectados ao mesmo tempo, em paralelo
- `palco ask "Nome do Agente" --raw "2\n"` — manda entrada crua e devolve a tela resultante do terminal; use para menus interativos ou para mandar comandos de shell diretamente. Escapes: `\n` Enter, `\t` Tab, `\e` ESC, `\xNN` byte (`\x03` Ctrl-C). Teclas especiais são sequências ESC, por exemplo `\e[A` seta para cima, `\e[Z` Shift-Tab.
- `palco check "Nome do Agente"` — lê a saída atual do terminal do agente, sob demanda
- `palco notify "mensagem"`: manda uma notificação do sistema ao usuário. Só quando ele pediu para ser avisado; nos outros casos, assuma que ele está acompanhando no palco.
- `palco note create ["conteúdo"] [--name "Nome"] [--stack ["Fichário"]] [--color C]` — cria uma nota nova no canvas, ligada a este terminal; `--name` fixa um nome estável que não muda com o conteúdo. A resposta imprime o nome exato atribuído
- `palco note import "arquivo.md" --copy` — cria uma nota com uma cópia do texto de um arquivo .md ou .txt (até 256 KB). A nota não fica ligada ao arquivo: editar uma não muda o outro
- `palco note read "Nome da Nota"` — lê a nota inteira, com números de linha
- `palco note read "Nome da Nota" 10 20` — lê 20 linhas a partir da linha 10
- `palco note write "Nome da Nota" "conteúdo"` — substitui todo o conteúdo da nota
- `palco note edit "Nome da Nota" "texto antigo" "texto novo"` — substitui um trecho dentro da nota
- `palco note stack "Nome da Nota" ["Fichário"]` — arquiva (ou move) uma nota existente num fichário; `palco note unstack "Nome da Nota"` a liberta
- `palco note delete "Nome da Nota"` — remove do canvas uma nota conectada. **Destrutivo. Só rode quando o usuário pedir explicitamente para apagar a nota.** Nunca apague uma nota por iniciativa própria, nem para arrumar.
- `palco note delete --stack "Fichário"` — apaga um fichário e as notas dele
- `palco arrange "Nome" [--name N] [--icon I] [--color C]`: renomeia você, uma nota ou (sendo o Maestro) um colega ou banda, ou dá a eles um ícone ou cor. Estilize o que você cria; mude o visual do que já existe só quando o usuário pedir. `palco arrange` sozinho mostra o visual atual; `--help` mostra as opções. Quando um agente, uma nota, uma banda ou um fichário têm o mesmo nome, ponha `--agent`, `--note`, `--band` ou `--fichario` logo depois do nome.

Se algum comando do palco falhar (erro de conexão ou de socket), rode `palco debug` PRIMEIRO — ele mostra a causa exata (socket velho, variável de ambiente faltando, token inválido) antes de você sair chutando.
Rode sempre `palco list` primeiro para pegar os nomes exatos dos agentes e das notas. Um agente ligado a partir de outro workspace aparece como `Nome @ Workspace`; essa string inteira é o nome dele, use exatamente como impressa. Já um nome **deste** workspace que contém ` @ ` vai com o prefixo `local:` (por exemplo `palco ask "local:Ana @ Casa" "..."`), senão o palco o procura em outro workspace.
A resposta do `ask` volta assim que o outro agente termina. Ajuste o timeout da ferramenta Bash ao tempo estimado, normalmente de 1 min (fácil) a 10 min (a maioria das tarefas). Um `ask` simples serve para perguntas rápidas. Sempre que você passar uma tarefa (implementar, revisar, investigar, planejar, qualquer coisa num andar), use o retorno por ask (ask back) descrito abaixo: o `ask` devolve só a última tela do agente, e uma tarefa longa dura mais que o seu timeout, enquanto um ask back chega a você inteiro mesmo depois que o seu `ask` estourou o tempo.
Se o timeout acabar antes de o agente responder, NÃO reenvie o prompt. Rode `palco check "Nome do Agente"` para ver o progresso e espere de novo com um timeout adequado. Nunca interrompa um agente que ainda está trabalhando, e não edite arquivos que o outro agente está modificando — espere ele terminar.
Um agente num andar ou workspace que não foi aberto desde que o palco iniciou é acordado pelo `ask`; se a resposta disser que ele ainda está iniciando, pergunte de novo.
O retorno por ask (ask back): diga ao agente para reportar com `palco ask "Seu Nome" "<resultado>"` ao terminar (o seu nome aparece em `You:` no `palco list`; quando o agente está em outro workspace, use o endereço `Nome @ Workspace` mostrado logo abaixo de `You:`). Assim a mensagem dele resolve o seu `ask` pendente automaticamente e chega inteira como um novo prompt.
Use `check` para ler o que um agente está mostrando sem mandar prompt — útil para ver se um pedido anterior terminou ou o estado atual. Cuidado para não confundir texto ainda não enviado na caixa de entrada da TUI dele com instruções para você.

## Perguntar a vários agentes de uma vez

`palco ask --batch '{"Agente A": "prompt para A", "Agente B": "prompt para B"}'` manda um prompt a vários agentes conectados **em paralelo** e só retorna quando todos terminam. A entrada é um mapa JSON de nome do agente → prompt; os alvos precisam ser distintos (um objeto JSON não repete chave). O resultado é um array JSON de objetos `{name, output}` (mais `{name, error}` para agente que não pôde ser alcançado) — associe cada resposta pelo `name`. Ajuste o timeout da ferramenta Bash para a tarefa **mais lenta** do lote, porque o comando espera todas.

Rode `palco help` para ver todos os comandos, e `palco <comando> --help` (por exemplo `palco recruit --help`) para as flags e detalhes de um comando. Nunca chute uma flag. Se o usuário estiver com problema de conexão ou configuração, rode `palco debug` para diagnosticar.

## Notas conectadas

Use `palco note create` para criar uma nota nova no canvas — ela aparece à esquerda do seu terminal e já fica conectada. Dá para passar um conteúdo inicial. Passe `--name "Minha Nota"` para dar um nome estável; a resposta sempre imprime o nome exato atribuído, então use esse nome nos comandos seguintes.
`--stack "Nome"` e `note stack` arquivam notas num fichário (uma pilha de páginas), criando-o se precisar — `palco list` mostra o agrupamento.
Use `palco note read` para ler, `palco note write` para substituir tudo e `palco note edit` para mudar uma parte.
Quando a nota já tem conteúdo, prefira `edit` a `write` para não perder texto.
Notas marcadas `locked: true` no `palco list` são só leitura. Você ainda pode lê-las, mas `write` e `edit` falham até o usuário destravar a nota no palco.
As mudanças aparecem no canvas do palco em tempo real. Notas aceitam markdown.
Notas podem ser encadeadas. Quando uma nota ligada ao seu terminal também está ligada a outras notas, você pode ler e escrever todas as notas da cadeia. Use `palco list` para ver a árvore completa — notas encadeadas aparecem indentadas sob a nota-mãe.

**Importante:** por padrão, o nome de uma nota vem da primeira linha do texto. Quando você escreve ou edita uma nota e muda a primeira linha, a nota pode ser renomeada automaticamente — a resposta do comando informa o novo nome quando isso acontece. Notas criadas com `--name`, ou renomeadas pelo usuário, mantêm o nome qualquer que seja o conteúdo. Prefira `palco note create --name "..."` quando for usar a nota de novo depois.
