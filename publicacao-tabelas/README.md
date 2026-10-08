# Publicação de tabelas — ambiente de teste

A página `Teste-publicacao.html` é uma cópia do relatório com um painel de publicação. O `index.html` e o arquivo existente `Teste.html` não foram alterados. Os arquivos publicados entram somente em `tabelas-teste/`; o relatório principal não lê essa pasta.

## Configuração inicial na sua conta

1. Crie uma conta gratuita em https://dash.cloudflare.com/ se ainda não tiver.
2. No GitHub, abra **Settings → Developer settings → GitHub Apps → New GitHub App**. Use um nome exclusivo, como `PEG Tabelas Samuel`. Homepage: `https://samuelcnovaes.github.io/Relatorio_PEG/Teste-publicacao.html`.
3. Crie primeiro o Worker na Cloudflare para obter o endereço final. A callback da GitHub App será `https://SEU-WORKER.workers.dev/auth/callback`. Ative o fluxo OAuth para usuários; não habilite Device Flow. Desmarque **Active** em Webhook, pois este serviço não usa webhooks.
4. Em **Repository permissions**, conceda **Contents: Read and write**; **Metadata: Read-only** é automática. Nenhuma outra permissão é necessária. Escolha instalar a aplicação apenas na sua conta.
5. Instale a GitHub App na conta `samuelcnovaes`, selecionando somente o repositório `Relatorio_PEG`. O login sozinho não substitui essa instalação.
6. Copie o **Client ID** (não o App ID) para `GITHUB_CLIENT_ID` em `wrangler.toml`. Gere um **Client secret** na GitHub App e guarde-o como secret do Worker. Não cole o secret no HTML, no repositório ou no chat.
7. Na pasta `publicacao-tabelas`, execute:

   ```sh
   npm install
   npx wrangler login
   npx wrangler kv namespace create SESSIONS
   ```

   Copie o ID do namespace para o campo `id` da configuração. Depois:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npm test
   npm run deploy
   ```

8. Confira que a callback no GitHub usa exatamente o endereço que o deploy informou. Na página de teste, preencha esse endereço no campo de serviço e clique em **Entrar com GitHub**.

O login é restrito à conta `samuelcnovaes`. O token do GitHub fica no Worker/KV, por até uma hora; a página recebe apenas uma sessão temporária mantida em memória. Reabrir a página exige entrar novamente. Não há chave privada de GitHub App neste fluxo: são usados os tokens de usuário da própria GitHub App instalada somente nesse repositório.

## Teste antes de migrar para o relatório principal

- Entre com a conta autorizada e publique um CSV com tipo e vigência corretos.
- Confira no GitHub o CSV e o catálogo na pasta `tabelas-teste`. O envio cria um único commit para os dois arquivos.
- Aguarde o deploy do GitHub Pages, reabra a página de teste e confira preços e vigência na análise.
- Tente publicar o mesmo tipo/ano: deve pedir confirmação de substituição.
- Teste um arquivo hospitalar de tipo diferente e uma vigência vazia: a publicação deve ser recusada.
- Verifique que o relatório principal não mudou. Só após a validação migraremos o mecanismo ao `index.html`.

Importações locais continuam disponíveis. Na página de teste, as tabelas do catálogo compartilhado prevalecem após seu carregamento. Não há migração automática das importações locais ao repositório.

## Limites e custos

A implementação usa Worker e KV; os planos gratuitos têm limites de requisições, gravações e armazenamento. Confira os limites na conta Cloudflare antes de ativar planos pagos. Arquivos têm limite de 15 MB. Contas, aplicação e implantação ainda precisam ser configuradas pelo proprietário; os testes locais não comprovam a autenticação real no GitHub nem um deploy em produção.
