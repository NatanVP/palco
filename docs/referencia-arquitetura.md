# Arquitetura do palco

O palco é um aplicativo Electron com interface React e um CLI local. O canvas reúne terminais, notas, portais, arquivos e desenhos. Workspaces separam projetos; andares organizam o trabalho dentro deles e podem usar worktrees Git. Espaços e grupos organizam a barra lateral.

## Processos e comunicação

O processo principal controla o estado, os processos de terminal, o acesso a arquivos, as contas e a persistência. O preload expõe uma API tipada para a interface. O renderer apresenta o canvas e os painéis; operações privilegiadas passam pelo processo principal.

Cada terminal usa node-pty e mantém uma representação xterm no processo principal para consultas e retomada da visualização. O renderer recebe o snapshot inicial e os eventos de saída ordenados.

O CLI fala com o servidor HTTP local do processo principal por um socket Unix. Os terminais recebem a localização do socket e um token em seu ambiente. A autenticação identifica o terminal; as conexões do canvas determinam quais agentes e notas ele pode alcançar. Tokens são renovados por processo e não substituem a proteção da conta do sistema operacional.

## Coordenação dos agentes

`palco ask` entrega uma mensagem a um agente conectado e aguarda sua resposta. A conclusão usa os sinais de turno dos agentes integrados e mecanismos de espera de saída quando necessário. `palco check` consulta o texto do terminal. Bandas permitem endereçar grupos de agentes; notas conectadas compartilham contexto.

Roles definem instruções, presets guardam configurações de terminais e partituras salvam montagens reutilizáveis do canvas. O Modo Maestro habilita operações de coordenação. Rotinas disparam prompts ou comandos nos horários configurados.

## Dados e integrações

A raiz padrão de dados é `~/.palco`. Os stores usam formatos versionados e gravação atômica. Backups e mudanças de raiz têm validação própria; consulte [Dados e backups](data-backups.md).

As CLIs dos agentes cuidam de sua autenticação. Provedores configuráveis descrevem comandos e formatos para [contas e uso](providers/contas-e-uso.md) e [pull requests](providers/git-hosts.md). Chaves gerenciadas pelo palco são cifradas no processo principal com o armazenamento seguro do Electron.

## Organização do código

- `src/main/`: serviços do aplicativo, persistência e processos.
- `src/preload/`: ponte entre a interface e o processo principal.
- `src/renderer/`: canvas, componentes e painéis React.
- `src/shared/`: contratos e tipos compartilhados.
- `src/cli/`: comandos do CLI.
- `resources/`: ícones e skills distribuídos com o aplicativo.
- `tests/`: verificações automatizadas.

O app e o CLI são compilados em `out/`. Scripts de desenvolvimento e instalação ficam em `scripts/` e o lançador do CLI em `bin/`.
