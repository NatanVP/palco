# Dados e backups

`DataRoot` resolve a raiz antes de abrir os stores. A localização fica no arquivo `palco-data-location.json` do `userData` do Electron; a raiz padrão é `~/.palco`. O marcador `.palco-data-root` identifica uma raiz pertencente ao app. Alterar exige um diretório vazio e separado da origem; links são recusados. A cópia é concluída, os caminhos internos dos metadados são ajustados e a localização é gravada antes de remover a origem.

Raiz, restauração e exclusão total são aplicadas depois que os processos/stores são encerrados, antes do relançamento. ConfirmDialog precede as ações destrutivas. Apagar Tudo tenta sair das contas; logins inacessíveis exigem um segundo Continuar. Projetos externos não são apagados. O reset limpa as partições gerenciadas dos portais, incluindo órfãs; a ação Limpar Global toca somente a partição global.

Backups horários e Fazer Backup Agora criam ZIPs por workspace em `backups/<id>/`. Incluem o workspace e os chats/anexos dos seus terminais. Restaurar um snapshot afeta apenas esse workspace e seus chats. A árvore anterior é preservada em rollback se a reversão falhar. Antes de importar, o estado atual ganha snapshots.

Exportar Backup Completo inclui os arquivos da raiz, exceto backups recursivos, o marcador da raiz e as pastas `account-data/` das CLIs. Cookies do Electron estão fora dessa raiz e não são exportados. Chaves do palco continuam cifradas. A importação substitui workspaces, chats, sidebar, conexões entre workspaces e metadados de sessão; preserva preferências, contas, bibliotecas e provedores atuais.

Formato: ZIP padrão, UTF-8, deflate/armazenado, CRC32; `manifest.json` com `type: "palco-backup"`, `schemaVersion: 1`, `kind`, `createdAt`, `sourceRoot` e, no snapshot, `workspaceId/workspaceName`. Os arquivos ficam sob `data/`. ZIP64 e arquivos criptografados não são aceitos. Limites de backup: 512 MB descomprimidos, 128 MB por arquivo, 20 mil arquivos. Travessia, links e caminhos duplicados/conflitantes são recusados. O teste de compatibilidade usa também o leitor externo `unzip`.
