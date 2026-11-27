# Política de segurança

## Reportar uma vulnerabilidade

Use o recurso privado do GitHub: abra a aba **Security** deste repositório e selecione **Report a vulnerability**. Não publique vulnerabilidades em issues, discussões ou pull requests.

Inclua a versão do palco, sistema operacional, passos para reproduzir e impacto observado. Não inclua credenciais reais, tokens, chaves privadas, dados pessoais ou outros segredos; substitua-os por valores fictícios.

Faremos o possível para responder em alguns dias.

## Versões suportadas

Apenas a versão mais recente do palco é suportada para correções de segurança.

## Escopo

O palco executa comandos na conta do usuário. Terminais locais comunicam-se com o app por um socket Unix local protegido. Em SSH e Docker, pode haver uma ponte TCP até o app; cada chamada continua exigindo a credencial do terminal. Portais são webviews sem Node nem preload privilegiado. O armazenamento é isolado por padrão e pode ser compartilhado por configuração entre portais do mesmo workspace ou globalmente.

Consideramos vulnerabilidades, entre outras:

- um terminal ou agente agir em nome de outro terminal sem a conexão ou autorização correspondente;
- uma chamada pela ponte TCP de SSH ou Docker ser aceita sem a credencial válida do terminal;
- uma página do portal escapar do isolamento e acessar recursos privilegiados do aplicativo;
- credenciais ou dados protegidos serem expostos a outro terminal, agente ou página;
- comandos ou arquivos serem acessados fora dos limites definidos pelo usuário devido a uma falha do palco.

Não consideramos vulnerabilidade, por si só, o usuário conceder permissões amplas ao agente, como `danger-full-access`, nem as ações que esse agente autorizado executar dentro dessas permissões. Relate separadamente qualquer falha do palco que permita ultrapassar a autorização configurada pelo usuário.
