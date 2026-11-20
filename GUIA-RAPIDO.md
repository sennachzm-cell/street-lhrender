# LH STREET — Street Admin 1.2 | Comece aqui

1. **Online primeiro:** extraia `StreetAdmin-Render.zip`, confira `render.yaml` e envie o conteúdo para um repositório PRIVADO. No Render use **New > Blueprint**, revise planos pagos e a região **Virginia** antes de criar serviços. O banco PostgreSQL deve ser persistente e separado do ciclo de deploy.
2. **Cadastro inicial:** no primeiro deploy, permita `ALLOW_REGISTRATION=true` somente enquanto cria a loja. Depois desative. Não coloque senhas ou `DATABASE_URL` no GitHub.
3. **Teste online:** use o HTTPS do seu serviço, faça login, teste produtos, vendas e caixa somente com dados de homologação.
4. **Windows:** extraia `StreetAdmin-Local.zip`, instale Node.js 22+, substitua o endereço em `windows/render-url.txt` e execute `windows/Iniciar-StreetAdmin.vbs`. Para encerrar, execute `Encerrar-StreetAdmin.vbs`.
5. **iPhone:** abra o endereço HTTPS publicado no Safari. Use Compartilhar > Adicionar à Tela de Início se desejar.
6. **Atualizações:** versionar apenas código. Faça backup antes de migrações e nunca recrie o PostgreSQL para atualizar a interface.

**Não faça uso produtivo antes da homologação real.**

Leia `README.md`, `README_LOCAL.md`, `CHANGELOG.md` e `TEST_REPORT.md` para os detalhes, limitações e procedimentos de backup/rollback.
