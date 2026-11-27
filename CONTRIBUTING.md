# Como contribuir

Contribuições de código, documentação, traduções e relatos de problemas são bem-vindas.

## Antes de começar

Procure uma issue existente. Para mudanças maiores, abra uma proposta antes de implementar para combinar o escopo. Correções pequenas podem vir diretamente por pull request.

Vulnerabilidades devem ser reportadas pelo canal privado descrito em [SECURITY.md](SECURITY.md). Não abra issue ou PR público com detalhes de exploração.

## Preparar o ambiente

Use Linux com ambiente gráfico, Git, npm, Python 3, compilador C/C++ e make. Use a versão de Node indicada em `.nvmrc` (atualmente 24); com nvm, rode `nvm use`. O npm ci compila o módulo nativo node-pty.

1. Faça um fork de https://github.com/NatanVP/palco.
2. Clone o seu fork e entre na pasta do projeto.
3. Prepare uma branch:

   ```bash
   git remote add upstream https://github.com/NatanVP/palco.git
   git fetch upstream
   git switch -c minha-mudanca upstream/main
   nvm use  # se você usa nvm
   npm ci
   npm run dev
   ```

Não é necessário acesso de escrita ao repositório original.

## Fazer e verificar a mudança

Mantenha o PR focado em um problema. Inclua testes para corrigir falhas ou acrescentar comportamento, sem enfraquecer os testes existentes. Explique alterações de comportamento e eventuais limitações.

O CI obrigatório é o job `gates`, que executa typecheck, test e build. Toda mudança entra por pull request e só pode ser integrada com esse CI verde. Antes de enviar, rode:

```bash
npm run typecheck
npm test
npm run build
```

Para mudanças visuais, confira também a interface com `npm run dev` e envie capturas quando ajudarem a revisão. Use dados fictícios e remova nomes de usuário, caminhos pessoais, credenciais e notificações das capturas e logs. Ao testar, não use nem altere o `~/.palco` real. Use um `HOME` temporário, por exemplo `HOME="$(mktemp -d)" npm run dev`.

Se alterar dependências, atualize o lockfile com npm e regenere os avisos com `npm run notices`. `npm run icons` requer ImageMagick e só é necessário ao regenerar ícones. `npm run dist:linux` gera os pacotes Linux; não é requisito para toda contribuição.

## Abrir e acompanhar o PR

Faça commit, envie a branch ao seu fork e abra um PR para `NatanVP/palco:main`. Preencha o resumo, o motivo e os testes executados. Relacione a issue quando houver.

A primeira execução de CI de um contribuidor externo precisa de aprovação do mantenedor; outras execuções também podem exigir aprovação conforme a política do repositório. Essa liberação autoriza rodar a CI; não significa aprovação do PR. Não adicione segredos para tentar destravar uma execução.

Mantenha a branch atualizada com a main e responda às conversas de revisão. O mantenedor confere as mudanças, inclusive alterações na CI, e integra por squash quando os requisitos estiverem atendidos. Uma CI verde não implica aceite automático nem garante ausência de bugs.

## Convivência e licença

Trate as pessoas com respeito e critique as propostas, não quem as apresenta. Não publique dados pessoais de terceiros. A manutenção pode pedir ajustes ou recusar mudanças fora do escopo do projeto.

O projeto usa a [licença MIT](LICENSE). Ao contribuir, envie apenas conteúdo que você tenha direito de disponibilizar sob essa licença e preserve as atribuições de terceiros.
