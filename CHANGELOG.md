# CHANGELOG — STREET ADMIN

## 1.2.0 — 2026-11-19 (homologação)

- Continuação efetiva dos pacotes JS v1.1, sem nova implementação do zero.
- Logo enviada em 19/11 usada na identidade da LH STREET; monograma e textura sem lettering otimizados para WebP; ícones de instalação PWA substituídos pela marca atual.
- Revisão da camada de estilos do app, login, lateral, conteúdo, cabeçalho, cards, botões, modais, formulários, listas, mensagens e uso mobile. Paleta grafite, preto, metal discreto e roxo profundo da referência visual.
- Removido gráfico decorativo do login, que poderia ser interpretado como números reais. Textos genéricos da página inicial e do painel substituídos.
- Novo `/api/config` informa a configuração real de cadastro. Por padrão, o cadastro público é bloqueado em produção, exceto se explicitamente habilitado. O formulário de entrada reflete esse estado.
- Cabeçalhos de segurança/CSP para arquivos estáticos; extensão WebP corretamente servida pelo Node.
- Modais: navegação por teclado e retorno de foco para o modal principal.
- Gateway Windows não troca mais assets locais por cópias do Render; somente as rotas `/api/` são encaminhadas.
- Inicializador VBS verifica URL Render e Node; ajuda offline personalizada para casos de falha de pré-requisitos.
- Cache do Service Worker versionado para forçar atualização de assets visuais.
- Blueprint confirmado com `region: virginia` no serviço web e no PostgreSQL, com planos pagos definidos e banco separado.
- Testes automatizados aumentados de 6 para 9 (com banco simulado onde indicado).

**Pendências:** não houve banco PostgreSQL real, migração de dados reais, execução em Windows ou teste visual automatizado no navegador; a alteração não foi publicada no GitHub nem implantada no Render.

## 1.1.0 — 2026-11-18 (homologação)

- Mantida e adaptada a versão real JavaScript/HTML/CSS com rotas de produtos, equipe, caixa, vendas, estoque, financeiro, relatórios e auditoria.
- Criados esquema e adaptador de consultas e transações para PostgreSQL, incluindo migrações de criação, índices e chaves e bloqueio por loja.
- Criado script conservador de importação SQLite -> PostgreSQL para destino vazio e antiga base fechada; **não executado com dados reais**.
- Preparado Blueprint `render.yaml` e variáveis de ambiente para serviço Node.js e banco PostgreSQL central persistente.
- Criado gateway Windows localhost com proxy de API para produção HTTPS, sem usar o banco local. Criados atalhos VBS para iniciar e parar sem CMD visível; **não testados em Windows real**.
- Aplicada camada visual LH STREET com paleta grafite, preto, prata/violeta discreto, logo fornecida e CSS responsivo existente preservado.
- Revisado salvamento no frontend para aguardar confirmação de sincronização com backend antes de emitir sucesso.
- Criados testes estáticos, de adaptação de consultas e rotas simuladas (incluindo login, estoque e venda). Todos passaram no ambiente atual.
- Documentação inicial de implantação, utilização, atualização e segurança.

### Pendente para aceite de produção

- Instalar/rodar `pg` e PostgreSQL real, testar migrações/restauração, real concorrência, autenticação e tokens.
- Testar todos os fluxos e telas em Windows, iPhone, Android, desktop e Render reais.
- Migrar dados reais existentes sem perdas, com contagens, reconciliação e homologação pelo proprietário.
- Auditar segurança, gestão de sessão, perfis, integridade, erros e comportamento offline.
- Construir e assinar instalador Windows (fora desta entrega, se solicitado).
