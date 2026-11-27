---
name: palco-manager
description: Cria e conecta terminais de agentes no canvas do palco, gerencia roles dos agentes, coloca e salva partituras. Use quando o usuário pedir para montar um time, delegar trabalho em paralelo, subir agentes ou terminais extras para ajudar, ou invocar o Modo Maestro. Vale quando a variável PALCO_SOCKET existe (o terminal roda dentro do palco).
user-invocable: true
---

# Orquestração de time no palco

Você está rodando dentro do palco, um espaço de desenvolvimento em canvas que liga agentes de IA, terminais, notas e portais de navegador.
O CLI `palco` já vem instalado e está no PATH. Se `palco` não for encontrado, use `"$PALCO_CLI"`; essa variável sempre aponta para o executável completo.

Os verbos abaixo criam terminais de agentes no canvas, atribuem roles e ligam uns aos outros. Recrutas são conectados automaticamente ao seu terminal, então, quando um recruta existe, você pode usar `palco ask "Nome" "..."` (da skill base `palco`) para delegar trabalho e `palco check "Nome"` para ler a saída dele.

## Reaproveite antes de recrutar

**Antes de chamar `palco recruit`, rode sempre `palco list` primeiro.** Se um colega conectado já tem um role adequado, delegue a ele com `palco ask "Nome" "..."` (da skill base `palco`) — NÃO suba um recruta novo para o mesmo role. Recrutas custam ao usuário um terminal de verdade e uma sessão de modelo de verdade; recriar um que você já tem é o erro mais comum neste fluxo.

Só recrute quando:
- `palco list` não mostra ninguém cujo role cubra a tarefa, E
- o trabalho realmente precisa de uma persona nova (por exemplo, uma voz só de revisão quando o colega existente é o implementador).

Se o role de um recruta existente é *quase certo mas errado*, prefira `palco role edit` a recrutar um duplicado.

## Quando usar

- O usuário pediu explicitamente para montar um time ou delegar a vários agentes.
- O trabalho se divide bem em roles paralelos (implementador + revisor, frontend + backend, batedor + construtor) E `palco list` confirma que esses roles ainda não estão no time.
- Você precisa de um colega com um role focado e nenhum colega existente tem esse role.

Não use para perguntas avulsas — `palco ask` a um colega existente sai mais barato do que subir um novo.

## Comandos

### `palco recruit "Nome" [--preset "Claude Code"] [--role "Revisor"] [--floor "Experimento"] [--space "Clientes"] [--workspace "Frontend"] [--band "Esquadrão"] [--command "claude --resume"] [--dir "/caminho/do/projeto"] [--account "Trabalho"] [--icon I] [--color C]`

Cria um terminal novo no canvas, dá o nome e o conecta automaticamente a você. Quando você está numa banda, um recruta no seu andar entra nessa banda em vez de ganhar uma corda: a banda é a conexão dele com você e com todos nela. O `ask` espera o agente ficar pronto; não precisa inserir `sleep` depois de recrutar.

**Pré-condição:** rode `palco list` primeiro. Se um colega conectado já cobre esse role, use `palco ask` em vez disso — não recrute um duplicado.

- **Nome** (posicional, **fortemente recomendado**) — escolha um codinome curto para cada colega. O role já diz o que o recruta faz; o nome é a identidade dele. **Invente o nome você mesmo** — não tire de uma lista fixa e não reutilize nomes entre times. O codinome pode sugerir o jeito do recruta (por exemplo, para um revisor de segurança, algo vigilante; para um designer de UI, algo visual; para um especialista em build, algo industrial), mas NÃO deve repetir o role. Varie as escolhas a cada sessão para que dois times montados pelo usuário não fiquem iguais. Evite usar o nome do role (por exemplo, não recrute "Desenvolvedor Frontend" como `"Desenvolvedor Frontend"`). O canvas acrescenta `(2)`, `(3)`, ... se houver colisão com um terminal existente.
- **--preset** — um dos presets de início rápido do usuário. Rode `palco preset list` para ver o que existe antes de passar essa flag. **Se omitido, o padrão é uma cópia de você** — o mesmo tipo de agente que o usuário escolheu para você, na mesma conta.
- **--role** — nome de um role existente. O recruta é iniciado com o prompt do role como contexto inicial. Rode `palco role list` para ver os roles disponíveis, ou `palco role create` para adicionar um antes de recrutar. Opcional: omita quando só precisa de um colega comum e vai dar o contexto via `palco ask`.
- **--floor**: coloca o recruta em outro andar deste workspace (rode `palco floor list`, da skill palco-workspace, para ver os andares; `--floor "Ground"` aponta para o térreo). Quando `--dir` é omitido, um andar com isolamento git usa a própria worktree, então o trabalho do recruta não mexe no checkout do térreo. Omita `--floor` para recrutar no seu próprio andar. A corda continua ligando o recruta a você entre andares; `ask`, `check` e `dismiss` funcionam igual.
- **--workspace**: coloca o recruta em outro workspace (no térreo dele, ou em `--floor` lá; rode `palco workspace list`, da skill palco-workspace, para ver os workspaces). O recruta começa na pasta daquele workspace, porque é o agente daquele projeto. Você o endereça como `Nome @ Workspace`, exatamente como `palco list` imprime.
- **--space**: põe o recruta num workspace de outro espaço da barra (`palco space list` mostra os espaços e os workspaces de cada um). Se o espaço tem um workspace só, é nele; com vários, informe também `--workspace`, que precisa ser daquele espaço. O endereço continua `Nome @ Workspace`. O palco não tem computadores remotos: todo espaço é deste computador.
- **--band**: põe o recruta numa banda em que você está ou à qual está conectado, no andar onde ele cai, inclusive em outro workspace com `--workspace` (veja `palco band` abaixo). Ele passa a alcançar tudo a que a banda está conectada. Sem a flag, um recruta no seu andar entra na sua própria banda quando você está numa.
- **--icon**, **--color**: dão ao recruta um visual próprio em vez do visual do preset, escolhido para combinar com o codinome ou o trabalho. `palco arrange --help` lista as opções. Opcional.
- **--command** — substitui o comando do shell. Quase nunca é necessário; use o preset.
- **--dir**: inicia o recruta nesta pasta em vez de herdar a sua. Combinado com `--floor`, a pasta explícita vence o checkout padrão do andar. Omita para manter o comportamento herdado.
- **--account**: roda o recruta numa das contas do usuário para o CLI dele (Claude Code ou Codex), para que vários agentes rodem lado a lado em assinaturas diferentes. `palco preset list` imprime os nomes das contas depois de cada preset que as tem; `"Default"` é o login já existente do CLI. Vence a conta fixada pelo preset. Omita para usar a conta do preset, ou a sua quando o recruta é uma cópia de você (sem `--preset`, sem `--command`). `palco list` mostra em que conta cada colega roda.

Exemplos:

```
palco recruit "<seu-codinome>" --role "Revisor de Código"
palco recruit "<seu-codinome>" --preset "Codex" --role "Escritor de Testes"
palco recruit "<seu-codinome>"                  # colega comum, cópia de você
palco recruit "<seu-codinome>" --floor "Experimento" --role "Prototipador"
palco recruit "<seu-codinome>" --workspace "Frontend" --role "Revisor"
palco recruit "<seu-codinome>" --space "Clientes" --workspace "Loja"
palco recruit "<seu-codinome>" --dir "/caminho/de/outro/projeto"
palco recruit "<seu-codinome>" --preset "Claude Code" --account "Trabalho"
```

**Fluxo de experimento isolado:** quando o usuário quer trabalho arriscado ou experimental fora do checkout principal, crie primeiro um andar com isolamento git (`palco floor create "Experimento" --branch feat/ideia`, da skill palco-workspace) e depois recrute nele com `--floor "Experimento"`. O recruta trabalha no checkout do andar (uma worktree git), na própria branch, enquanto você e o usuário ficam no térreo. Quando o trabalho estiver pronto e commitado, `palco floor land "Experimento"` (também da skill palco-workspace, a partir do térreo) traz a branch de volta.

**Status do andar:** quando passar uma tarefa a um recruta num andar, peça que ele mantenha `palco floor status` atualizado (início, marcos, `--state blocked` quando precisar do usuário, `--state review` quando estiver pronto) e termine todo prompt de tarefa com a linha de ask back (`palco ask "Seu Nome" "<resultado>"`, da skill base `palco`), para que o recruta avise quando terminar em vez de esperar ser checado. `palco floor list` mostra o status de cada andar, então leia-o para ver como o trabalho está em vez de checar cada recruta. Publique um resumo de uma linha para o usuário no térreo com `palco floor status "2 de 3 andares em revisão" --floor "Ground"`.

**Nomes com ` @ `:** `Nome @ Workspace` sempre significa um nó de outro workspace. Se um nó daqui tem ` @ ` no próprio nome, cite-o como `local:Nome` (por exemplo `palco dismiss "local:Ana @ Casa"`). Vale em qualquer comando que cite um nó: `ask`, `check`, `dismiss`, `band`, `connect`, `arrange`, `note`, `portal`, `routine`, `role assign` e `partitura create`.

### `palco recruit "Nome Novo" --preset "Codex" --replace "Nome Antigo"`

Troca qual agente roda num colega existente, **no lugar**. O nó do terminal sobrevive, então as conexões dele (notas, portais, cordas com colegas), a posição no canvas e as rotinas que apontam para ele são preservadas; só o processo reinicia com o agente novo. Quando o usuário pedir para trocar o agente de um colega (por exemplo, Claude por Codex), use sempre isto em vez de `dismiss` + `recruit`: o dismiss apaga o nó, e uma nota ou portal ligado só àquele recruta fica inalcançável pelo CLI.

- `--preset` ou `--command` é obrigatório para subir outro agente. Prefira `--preset`.
- `--account` move o colega para outra conta (nomes do `palco preset list`; `"Default"` volta ao login existente do CLI). Sozinho, mantém o agente, o role e o visual e muda só a conta; com `--preset`, vence a conta que o preset fixa. O processo reinicia do zero nos dois casos.
- O nome posicional renomeia o colega; omita para manter o nome atual.
- `--role` troca o role na mesma operação; omita para manter o role atual.
- `--dir` muda a pasta de trabalho; `--floor` não é aceito porque o nó fica onde está.
- O histórico da conversa não sobrevive ao reinício; passe o contexto ao agente novo com `palco ask` depois.

```
palco recruit "Codex" --preset "Codex" --replace "Claude"
palco recruit --preset "Shell" --replace "Batedor"        # mantém o nome "Batedor"
palco recruit --replace "Batedor" --account "Trabalho"   # mesmo agente, na conta Trabalho
```

### `palco band create "Nome" ["Agente" ...] [--without-me] [--floor "Experimento"] [--workspace "Frontend"] [--icon I] [--color C]`

Junta o seu time numa banda: um nó no canvas que reúne os agentes como time, em que cada membro alcança todos os outros e um membro que entra depois é ligado a tudo a que a banda está conectada.

**Só crie uma banda quando o usuário pedir.** Recrutas são mais fáceis de acompanhar como terminais separados no canvas, então deixe-os soltos por padrão; recrutar um time, ou ser pedido para montar um, não é pedido de banda.

- Sem nomes de agentes, junta **você e todos conectados a você no seu andar** que ainda não estão em outra banda. Normalmente é o que o usuário quer.
- Dê nomes de agentes para escolher quem entra, por exemplo para dividir o time em várias bandas.
- **--without-me** deixa você fora da banda. Use quando coordenar várias bandas e ficar de fora, ligado a cada uma, em vez de entrar numa. Um terminal fica numa banda por vez.
- Uma banda vive num andar. Você só junta agentes aos quais está conectado.
- **--floor**, **--workspace**: forma a banda com o time que você recrutou em outro andar ou outro workspace, lá; junta os agentes que você alcança naquele andar, e fora do seu próprio andar você coordena a banda de fora. Uma banda em outro workspace se chama `"Banda @ Workspace"`, o nome que todo comando de banda aceita.
- **--icon**, **--color**: dão à banda um visual que combine com o nome; `palco arrange --help` lista as opções. Opcional.

Quando o usuário pedir o time numa banda: recrute os colegas primeiro, depois `palco band create "Nome"` junta você e todos eles. Quem você recrutar no seu andar depois disso entra na sua banda sozinho. Uma banda precisa de pelo menos dois agentes para ser criada.

```
palco band create "Esquadrão Frontend"                          # você + todos conectados a você
palco band create "Revisores" "Gavião" "Lince" --without-me     # banda que você coordena de fora
```

### `palco band add "Banda" "Agente"` / `palco band remove "Banda" "Agente"` / `palco band dissolve "Banda"`

Mudam uma banda em que você está ou à qual está conectado. `add` traz um agente conectado do andar da banda (ele passa a alcançar tudo a que a banda está conectada). `remove` tira um agente (você pode tirar a si mesmo), e `dissolve` desfaz a banda. Nenhum deles para ninguém: os membros voltam ao canvas, rodando, com suas conexões. Uma banda que fica com um membro se desfaz sozinha. Para parar um agente, use `palco dismiss`.

`palco list` mostra as suas bandas, com os membros abaixo de cada uma, e marca aquela em que você está.

### `palco dismiss "Nome"`

Para o processo do recruta e remove o terminal dele do canvas. Você só pode dispensar agentes aos quais está conectado agora.

**Cuidado:** o dismiss apaga o nó, e qualquer nota ou portal ligado só àquele recruta fica órfão. Nada no CLI consegue religá-lo depois; só o usuário, puxando uma corda no app. Para trocar o agente de um colega, use `palco recruit --replace`.

```
palco dismiss "Revisor"
```

### `palco connect "De" "Para"`

Liga duas coisas. Cada lado pode ser um recruta (nome do agente), uma banda, uma nota, um fichário ou um portal; uma corda até uma banda alcança todos os membros. Sem isso, recrutas só conseguem falar de volta com você. As duas pontas precisam estar dentro da sua árvore de time: você mesmo, um recruta direto, ou qualquer nota/portal ligado a você ou a um recruta direto (exatamente o que `palco list` mostra). Cordas de nota e de portal vivem num andar só, então esses pares precisam estar no mesmo andar; só conexões entre agentes atravessam andares. Um portal só se liga a um agente (para que o agente o controle via `palco portal ...`); notas não se ligam a portais.

```
palco connect "Revisor" "Testador"          # agente ↔ agente — podem usar `palco ask` um com o outro
palco connect "spec-design" "Revisor"      # nota ↔ agente — compartilha uma nota de contexto com um recruta
palco connect "spec-design" "rascunho"     # nota ↔ nota — encadeia notas para uma ler a outra
palco connect "Testador" "Portal Staging"  # agente ↔ portal — deixa o agente controlar esse portal
```

Ligar dois recrutas não basta — eles não vão saber usar a conexão nova se o role não disser. Ponha a colaboração no role de cada um: nomeie o outro recruta e instrua-o a usar `palco ask "Nome do Colega" "..."` nos pontos certos (por exemplo, "Quando terminar um rascunho, rode `palco ask \"Revisor\" \"por favor revise\"` e incorpore o retorno"). Para notas compartilhadas, cite o nome da nota no role do recruta para ele saber que deve lê-la. Para um portal conectado, nomeie-o e diga ao recruta para controlá-lo com `palco portal ...` (por exemplo, "Use o `Portal Staging` para conferir se a página renderiza — `palco portal snapshot \"Portal Staging\"`").

### `palco partitura list / insert / create / update / delete`

Uma partitura é um layout que o usuário salvou: agentes com roles e comandos, bandas, notas e as cordas entre eles. Quando uma servir para o trabalho, coloque-a em vez de recrutar o mesmo time à mão. `insert "Nome" [--floor F] [--workspace W]` a coloca num espaço livre e conecta você a ela (só aos Maestros dela, quando houver); a resposta diz os nomes dos agentes para o `ask`. `create "Nome" ["Agente" ...]` salva você e o seu time no seu andar quando o usuário pedir; `--note-text off` salva sem o texto das notas e `--commands off` salva sem os comandos (cada terminal vira um shell). `update` e `delete` só quando o usuário pedir. `palco partitura --help` mostra o resto.

### `palco preset list`

Lista os presets de agente que o usuário configurou (por exemplo `Claude Code`, `Codex`, `Shell`, mais presets próprios). Rode antes de `palco recruit ... --preset "..."` para passar um nome que existe. Um preset cujo CLI tem mais de uma conta lista os nomes das contas na linha dele (`accounts: "Default", "Trabalho"`): esses são os valores de `--account`. Um preset fixado numa conta diz qual (`; starts on "Trabalho"`).

### `palco preset show / create / set / delete`

Gerencie os presets do usuário quando ele pedir: os agentes do início rápido dele e os valores que `--preset` aceita.

```
palco preset show "Claude Code"
palco preset create "Claude Opus" --command "claude --model opus" --account "Trabalho"
palco preset set "Claude Opus" --maestro on --quick-start off
palco preset set "Claude Opus" --chat on
palco preset set "Claude Opus" --name "Opus" --command "claude --model opus --verbose"
palco preset delete "Opus"
```

- `--command` é uma linha só, executada como digitada num terminal novo. Sem ela, o preset é um shell comum.
- `--account` aceita um nome de conta do CLI daquele comando, como `palco preset list` imprime, ou `"Default"`.
- `--maestro`, `--chat` (começar no modo de chat) e `--quick-start` aceitam `on` ou `off`. Opções omitidas ficam como estão.
- `create` e `set` respondem com o preset como ficou, então não precisa de `show` depois.
- Você não escolhe a cor nem o ícone: o usuário muda os dois nas configurações.
- Apagar um preset não muda nada nos terminais já criados a partir dele.

**Mantenha a retomada de sessão funcionando.** O palco retoma a conversa de um agente depois de reiniciar pelo nome do programa que o comando inicia. Quando o usuário quiser um wrapper (flags fixas, variáveis de ambiente, configuração de outro shell), escreva no comando de forma que ele ainda inicie o agente diretamente:

- as flags do próprio agente depois dele: `claude --dangerously-skip-permissions --model opus`
- variáveis de ambiente na frente: `ANTHROPIC_BASE_URL=http://localhost:4000 claude`
- um caminho completo: `/usr/local/bin/codex --yolo`
- um wrapper de shell, para carregar a configuração daquele shell: `fish -c "claude --model opus"`

Um script pessoal (`cc`) ou um executor na frente (`op run -- claude`, `npx …`) esconde o agente: os terminais dele começam do zero em vez de retomar. Prefira incorporar o que o script faz ao comando, como acima.

### `palco role list`

Lista os roles visíveis do seu workspace, agrupados em roles do "Workspace atual" (restritos ao workspace em que você está) e "Globais" (visíveis em todo lugar).

### `palco role create "Nome" "Prompt" [--scope current|global]`

Adiciona um role novo que o usuário (e você) podem atribuir a recrutas. O prompt é a instrução de sistema que o recruta vê como `<your_assigned_role>`. Seja específico — nome + prompt não podem deixar dúvida sobre o escopo do recruta.

Roles novos ficam **restritos ao workspace atual por padrão**, porque a maioria cita o contexto de um projeto. Julgue: se o role é reaproveitável entre projetos (por exemplo, um "Revisor de Código" genérico), passe `--scope global`; se ele cita arquivos, branches ou convenções deste projeto, mantenha o padrão.

Ponha no prompt como descobrir a colaboração:

- **Diga ao recruta para rodar `palco list` antes de perguntar qualquer coisa a alguém.** Recrutas não veem o grafo do time sozinhos — sem esse empurrão, trabalham isolados ou inventam colegas que não existem. Uma linha como "Rode `palco list` para ver seus colegas conectados e as notas compartilhadas antes de delegar ou perguntar." basta.
- Se o recruta tem um colega *específico* com quem falar, nomeie esse colega: por exemplo, "Quando terminar um rascunho, rode `palco ask \"Revisor\" \"por favor revise\"` e incorpore o retorno." Instruções específicas vencem a dica genérica do `list` quando o padrão de colaboração é fixo.
- Se uma nota compartilhada faz parte do fluxo, nomeie-a: por exemplo, "Leia `spec-design` antes de começar e escreva o progresso em `rascunho`."
- Se o recruta tem um portal (você ligou um a ele, ou ele criou o próprio), nomeie-o e aponte os comandos `palco portal`: por exemplo, "Você tem o `Portal Staging` — controle-o com `palco portal snapshot/click/fill` para conferir a UI."

```
palco role create "Especialista em API" "Você cuida da API de pagamentos deste repositório. Mantenha os endpoints conforme docs/api-conventions.md. Rode `palco list` para ver seus colegas e notas compartilhadas."
palco role create "Revisor de Código" "Revise código quanto a correção, estilo e segurança. Nunca edite arquivos — responda só com achados. Rode `palco list` para ver quem mais está no time e as notas que você deve ler." --scope global
```

### `palco role show "Nome"`

Imprime o prompt completo de um role. `palco role list` mostra só uma prévia cortada.

### `palco role edit "Nome" "texto antigo" "texto novo" [--scope current|global]`

Substitui um trecho dentro do prompt de um role. `--scope` muda o escopo — `current` restringe ao workspace em que você está, `global` deixa visível em todo lugar — e também funciona sozinho quando você só quer mudar o escopo:

```
palco role edit "Revisor de Código" --scope global
```

Você só pode restringir roles ao seu próprio workspace, nunca a outro.

### `palco role write "Nome" "prompt novo inteiro"`

Substitui o prompt de um role por inteiro.

### `palco role assign "Nome do Recruta" "Nome do Role"`  (ou `--none` para limpar)

Muda o role de um recruta existente *sem* dispensá-lo. O nome, a posição no canvas e todas as conexões (notas, cordas com colegas) do recruta são preservados; só o processo do agente reinicia para pegar o role novo. Use em vez de `dismiss` + `recruit` quando só precisar trocar o role de um colega. Para trocar o programa do agente (por exemplo, Claude por Codex), use `palco recruit --replace` do mesmo jeito.

```
palco role assign "Bigorna" "Gerente de Produto"     # troca o role
palco role assign "Bigorna" --none                   # limpa o role, o recruta volta a ser comum
```

O histórico da conversa se perde no reinício, mas as conexões e a composição do grupo permanecem.

### `palco role delete "Nome" [--force]`

Apaga um role. **Destrutivo: só quando o usuário pedir.** É recusado enquanto terminais, presets ou partituras usam o role; `--force` tira o role de quem usa (em qualquer workspace) e apaga. Nenhum processo reinicia: a mudança vale no próximo início.

```
palco role delete "Revisor de Código"
```

### Nomes iguais no `connect`

Quando dois tipos têm o mesmo nome, uma flag logo depois do nome diz qual é: `--agent`, `--band`, `--note`, `--fichario` ou `--portal`.

```
palco connect "Ensaio" "Repertório" --note
```

## Fluxo

1. **Faça o inventário primeiro** — `palco list`. Se um colega conectado já tem um role adequado, pule direto para o passo 6 e delegue a ele. Não recrute uma segunda cópia de quem você já tem.
2. **Planeje as lacunas** — só depois do passo 1, decida quais roles realmente faltam.
3. **Defina os roles** — `palco role list` para ver o que já existe, `palco role create` para preencher as lacunas.
4. **Recrute** cada colega que falta com um codinome próprio e `--role`, para que cada um comece com a mentalidade certa e apareça como um personagem próprio no canvas. Não use o nome do role como nome do recruta.
5. **Opcional** — `palco connect` entre recrutas quando eles precisarem colaborar sem você no meio.
6. **Delegue** com `palco ask "Nome" "tarefa..."` (da skill base `palco`), terminando cada tarefa com a linha de ask back para que o colega reporte inteiro a você quando terminar. Para disparar vários colegas de uma vez, use `palco ask --batch '{"Nome A": "tarefa...", "Nome B": "tarefa..."}'` — ele manda os prompts em paralelo e retorna quando todos terminam, então trabalho independente roda ao mesmo tempo em vez de um depois do outro.

Use `palco list` a qualquer momento para ver o time atual e os roles. Como Maestro, você também vê as conexões de cada colega (agentes, portais, notas) aninhadas sob ele, então sabe exatamente a que um recruta está ligado antes de um `--replace` ou de religar. Essa árvore também é o seu alcance, em qualquer andar do seu workspace: as notas e portais de um colega resolvem pelo nome para você, então você pode `note read` a nota de um recruta ou controlar o portal dele diretamente em vez de repassar pelo `ask`.
