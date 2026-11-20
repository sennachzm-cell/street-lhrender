# STREET ADMIN — Início rápido no Windows

## Antes
Publique **`StreetAdmin-Render.zip`** no Render, configure o banco PostgreSQL e confirme o login online. Instale Node.js **22+** no Windows. A versão local **não** funciona sem a API online e conexão com internet.

## Iniciar
1. Extraia a pasta inteira de `StreetAdmin-Local.zip`.
2. Edite `windows/render-url.txt` para seu URL real, por exemplo `https://minha-loja.onrender.com`.
3. Execute `windows/Iniciar-StreetAdmin.vbs` com dois cliques. O gateway oculto abrirá **os arquivos visuais incluídos neste ZIP** na página local em `http://127.0.0.1:17879/`.
4. Faça login com a conta criada no Render.
5. Para sair, execute `windows/Encerrar-StreetAdmin.vbs`.

Não copie arquivos SQLite de versões antigas para este pacote. A versão local é uma interface em seu navegador, conectada via HTTPS à API do Render; as informações persistentes ficam no PostgreSQL central.

Se não abrir, confira se `node.exe` funciona no Windows, se há internet, se o serviço Render está ativo e se a porta 17879 não está sendo usada. Não foi produzido um instalador EXE nem verificado em Windows real neste ambiente.

### Se não abrir

O iniciador verifica se `node.exe` está disponível e se o arquivo `windows/render-url.txt` já recebeu um endereço real. Se algum pré-requisito não estiver pronto, abre `windows/Problemas-na-Inicializacao.html` com orientações. Ele não instala o Node.js automaticamente e não deve ser executado com permissões de administrador.

**Esta versão local precisa de internet e de uma API Render publicada e configurada.** Não envie informações administrativas para uma URL que não seja sua. O visual pode ser aberto localmente, mas os dados só são confirmados depois da resposta do PostgreSQL central.
