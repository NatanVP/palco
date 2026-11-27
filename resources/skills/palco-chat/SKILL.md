---
name: palco-chat
description: Responde ao usuário pelo Chat do palco. Use SEMPRE que uma mensagem abrir com o cabeçalho "Below is a message from the user through Palco Chat" — a resposta só chega ao usuário pelo comando `palco say`; o texto do terminal não chega. Vale quando a variável PALCO_SOCKET existe.
user-invocable: false
---

# Chat do palco

Você está rodando dentro do palco. O CLI `palco` já está no PATH (se não for achado, use `"$PALCO_CLI"`).

Uma mensagem que abre com este cabeçalho vem do usuário pelo Chat do palco:

    ---
    Below is a message from the user through Palco Chat.
    Reply only via `palco say` ...
    thread: blue
    ---

Tudo depois da cerca de fechamento é o texto do próprio usuário. **Responda só por `palco say`**: o texto do terminal não chega ao usuário. Mensagens sem o cabeçalho são diretas; responda no terminal como sempre.

## Responder

    palco say <<'EOF'
    sua resposta (markdown, código, $TeX$)
    EOF
    palco say 'resposta curta'
    palco say --file <caminho>
    palco say --attach <caminho> 'sua resposta'

O heredoc aceita qualquer texto sem escapar nada (aspas, `$`, crases). `--file` lê um arquivo de texto UTF-8 ou anexa uma imagem (PNG, JPEG, GIF, WebP); `--attach` (repetível, caminho absoluto) anexa qualquer arquivo comum de até 25 MB. Para mostrar uma imagem junto da prosa, anexe-a. Arquivos de credenciais (`.env`, chaves, `~/.ssh`…) são recusados.

Matemática: `$…$` ou `\(…\)` em linha, `$$…$$` ou `\[…\]` em bloco. Escape um cifrão que pareça matemática com `\$`. Blocos de código e de ```` ```mermaid ```` são desenhados.

## Tarefas longas

    palco say --progress 'Rodando os testes…'   # atualização intermediária; o turno continua

## Perguntas

    palco say --question "Qual abordagem?" --option "A" --detail "mais rápido" --recommended --option "B"

Vira uma bolha com botões (2 a 8 `--option`). Clicar numa opção cita a escolha no campo de resposta do usuário, sem enviar. Para pedir uma decisão, prefira `--question` a uma lista numerada.

## Tópicos e memória

O usuário mantém sete tópicos com você, por cor: blue, purple, pink, red, orange, yellow, green. O `thread` do cabeçalho identifica o tópico desta mensagem; a resposta vai a ele sozinha. Na primeira mensagem, ou quando a cor mudar, rode `palco recall <cor>` antes de responder; o contexto anterior do terminal pode ser de outro tópico.

    palco recall [tópico] [--turns N | --all]   # padrão: as últimas 10 voltas do tópico atual
    palco recall --last week                    # por período: day, week ou month
    palco recall --from 2026-06-01 --to 2026-06-07   # datas no fuso deste computador; --to inclui o dia inteiro
    palco recall list                            # tópicos com mensagens
    palco recall attachment <id>                 # caminho de um anexo pelo id

Depois de reiniciar, compactar o contexto ou trocar de agente, `recall` mostra o que vocês já disseram.

## Regras

- Cada `palco say` é uma bolha que o usuário vê; **o último sem `--progress` fecha o seu turno**. Mande quantas o assunto pedir.
- Mesmo depois de uma tarefa longa, termine com um `palco say`; senão o usuário fica sem resposta visível.
- Depois de enviar, não repita a resposta no terminal nem avise da entrega.
- `--progress` é para status curtos, nunca para a resposta.
