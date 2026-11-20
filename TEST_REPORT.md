# RELATÓRIO DE TESTES — STREET ADMIN 1.2.0

**Data:** 19/11/2026. **Status:** código preparado para homologação; não é certificação de produção.

## Executados nesta sessão

- `npm run check`: passou (`server.js`, adaptador PostgreSQL, gateway Windows e aplicação cliente).
- `node --check public/theme.js`: passou.
- `npm test`: **9 casos aprovados, 0 falhas**, por Node.js 22.16.0.

Os 9 cenários cobrem: registro/login/sincronização de produtos e rejeição por estoque insuficiente; produção com registro público desligado; abertura e fechamento de caixa, fundo de troco e fechamento sem abertura; presença de páginas e rotas; proibição de alertas nativos no frontend; configuração do Render, região Virginia e assets LH STREET; verificação estrutural de frontend local; migrações sem DROP/TRUNCATE; e parametrização de consultas/transações por adaptador PG simulado.

## Não testados / limitações

- **PostgreSQL real:** não foi inicializado; conexão, migração, índices, transações reais e simultaneidade não foram validados. Testes de rota usam *mock* em memória e os testes PG usam um *Pool* simulado.
- **`npm install`/`pg` e produção:** dependências não foram instaladas nem foi feita implantação real em Render.
- **Windows:** inicializadores `.vbs` e os fluxos da versão local não foram executados em um computador Windows real.
- **iPhone/Android:** não houve homologação em dispositivos reais.
- **Navegador automatizado:** o ambiente bloqueou acesso ao `localhost` para Playwright; portanto não há aprovação de responsividade visual nem execução end-to-end de UI.
- **Fluxos com dados reais:** restauração e reconciliação financeiras, importação de backup, permissões de equipe, cancelamentos, documentos e comportamento de desconexão ainda exigem testes funcionais integrados.
- **Segurança:** CSP adicionada, mas revisão profissional e testes contra falhas lógicas, XSS, concorrência e abuso não foram concluídos.

## Resultado

O projeto é um **candidato a testes de homologação**, não um sistema homologado para dados reais. Nenhuma base de dados do proprietário foi acessada ou alterada. Manter backups e testar primeiro em ambiente de homologação.
