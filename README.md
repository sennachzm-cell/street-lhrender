# STREET ADMIN — LH STREET | JavaScript + PostgreSQL + Render

**Entrega de engenharia, 19/11/2026 — versão de homologação 1.2.0 (não homologada em produção).**

Este projeto foi adaptado **do código JavaScript/HTML/CSS original** do Street Admin, sem reconstrução em Python ou troca por protótipo. Preserva as páginas e rotas originais para produtos, clientes, caixa, vendas, estoque, financeiro, equipe, relatórios, importação, exportação e auditoria. Inclui uma nova identidade visual LH STREET, com logo enviada em 19/11/2026, textura e grafismos próprios, e um backend preparado para PostgreSQL.

**Aviso importante:** não é uma entrega certificada para produção. Não foi possível executar um PostgreSQL real, instalar a dependência `pg`, publicar no Render, executar no Windows ou acessar um iPhone a partir deste ambiente. Os testes automatizados com banco simulado passaram; consulte `TEST_REPORT.md`. Nenhum dado real de clientes, estoque ou caixa foi fornecido ou migrado. **Não apague sua instalação anterior ou seus arquivos SQLite.**

## 1. Arquitetura e sincronização

```text
                   Browser HTTPS / iPhone / Android
                                 |
                       Render Web Service
                      Node.js + API original
                                 |
                         PostgreSQL central
                                 |
                   registros de todas as lojas

Windows -> gateway em 127.0.0.1:17879 -> HTTPS -> API do Render
```

A versão Windows serve o **frontend atualizado a partir do próprio pacote** no navegador e encaminha **apenas a API** ao mesmo servidor Render. Ela não grava um banco SQLite separado nem conhece a senha do PostgreSQL. Ela **precisa de internet e do Render disponível** para ler e alterar dados. Se perder conexão, não há garantia de modo offline nem de sincronização de filas locais antes da reconexão. O modo de persistência e a segurança da sessão ainda precisam ser homologados em máquinas reais.

## 2. Como publicar a versão online no Render

1. Instale **Node.js 22 ou posterior** em seu PC e tenha contas no **GitHub** e **Render**.
2. Extraia **`StreetAdmin-Render.zip`**. Crie um **repositório PRIVADO** no GitHub e envie o conteúdo da pasta (arquivos `server.js`, `render.yaml`, diretórios `db/`, `public/`, etc.) à raiz desse repositório. **Não envie nenhum `.env`, banco, chave, token, CPF/CNPJ em arquivos de dados ou backup.**
3. No Render, selecione **New > Blueprint**, conecte o repositório e revise o `render.yaml` antes de criar os recursos. Esse blueprint define **um Web Service pago e um PostgreSQL persistente pago**; revise preços e limites apresentados pelo Render. O PostgreSQL gratuito não é adequado para dados definitivos, pois pode expirar em 30 dias.
4. O Render configura automaticamente `DATABASE_URL` para o Web Service a partir do banco do blueprint. Nunca publique essa variável em HTML/JS ou no GitHub.
5. Para criar uma loja *nova* sem migrar dados anteriores, configure temporariamente a variável de ambiente **`ALLOW_REGISTRATION=true`**, aguarde a reimplantação, abra `https://SEU-SERVICO.onrender.com` e crie a conta do administrador. **Altere `ALLOW_REGISTRATION=false` imediatamente após concluir a criação.** O fluxo de registro online ficará bloqueado então; usuários da equipe devem ser adicionados pela área autenticada.
6. Confira a resposta de `https://SEU-SERVICO.onrender.com/api/health` — em condições normais retorna JSON com `ok:true`. Entre no sistema, cadastre um produto de teste, edite, faça uma venda de teste e confira as permissões e relatórios.
7. Não use dados reais de operação antes da homologação de permissões, segurança, estoques simultâneos, backup/restauração e compatibilidade do frontend.

### Configurações necessárias (produção)

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Ligação segura e privada com o PostgreSQL (injetada pelo Render). |
| `NODE_ENV=production` | Ativa exigência de HTTPS pelo proxy e impede rotas de controle Windows. |
| `PORT` | Porta atribuída automaticamente pelo Render; não fixe uma porta manual na produção. |
| `ALLOW_REGISTRATION=false` | Impede criação pública de novas lojas depois do primeiro cadastro. |
| `PGPOOL_MAX=8` | Limita o pool de conexões. Ajuste se necessário conforme a capacidade do plano. |

Os serviços web e banco estão explicitamente definidos na região **`virginia`** no `render.yaml`. Definir a região no Blueprint não desloca serviços ou bancos já existentes: para isso é necessário um plano de migração.

O projeto contém `render.yaml`, `.gitignore`, `.env.example`, scripts npm e migrações idempotentes (`db/migrations/`). Atualizações normais **não** recriam o banco e não executam `DROP`/`TRUNCATE`. A duração do armazenamento depende da continuidade de pagamento/serviço e das políticas do provedor; nenhuma plataforma garante funcionamento eterno.

## 3. Como usar no Windows, sem CMD aberto

1. Primeiro publique o serviço online e comprove login e CRUD no Render.
2. Instale **Node.js 22+ para Windows** e confirme que `node.exe` está disponível no PATH.
3. Extraia o arquivo **`StreetAdmin-Local.zip`**. Não execute dentro do ZIP.
4. Abra **`windows/render-url.txt`** e substitua `https://SEU-SERVICO.onrender.com` pelo HTTPS verdadeiro do Render, sem `/` extra e sem caminhos.
5. Dê dois cliques em **`windows/Iniciar-StreetAdmin.vbs`**. Ele inicializa o gateway Node oculto e abre `http://127.0.0.1:17879/` no navegador. Se não funcionar, confira o arquivo de ajuda `windows/Problemas-na-Inicializacao.html`, a versão do Node.js, a URL, a conexão e a porta 17879.
6. Faça login com a **mesma conta da versão online**. Cadastre/edite um produto e confira no iPhone. A página é local; a **API e o banco são online**.
7. Para encerrar, use **`windows/Encerrar-StreetAdmin.vbs`**. Ele envia um token temporário à instância local, sem encerrar processos Node de outros aplicativos.

Não há instalador EXE assinado neste pacote. O arquivo VBS e o inicializador só poderão ser validados em Windows real. Os caminhos relativos mantêm os arquivos organizados; não mova arquivos individuais do diretório `windows/`.

**Outro notebook:** use o mesmo ZIP local em outro Windows com Node.js e configure o mesmo domínio Render. Os dois computadores fazem login na mesma API; não é preciso expor a rede doméstica nem manter o primeiro PC ligado.

## 4. Como acessar no iPhone e Android

No Safari/Chrome, abra diretamente o **endereço HTTPS do Render** (não o IP local do Windows). Faça login. Se desejar, no Safari use **Compartilhar > Adicionar à Tela de Início**; isso abre a interface web como atalho, **não** um aplicativo nativo publicado na App Store. Não é necessário instalar certificado particular de servidor doméstico.

## 5. Backup e migração sem perder dados

**Antes de qualquer intervenção:** mantenha a instalação original e copie o arquivo `.sqlite` completo **com o programa antigo fechado**. Se o banco antigo estiver em uso, uma cópia simples pode ser inconsistente; prefira um backup feito com a ferramenta de banco, ou feche todos os processos antes de copiar. Guarde esse backup offline com segurança.

Se a loja já tiver dados reais no SQLite e desejar preservá-los, **não crie produtos ou vendas no banco PostgreSQL ainda**. A migração para um PostgreSQL vazio (mas com tabelas criadas) está preparada no script `scripts/migrate-sqlite.js`. Requer Node 22+, `pg` instalado, acesso privado ou SSL legítimo ao PostgreSQL, banco destino sem nenhum registro e **teste prévio de restauração em ambiente de homologação**:

```powershell
# No terminal de um ambiente seguro, com o backend antigo desligado:
npm install
$env:DATABASE_URL="postgresql://usuario:senha@host:5432/streetadmin"
npm run migrate:sqlite -- "C:\backup\street-admin-contas.sqlite"
```

**Não cole URLs com senhas no GitHub nem no chat.** O comando acima é um exemplo para uso local seguro; a execução ainda **não foi testada em um PostgreSQL real**. O script faz as inserções numa única transação e recusa migração quando o destino já tem dados, sem editar o arquivo SQLite. Ele não substitui auditoria de integridade, verificação das contagens de lojas/usuários/produtos/vendas, reconciliação financeira e testes com dados reais. Para a migração inicial, é preferível ter assistência técnica com acesso ao ambiente controlado.

**Backups PostgreSQL:** configure backups regulares/snapshots do provedor conforme o plano disponível; também é possível gerar backup lógico com `pg_dump` e restaurar com `pg_restore` usando um usuário autorizado em um **banco de homologação diferente** antes de qualquer recuperação em produção. Mantenha cópias criptografadas fora do serviço e teste restauração. Não dependa somente de exportações JSON da interface: elas não incluem as contas dos usuários.

## 6. GitHub e atualizações

Edite **a mesma base de código** no repositório GitHub. Execute `npm run check` e `npm test` (Node 22+); faça backup, envie o commit e aguarde o Render publicar. Em migrações estruturais, primeiro faça cópia e execute validação em banco-clone. **Não exclua o banco PostgreSQL, não recrie o recurso de banco para atualizar o aplicativo, nem publique um novo banco ao alterar o código.**

**Rollback:** no Render selecione uma implantação de código anterior quando possível. Se uma migração de dados incompatível tiver ocorrido, é necessário um plano específico para reverter esquema e dados a partir de backups verificados; voltar só o código não desfaz migrações. Não aplique rollback às cegas em operações de vendas e estoque.

## 7. Diagnóstico de erros

| Sintoma | Conferir |
|---|---|
| `DATABASE_URL ausente` | Configurar env no Render sem colar no código. |
| `pg` não encontrado | Executar `npm install` no backend (o Render executa no build). |
| Status 502 ou gateway indisponível | Domínio Render correto, serviço ativo, conexão e logs do Render. |
| Login negado | E-mail/senha, registro inicial habilitado somente durante bootstrap, estado da conta. |
| Falha de sincronização | Conexão HTTPS, autenticação e logs. Evitar reenviar operações manualmente sem conferir se já chegaram. |
| Página sem CSS | Conferir arquivos `public/`, cache e reiniciar o navegador. |
| Windows abre navegador mas não conecta | `node.exe` no PATH, arquivo `windows/render-url.txt` e porta 17879 livre. |
| Produto em outro dispositivo não aparece | Fazer login na mesma loja, sincronizar novamente e conferir logs. |
| Render não inicia | `npm install`, versão Node 22+, `DATABASE_URL` e logs de migração. |

## 8. Segurança e limitações antes do uso comercial

- Sessões usam token Bearer mantido no navegador pelo frontend legado; a evolução para sessões/cookies mais protegidos e testes de XSS/CSRF continuam necessários.
- O sistema possui validações de permissão no backend, transações PostgreSQL com locks por loja e checagem de operações repetidas. **Isso não dispensa revisão de segurança real.**
- Cadastro de lojas públicas precisa ser desativado depois do primeiro administrador. Controles Windows legados foram desabilitados em produção.
- O frontend original pode manter partes do comportamento de fila local/IndexedDB. O envio passou a aguardar confirmação do servidor para operações editadas nesta revisão, mas os fluxos precisam ser testados tela a tela.
- Não há homologação ou garantia de compatibilidade de navegadores/dispositivos ou integridade dos dados reais.
- O pacote local não é um instalador; é um inicializador de uma interface web conectada ao Render.

Consulte `TEST_REPORT.md` e `CHANGELOG.md` e reporte os bugs encontrados sobre esta versão sem descartar a original.

## 8. Identidade LH STREET v1.2 e diferenças sobre a versão anterior

A reformulação usa **exclusivamente a logo mais recente enviada pelo proprietário** para o material visual. O logo completo foi convertido para WebP no `public/lh-street-logo.webp`, foi preparado um recorte do monograma (`lh-street-mark.webp`) e foi extraída uma textura sem lettering (`lh-street-texture.webp`). **A imagem inteira não foi aplicada como papel de parede**: os painéis mantêm legibilidade, e a textura aparece em áreas de baixa opacidade.

Os tokens de estilo estão no único arquivo de sobreposição `public/lh-street-identity.css`, preservando CSS e JS anteriores que ainda são usados por componentes como caixa, vendas, finanças, relatórios e equipe. Ícones PWA foram atualizados. A tela de entrada não apresenta mais gráfico ilustrativo com números inventados.

**Mudanças de funcionamento:** `GET /api/config` informa se o registro está habilitado; em `NODE_ENV=production` o registro é bloqueado a menos que `ALLOW_REGISTRATION=true` seja definido intencionalmente. A interface oculta a opção de registro quando o servidor desabilita essa função. Os modais principais receberam retorno de foco e tratamento de Tab; o gateway Windows serve seus próprios arquivos e não substitui o frontend local por arquivos remotos.

**Limite:** contas existentes, produtos e vendas não foram migrados de um banco real; deve-se validar o PostgreSQL com o `npm install`, conexão verdadeira e tests de operações simultâneas antes de usar dados de produção. A versão local depende da API Render estar acessível pela internet. Um teste unitário com banco simulado não prova integridade de uma implantação real.

## 9. Plano seguro de homologação

1. Preserve os arquivos antigos e faça backup da base original e do banco Render, se já existe.
2. Publique em ambiente de testes **sem sobrescrever uma instância de produção**; verifique o custo e a região antes de aceitar o Blueprint.
3. Crie ou conecte um banco PostgreSQL persistente no Render; não recrie o banco usado por vendas reais.
4. Habilite cadastro temporariamente somente para a conta inicial e desabilite novamente depois.
5. Teste login, perfis/autorizações, abertura e fechamento do caixa, estoque, duplicidade de vendas, exportação, importação e reconciliação financeira.
6. Faça as verificações em Windows, iPhone e Android, incluindo reconexão, tamanhos de tela e cache PWA.
7. Verifique backup e restauração em banco **de homologação**, nunca diretamente em produção sem um plano.

**Aviso:** não há autorização nem acesso administrativo ao Render neste artefato; o envio para GitHub e o deploy não foram feitos nesta geração de pacotes.
