---
name: palco-routines
description: Gerencia rotinas agendadas no canvas do palco (comandos recorrentes e lembretes). Use para agendar um comando ou um prompt recorrente para um agente, automatizar uma tarefa com horário, criar um lembrete, ou listar/editar/remover rotinas. Vale quando a variável PALCO_SOCKET existe (o terminal roda dentro do palco).
user-invocable: true
---

# Rotinas do palco

Você está rodando dentro do palco, um espaço de desenvolvimento em canvas que liga agentes de IA, terminais, notas e portais de navegador.
O CLI `palco` já vem instalado e está no PATH. Se `palco` não for encontrado, use `"$PALCO_CLI"`; essa variável sempre aponta para o executável completo.

Rotinas executam comandos em segundo plano, enviam comandos ou prompts a um terminal do canvas, ou exibem lembretes na área de trabalho, conforme uma agenda. Use os comandos `palco routine` para criar, inspecionar, modificar e remover rotinas.

Estes comandos exigem o **Modo Maestro** no seu terminal. Se um comando responder que este terminal não é o Maestro, o usuário precisa ligar o Maestro no seu terminal pelo canvas para liberar.

Você só vê e gerencia rotinas do workspace atual.

## Escopo e segurança

- **`delete` é destrutivo.** Só apague uma rotina quando o usuário pedir explicitamente. Nunca apague por iniciativa própria, nem para arrumar.
- Rode sempre `palco routine list` primeiro para pegar os nomes exatos e os ids curtos.

## Comandos

### `palco routine list`
Lista todas as rotinas do seu workspace com id curto, agenda, destino, status e o próximo disparo.

### `palco routine show "Nome"`
Detalhe completo de uma rotina, incluindo o comando e o script de pré-execução. Em segundo plano, mostra também a última execução: início, duração, código de saída e o final da saída combinada (stdout e stderr, até 64 KiB).

### `palco routine create "Nome" --command "..." <agenda> [opções]`
Agenda uma rotina nova. São obrigatórios um nome, um `--command` e exatamente uma agenda. O comando pode ser um comando de shell ou um prompt para um agente de IA.

**Agenda (escolha exatamente uma):**
- `--every 30m` — intervalo. Aceita `45s`, `30m`, `2h`, `1h30m` (número sozinho é minutos).
- `--daily 09:00` — todo dia num horário de 24 h.
- `--weekly mon,wed,fri@09:00` — dias da semana escolhidos num horário. Dias: mon, tue, wed, thu, fri, sat, sun.
- `--once "2026-06-20 15:00"` — um horário único (`yyyy-MM-dd HH:mm`).

**Destino (opcional):**
- *(omitido)* — executa o comando em **segundo plano, sem terminal**. Use para comandos de shell independentes, como verificações e geração de relatórios. Roda no shell do usuário (`$SHELL -c`, ou `/bin/sh`), na pasta do workspace ou do andar onde foi criada, com o CLI do palco no PATH. Cada execução tem limite de 10 minutos; ao excedê-lo, os processos são encerrados. Um novo disparo da mesma rotina enquanto ela roda é pulado e registrado no histórico.
- `--terminal "Nome"` — envia comandos ou prompts a um terminal do seu workspace. Use para conversar com um agente ou aproveitar uma sessão interativa existente. Rode `palco list` para ver os nomes.
- `--reminder` — sem terminal de destino; dispara uma notificação na área de trabalho com o texto do comando.

**Opções:**
- `--count N` — para depois de N disparos. `--until "2026-07-01"` — para numa data. (Padrão: repete para sempre.)
- `--pre-run "script de shell"` — roda antes de cada disparo (precisa sair com 0, senão o disparo é pulado). Para pôr a saída dele no comando, coloque o marcador literal `{{output}}` no seu `--command` onde a saída deve entrar — esse marcador é trocado pela stdout do script na hora do disparo. **Sem `{{output}}` no comando, o script roda mesmo assim, mas a saída não é inserida.** Variáveis disponíveis: `$PALCO_WORKSPACE_NAME`, `$PALCO_WORKSPACE_DIR`, `$PALCO_ROUTINE_NAME`, `$PALCO_TERMINAL_NAME`.

```
palco routine create "Resumo diário" --command "Resuma os commits de hoje:\n\n{{output}}" --daily 18:00 --terminal "Backend" --pre-run "git log --since=midnight --oneline"
```
- `--no-skip-if-busy` — dispara mesmo se o terminal de destino estiver no meio de uma tarefa (por padrão, o disparo é pulado enquanto o terminal está ocupado).
- `--no-notify` — não publica notificação quando dispara.
- `--disabled` — cria pausada.

```
palco routine create "Auditoria noturna" --command "Rode npm audit e resuma as CVEs novas" --daily 02:00 --terminal "Backend"
palco routine create "Checagem de hora em hora" --command "git status --short" --every 1h
palco routine create "Daily" --command "Hora da daily" --weekly mon,tue,wed,thu,fri@09:00 --reminder
```

### `palco routine edit "Nome" [--name "Novo"] [--command ...] [agenda] [opções]`
Muda só os campos que você passar. Use `--name` para renomear. Mudar a agenda zera os contadores de disparo da rotina.

### `palco routine enable "Nome"` / `palco routine disable "Nome"`
Retoma ou pausa uma rotina sem editar mais nada.

### `palco routine run "Nome"`
Dispara uma rotina uma vez, agora, independentemente da agenda — útil para testar. Em segundo plano, espera a conclusão por até 60 segundos e imprime o código de saída e o final da saída. **Não precisa usar `sleep` depois de `routine run`.** Se continuar rodando após 60 segundos, o comando avisa; consulte `palco routine show "Nome"` para ver o resultado. Com terminal alvo, apenas entrega o conteúdo, como de costume. Um destino num andar ou workspace não aberto desde que o palco iniciou (ou descarregado por inteiro) é acordado antes; um terminal que o usuário descarregou, ou cuja sessão terminou, é pulado, e a resposta diz o motivo.

### `palco routine delete "Nome"`
Remove uma rotina do canvas. **Destrutivo — só com pedido explícito do usuário.**

## Desambiguando duplicadas

Se duas rotinas têm o mesmo nome, os comandos devolvem a lista de correspondências com ids curtos. Rode de novo com `--id <prefixo>` para escolher uma:

```
palco routine edit "Auditoria" --id a1b2c3 --daily 03:00
```
