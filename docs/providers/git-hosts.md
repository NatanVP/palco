# Provedores de pull requests

Configurações → Geral → Git abre a pasta `git-hosts/` da raiz de dados. Cada arquivo `<id>.json` contém `schemaVersion: 1`, `revision`, `id`, `name`, `command`, `hosts` (nomes de hosts), `whoamiArgs`, `listArgs` e `protocol` (`github`, `gitlab`, `json`). Argumentos são arrays e o processo usa `execFile`, sem shell. Não coloque tokens nessa definição: a autenticação pertence à própria CLI.

As definições integradas usam `gh` e `glab`. A verificação faz uma requisição autenticada `api user --silent`, sem devolver dados de autenticação à UI. A listagem GitLab segue as opções da [documentação oficial de `glab mr list`](https://docs.gitlab.com/cli/mr/list/) e o comportamento de [`glab api`](https://docs.gitlab.com/cli/api/). O provedor personalizado `json` retorna uma lista com `number`, `title`, `state`, `updatedAt`, `url`. GitLab (`iid`, `updated_at`, `web_url`) é normalizado pelo adaptador.

O host vem do remoto `origin`; credenciais eventualmente presentes na URL nunca são exibidas nem retidas. O monitor de mudanças de pull requests consulta estes mesmos provedores a cada ciclo. Verificar/Recarregar verificam autenticação real, mas nunca mostram a saída bruta de erros. Uma CLI ausente aparece como não verificável, com o motivo.

Restaurar Padrão exige o SHA-256 que a UI observou. Se o arquivo mudou enquanto a confirmação estava aberta, a operação é recusada. Restaurar Provedores Integrados repõe somente os ausentes; preserva personalizados e modificações existentes. Definições futuras/inválidas não são executadas.
