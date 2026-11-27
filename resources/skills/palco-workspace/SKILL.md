---
name: palco-workspace
description: Cria workspaces e andares do palco pela linha de comando, opcionalmente copiando o layout de um workspace existente como ponto de partida, faz o land ou apaga um andar quando o trabalho acaba, publica o status de um andar e organiza workspaces em espaços. Use quando o usuário pedir para provisionar ou montar um workspace novo, um ambiente de projeto ou um andar isolado, para fazer land, trazer de volta ou remover um andar, ou para arrumar os espaços da barra lateral, e sempre que estiver trabalhando numa tarefa num andar, para manter o status dele atualizado. Vale quando a variável PALCO_SOCKET existe (o terminal roda dentro do palco).
user-invocable: true
---

# Provisionamento de workspaces no palco

Você está rodando dentro do palco, um espaço de desenvolvimento em canvas que liga agentes de IA, terminais, notas e portais de navegador.
O CLI `palco` já vem instalado e está no PATH. Se `palco` não for encontrado, use `"$PALCO_CLI"`; essa variável sempre aponta para o executável completo.

Workspaces são canvas independentes, cada um com a própria pasta de projeto — isolamento *entre* projetos. Andares (floors) são níveis dentro de um workspace, opcionalmente apoiados numa worktree git do repositório — isolamento *dentro* de um projeto. Use estes comandos para provisionar qualquer um dos dois sem sair do terminal, por exemplo para deixar pronto para trabalhar um projeto que o usuário acabou de criar.

Estes comandos exigem o **Modo Maestro** no seu terminal, exceto `palco floor status`, que qualquer agente usa para o andar em que está. Se um comando responder que este terminal não é o Maestro, o usuário precisa ligar o Maestro no seu terminal pelo canvas para liberar.

## Status do andar (qualquer agente)

Quando você trabalha numa tarefa num andar, mantenha o status daquele andar atualizado com `palco floor status`. É a linha que o usuário bate o olho na barra lateral para ver como as coisas estão, então publique quando começar, num marco de verdade, quando precisar do usuário (`--state blocked`) e quando o trabalho estiver pronto (`--state review`). Ir para `blocked`, `review` ou `done` também manda uma notificação ao usuário, então use esses estados só quando forem verdade. Uma linha curta em palavras simples; não publique cada passo. O comando completo está em Comandos abaixo.

## Escopo e segurança

- Criar e arquivar são operações aditivas e reversíveis. Renomear também é permitido — é só um rótulo, nada por baixo muda. `workspace delete` encerra terminais e remove o workspace do aplicativo: use só quando o usuário pedir explicitamente. A pasta do projeto nunca é apagada.
- Andares são a exceção: `palco floor land` e `palco floor delete` mudam o projeto do usuário (um merge na branch dele, uma worktree e uma branch apagadas). **Rode só quando o usuário pedir, ou depois de confirmar com ele** — um andar em `review` está pronto para o usuário decidir, não é sinal para você fazer o land sozinho.
- Criar é sempre silencioso: nada muda na tela do usuário. O workspace ou andar novo simplesmente aparece na barra lateral, pronto para quando o usuário abrir.
- A pasta de destino precisa existir — crie a pasta (e rode `git init` se quiser) antes de `workspace create`.

## Comandos

### `palco workspace create "Nome" --dir CAMINHO [--from "Workspace de Origem"] [--group "Grupo"] [--space "Espaço"]`

Cria um workspace novo com raiz em CAMINHO.

- `--from "Workspace de Origem"` — copia o layout de um workspace existente como ponto de partida: o layout inteiro do canvas (terminais, notas, andares, conexões) é copiado, e todo caminho dentro da pasta da origem é redirecionado para CAMINHO. Os terminais começam do zero — sem histórico, nada rodando — e sobem quando o usuário abre o workspace pela primeira vez. Caminhos que apontam para fora da pasta da origem ficam como estão.
- `--group "Grupo"` — arquiva o workspace num grupo da barra lateral, criando o grupo se ainda não existir.
- `--space "Espaço"`: a barra lateral tem espaços (páginas, cada uma com os próprios grupos). Grupos são procurados em todos os espaços; quando um nome bate em mais de um, o comando pede para você acrescentar `--space`. Com `--space`, os nomes são procurados só naquele espaço, e o que faltar é criado lá. Sem grupo, o workspace cai no espaço que o usuário está vendo, ou em `--space`.
- Sem `--from`, o workspace começa com o canvas vazio.

O "modelo" do usuário é só um workspace normal — sugira que ele mantenha um arrumado do jeito que gosta e copie o layout pelo nome:

```
palco workspace create "Análise de Churn Acme" --dir ~/Trabalho/acme-churn --from "Modelo de Projeto de Dados" --group "Projetos de Dados"
palco workspace create "Relatório T3" --dir ~/Trabalho/t3 --group "Projetos de Dados"
```

### `palco workspace move "Nome" --group "Grupo" | --root | --space "Espaço"`

Rearquiva um workspace existente na barra lateral. Mesmas regras de destino do `create`: grupos são criados quando faltam, e `--root` sozinho tira o workspace de qualquer grupo, ficando no espaço dele. Um grupo em outro espaço leva o workspace para aquele espaço. `--space` sozinho (ou com `--root`) move o workspace para a raiz daquele espaço; com `--group`, restringe os nomes àquele espaço. Isso só reorganiza a barra lateral: o workspace em si não muda.

```
palco workspace move "Análise de Churn Acme" --group "Arquivo 2026"
palco workspace move "Rascunho" --root
palco workspace move "Análise de Churn Acme" --space "Clientes"
```

### `palco workspace rename "Nome Atual" "Nome Novo"`

Renomeia um workspace existente na barra lateral. Só o rótulo muda — o canvas, os andares e a pasta de trabalho ficam intactos. O nome novo não pode colidir com outro workspace (mudar só maiúsculas, como `"acme"` → `"Acme"`, pode). Nomes desconhecidos falham com a lista de nomes válidos.

```
palco workspace rename "Análise de Churn Acme" "Churn Acme v2"
```

### `palco workspace delete "Nome" [--force]`

Remove o workspace da barra lateral e seus elementos do canvas, encerra seus terminais e fecha seus portais, usando a mesma remoção da interface. **A pasta do projeto no disco nunca é apagada.** Exige Modo Maestro e pedido explícito do usuário.

Não permite remover o workspace do terminal chamador nem o último workspace. Sem `--force`, recusa se houver agentes em execução e lista seus nomes. Use `--force` somente quando o pedido do usuário incluir encerrar esses agentes; ele não permite remover o próprio workspace nem o último.

```
palco workspace delete "Rascunho"
palco workspace delete "Experimento" --force
```

### `palco workspace list`

Imprime a hierarquia da barra lateral exatamente como o usuário vê (workspaces da raiz, depois cada grupo), com a pasta de cada workspace e a contagem de andares, marcando aquele em que o seu terminal vive. Quando a barra lateral tem mais de um espaço, cada espaço aparece sob o próprio título, marcando o que está na tela. Grupos vazios também aparecem, então a saída serve de mapa dos destinos válidos. Rode antes de `create` ou `move` para escolher um nome livre, a origem exata do `--from` e onde o workspace deve ficar.

### Espaços: `palco space list | create | edit | move | delete`

Os espaços da barra lateral são as páginas do rodapé dela, cada uma com os próprios workspaces e grupos. Para organizar workspaces em espaços: `palco space list` para vê-los na ordem do rodapé, `palco space create "Nome" [--icon I] [--color C]` para um novo, `palco workspace move "Workspace" --space "Nome"` para pôr um workspace nele, `palco space edit "Nome" [--name "Novo"] [--icon I] [--color C | --color none]` para renomear ou mudar o visual, e `palco space move "Nome" (--to N | --left | --right)` para reordenar o rodapé (o espaço inicial fica sempre em primeiro). Esses comandos mudam o rodapé exatamente como os cliques do usuário. `palco space delete "Nome"` manda os workspaces do espaço para o espaço inicial; rode só quando o usuário pedir explicitamente, como `note delete`. Rode `palco space --help` para os ícones e cores.

```
palco space create "Clientes" --icon folder --color blue
palco workspace move "Análise de Churn Acme" --space "Clientes"
```

### `palco floor create "Nome" [--from CAMINHO] [--branch NOME] [--existing-branch] [--copy] [--no-git] [--copy-ground] [--partitura P]`

Adiciona um andar ao **seu próprio workspace**. Por padrão, o andar ganha isolamento git quando o workspace é um repositório git: uma **worktree git** do projeto na própria branch, ao lado do projeto, para que o trabalho lá não atrapalhe o térreo. Os arquivos não rastreados do térreo que não estão no `.gitignore` são copiados para ela. Dependências e arquivos ignorados (por exemplo `node_modules` e arquivos de ambiente) **não** são copiados: instale as dependências no andar antes de rodar o projeto. A worktree compartilha o histórico do projeto: a branch e os commits dela estão no projeto desde o início. Quando o workspace não aceita isolamento (não é repositório), um andar simples é criado e a resposta diz isso.

- `--branch NOME` — branch do andar (padrão: o nome do andar em slug). Falha se a branch já existe.
- `--existing-branch` — faz checkout de uma branch existente em vez de criar uma. Uma worktree não pode pegar a branch que o térreo tem em checkout; para isso use `--copy`.
- `--copy` — em vez de uma worktree, o palco faz uma cópia independente do repositório, exatamente como está agora (inclusive mudanças não commitadas e arquivos ignorados). Só funciona onde o disco oferece cópia instantânea por copy-on-write (btrfs, XFS); senão é recusado. Por ser separado, pode usar a mesma branch do térreo (`--branch main --existing-branch`), e o land traz o trabalho de volta. Use para isso, ou quando o usuário pedir isolamento total; para quase todo trabalho, a worktree é a escolha certa. Apagar um andar de cópia com commits que só existem nele é recusado (`--keep-branch` os leva para o projeto).
- `--no-git` — pula o isolamento e compartilha a pasta do térreo.
- `--from CAMINHO` — baseia o andar numa pasta diferente da do workspace, como um dos vários repositórios dentro dela (`--from back`; caminho relativo é relativo ao workspace). Tudo acima acontece então no repositório daquela pasta: a worktree vem dele, a branch é dele, e o andar faz land de volta nele. Os terminais do andar começam no checkout dele. Com `--no-git`, ou quando a pasta não é repositório, o andar trabalha direto naquela pasta.
- `--copy-ground` — começa o andar com uma cópia do layout do canvas do térreo.
- `--partitura P` — coloca uma das partituras salvas do usuário no andar novo, conectada a você (veja `palco partitura` na skill palco-manager).

```
palco floor create "Refatorar Auth" --branch refactor-auth
palco floor create "Rascunho" --no-git
palco floor create "Corrigir API de Login" --from back
```

### `palco floor create ["Nome"] --pull-request NÚMERO|URL [--copy] [--copy-ground]`

Adiciona um andar para revisar um pull request aberto do projeto: `42`, `#42` ou o link. O palco pergunta ao provedor do `origin` (`gh` ou `glab`, autenticados), traz a branch e faz checkout dela no andar. O nome padrão é `#42` e o título. Quando o provedor confirma que a branch é do próprio repositório, o andar usa essa branch e o que for enviado dela chega ao pull request; senão (um fork, ou o provedor não diz), o andar fica com uma cópia dos commits em `pr-42`, que não alcança o pull request. É recusado, com o motivo, quando o pull request não está aberto, já está num andar, mudou enquanto era buscado, não há provedor que o mostre, ou a sua branch local de mesmo nome seguiu outro caminho ou envia para outro lugar. `--branch`, `--existing-branch` e `--no-git` não se aplicam.

```
palco floor create --pull-request 42
palco floor create "Revisar Login" --pull-request https://github.com/acme/app/pull/42
```

### `palco floor create "Nome" --dir CAMINHO [--copy-ground] [--partitura P]`

Adiciona um andar que trabalha numa pasta que o usuário já tem, sem checkout novo: a worktree git dele, ou uma pasta qualquer. Caminho relativo é relativo ao workspace. Uma worktree git vira o checkout do andar, como se o palco a tivesse criado, então branch e land funcionam normalmente. Qualquer outra pasta é simplesmente onde o andar trabalha. Apagar um andar criado com `--dir` nunca apaga a pasta do usuário. Recusado para a própria pasta de um repositório (use `--from` para basear um andar nele), a raiz do disco ou a pasta home, a pasta de qualquer workspace e a pasta de outro andar. `--from`, `--branch`, `--existing-branch`, `--copy` e `--no-git` não se aplicam.

```
palco floor create "Fluxo de Checkout" --dir worktrees/checkout-flow
```

Depois de criar um andar isolado, você pode pôr gente nele sem sair do seu andar: `palco recruit "Nome" --floor "Refatorar Auth" --role "..."` (da skill palco-manager) sobe um agente lá, trabalhando dentro do checkout do andar e ainda ligado a você para `ask`/`check`.

### `palco floor land "Nome" [--into BRANCH] [--delete-branch] [--keep-floor]`

Traz a branch do andar para o projeto, como o botão Land do usuário. **Só quando o usuário pedir, ou depois de confirmar com ele.** **Rode a partir de um terminal no térreo**: um andar nunca faz land de dentro de si mesmo, e um terminal em qualquer andar é recusado. O land remove o andar depois e mantém a branch dele no projeto, pronta para revisar ou fazer merge.

- `--into BRANCH`: também faz merge da branch do andar em BRANCH (por exemplo `main`).
- `--delete-branch`: depois de um merge com `--into`, apaga a branch do andar.
- `--keep-floor`: deixa o andar no lugar depois do land.

Um land é recusado, com o motivo, quando há trabalho não commitado no andar ou no térreo, ou quando o merge daria conflito (os arquivos são citados). Nada é alterado nesse caso: commite o trabalho, ou resolva o conflito no checkout do andar, e faça o land de novo. Peça ao agente do andar para commitar o trabalho antes do land.

```
palco floor land "Refatorar Auth"
palco floor land "Refatorar Auth" --into main --delete-branch
```

### `palco floor delete "Nome" [--keep-branch] [--keep-folder] [--force]`

Remove o andar: os terminais, notas e desenhos dele, e a worktree que o palco criou para ele, a menos que `--keep-folder`. A branch do andar também é apagada do projeto, a menos que `--keep-branch`. Um andar sem git, ou criado com `--dir`, nunca tem a pasta nem a branch apagadas. Um andar sem git não faz land. **Só quando o usuário pedir, ou depois de confirmar com ele**, e **só a partir do térreo**, como o `land`. Se a worktree não puder ser removida, o andar fica intacto e o comando diz por quê; `--force` remove o andar mesmo assim.

```
palco floor delete "Rascunho"
palco floor delete "Refatorar Auth" --keep-branch
```

### `palco floor list`

Lista o térreo e todos os andares do seu workspace com branch, caminho da worktree ou pasta, a pasta de base quando não é a do workspace, contagem de nós e status, marcando `unloaded` o andar sem nada rodando (um `ask` para um agente de lá o acorda).

### `palco floor set-dir "Nome" CAMINHO`

Muda a pasta de um andar sem checkout próprio (um andar simples, ou criado com `--dir` numa pasta comum). A pasta nova é aceita pelas mesmas regras do `--dir`. Terminais já abertos ficam onde estão; os novos, as árvores de arquivos e os recrutas começam lá. Um andar com checkout próprio é recusado: crie um andar novo.

```
palco floor set-dir "Fluxo de Checkout" worktrees/checkout-flow-v2
```

### `palco floor unload "Nome"`

Encerra os terminais do andar, a mesma ação disponível no menu do andar. Não vale para o seu andar nem para o que está na tela. Falha quando nada roda lá. Um `ask` para um agente de lá o acorda de novo.

```
palco floor unload "Refatorar Auth"
```

### `palco workspace unload "Nome"`

Encerra os terminais de um workspace inteiro; os agentes retomam a conversa na próxima visita. Não vale para o seu workspace nem para o que está na tela. Falha quando nada roda lá.

```
palco workspace unload "Análise de Churn Acme"
```

### `palco floor status ["Texto"] [--state working|blocked|review|done] [--progress 2/5] [--floor "Nome"] [--clear]`

A linha que o usuário vê sob um andar na barra lateral: como está o trabalho lá. Qualquer terminal pode publicá-la para o andar em que está; só o Maestro pode nomear outro andar com `--floor` (`"Ground"` para o térreo, onde cabe um resumo dos andares acima). `--state` tem padrão `working`; entrar em `blocked`, `review` ou `done` notifica o usuário, e texto ou progresso novo no mesmo estado não notifica. `--progress` aceita `2/5`, `40%` ou `0.4`. Sem texto, imprime o status atual; `--clear` remove. Linhas longas são cortadas em 120 caracteres.

```
palco floor status "Testes verdes, ligando a tela de login" --progress 3/5
palco floor status "Preciso de uma decisão sobre o formato do token" --state blocked
palco floor status "PR #412 aberto, pronto para o land" --state review
palco floor status "2 de 3 andares em revisão" --floor "Ground"
```

### Abrindo um pull request a partir do seu andar

Quando você mesmo abrir um (`gh pr create`, `glab mr create`), escreva a descrição a partir do modelo de pull request do repositório: `gh` e `glab` ignoram o modelo quando você passa um corpo. Procure na branch base por `pull_request_template.md` (qualquer caixa, `.md`, `.txt` ou sem extensão) em `.github/`, na raiz ou em `docs/`, e depois o `.gitlab/merge_request_templates/Default.md` do GitLab. Quando uma pasta `PULL_REQUEST_TEMPLATE/` ou `merge_request_templates/` tiver vários, escolha o que combina com a mudança. Mantenha os títulos e checklists, troque o texto de exemplo pelo que esta branch realmente faz e marque só as caixas que forem verdade. Publique um status como `"PR #412 aberto" --state review` para o usuário ver no andar.
