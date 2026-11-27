# Provedores locais de Contas e Uso

As pastas ficam na raiz de dados do palco (`account-providers/`, `usage-providers/`), acessíveis em Configurações. O nome do JSON é o `id` e a versão suportada é `schemaVersion: 1`. Não coloque chaves, tokens nem senhas nesses arquivos.

Campos: `id`, `name`, `agent` (`claude`/`codex`, formato de agente compatível), `command` (executável, sem shell), `configEnv` (variável de diretório da CLI), `loginArgs`, `logoutArgs`, `statusArgs` (arrays), `apiKeyEnv` (nome da variável, nunca seu valor), `endpointEnv` opcional, `defaultEndpoint` opcional, `color` (`#RRGGBB`), `revision` (inteiro) e `usage` (`claude`, `codex` ou `json`). A CLI continua sendo responsável por seus próprios arquivos de autenticação.

No modo `json`, `usageArgs` define os argumentos da consulta. Ela deve imprimir uma linha JSON com `session` e/ou `weekly`: `{ "usedPercent": 25, "resetsAt": "2026-11-25T18:00:00Z" }`. A resposta é validada e erros brutos da CLI não são enviados à interface. Os modos Claude/Codex usam os protocolos de consulta já existentes, com o executável configurado. Contas com chave de API não são consultadas para os anéis.

Os estados Integrado/Modificado/Desatualizado/Personalizado/Inválido/Requer versão mais recente vêm da comparação com as definições integradas e da validação. Ativação e cor ficam em `_settings.json`, separados da definição. Restaurar integrados preserva os personalizados; Restaurar Padrão remove os personalizados após confirmação.

A API `PalcoApi.accountSettings` administra contas e troca de conta (`assign(terminalId, accountId|null, restart)`); `PalcoApi.providers` lista/configura/restaura/recarrega os provedores. Chaves só passam pelo IPC para o main e são cifradas com `safeStorage`; não há fallback `basic_text`, nem retorno da chave pela API. O ambiente de spawn é resolvido exclusivamente no main.
