# 👑 ORG Royal AP · Bot de Filas e Apostas (Free Fire)

Núcleo de gerenciamento de AP/X1-X4 com **15 painéis**, sala privada automática, confirmação de
regras, mediação, **PIX do mediador**, pagamento conferido, liberação de sala, resultado, W.O.,
ranking, blacklist, loja de moedas e auditoria — tudo gravado em **SQLite**.

Sem API da Garena: quem cria a sala é o host/mediador no jogo. O bot organiza, cobra e registra.

---

## 1. O que você precisa antes de rodar

| Item | Obrigatório? | Onde conseguir |
|---|---|---|
| Token do bot | ✅ | https://discord.com/developers/applications → seu app → **Bot** → Reset Token |
| Node.js 22.13+ | ✅ | No PC: nodejs.org · No celular: Termux (`pkg install nodejs`) |
| 3 cargos no servidor | recomendado | `ADM`, `Staff`, `Mediador` |
| 2 categorias no servidor | recomendado | `filas aqui` (salas de AP) e `suporte` (tickets) |
| 15 canais de AP | recomendado | Um canal para cada modo (1x1 mobile, 2x2 emu, etc.) |

O nome das categorias e dos cargos **não importa**: você informa os IDs no `.env`. Se deixar vazio,
o bot tenta achar uma categoria chamada "filas aqui".

---

## 2. Instalação (5 minutos)

```bash
# 1) entre na pasta do bot
cd bot-royal-ap

# 2) instale as dependências
npm install

# 3) abra o .env e preencha o token + IDs
#    (no celular: nano .env · salvar = CTRL+O, Enter · sair = CTRL+X)
nano .env

# 4) ligue o bot
npm start
```

Quando aparecer `✅ Conectado como ...` e `✅ 60 comandos registrados`, está no ar.

### Banco de dados: nenhum passo extra

O bot usa o **SQLite que já vem dentro do Node.js** (Node 22.13+). Não precisa compilar nada,
nem instalar banco separado. Se o `better-sqlite3` estiver instalado (é opcional), o bot usa ele
sozinho — os dois guardam o mesmo arquivo `database/royal.db`.

Se aparecer o erro **“Nenhum motor de SQLite disponível”**, atualize o Node
(`pkg update && pkg upgrade` no Termux) ou rode `npm install better-sqlite3`.

---

## 2.1 Rodar de graça no Render (Web Service)

O Render espera um site respondendo em uma porta. O bot agora abre sozinho um **servidor de saúde**
na porta que o Render mandar (`PORT`), então o aviso *“No open ports detected”* desaparece e o
serviço não entra mais em timeout.

1. Suba a pasta do bot num repositório do **GitHub**.
2. No Render: **New +** → **Web Service** → escolha o repositório.
3. Preencha:
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. Em **Environment**, cadastre as variáveis do `.env` uma por uma: `DISCORD_TOKEN`, `GUILD_ID`,
   `CATEGORIA_FILAS_ID`, `CATEGORY_TICKETS_ID`, `CARGO_ADMIN_ID`, `CARGO_STAFF_ID`,
   `CARGO_MEDIADOR_ID`, `CANAL_LOGS_ID`.
   Não precisa criar `PORT`: o Render injeta essa variável sozinho.
5. **Create Web Service**. Nos logs deve aparecer:

```
🌐 Servidor HTTP de saúde aberto na porta 10000 (Render/Docker ok)
✅ Conectado como SeuBot#1234
✅ 60 comandos registrados
```

**Teste rápido:** abra a URL do serviço (`https://seu-bot.onrender.com`) no navegador. Deve aparecer
**“Bot Royal AP Online e Operante!”**. É essa resposta 200 que mantém o Render feliz.

> Se preferir rodar no seu computador ou celular, nada muda: o servidor sobe na porta `3000`
> (`PORT=3000` no `.env` se quiser trocar) e o bot funciona igual.

### 2.2 Rodar na Discloud (bot 24h)

O repositório já tem o `discloud.config` pronto:

```
NAME=Royal AP
TYPE=bot
MAIN=index.js
VERSION=latest
RAM=100
AUTORESTART=true
```

1. Zipe a pasta **sem** `node_modules` (o `.env` pode ir dentro, mas o recomendado é usar o painel).
2. Discloud → **New App** → envie o zip.
3. Em **Variáveis**, cadastre pelo menos `DISCORD_TOKEN` (e `GUILD_ID`, `TICKET_DESTINO_ID`,
   `NIX_API_KEY`, cargos...). O bot lê tudo por `process.env`.
4. Salve e inicie. O `AUTORESTART=true` religa o bot sozinho se o processo cair.

**Por que antes ficava offline:** o bot encerrava o processo no primeiro erro de token e não
tinha nenhuma proteção de reconexão. Agora ele limpa o token (aspas/espaços/quebras de linha),
tenta o login até 5 vezes com espera crescente e, se ficar 10 minutos sem conexão, reinicia o
processo para a hospedagem subir de novo. O servidor HTTP também sobe antes do login.

> ⚠️ Nunca suba o `.env` para o GitHub: o token e a chave da Nix ficam expostos. Use sempre as
> variáveis de ambiente da hospedagem.

⚠️ **Atenção ao disco no Render gratuito:** o disco é temporário, então `database/royal.db` é
apagado a cada reinício/deploy — filas em andamento, ranking e histórico voltam do zero. Para
guardar tudo de verdade use um **Persistent Disk** (plano pago) com `DATABASE_PATH=/var/data/royal.db`,
ou continue hospedando no celular/Termux, onde o arquivo fica salvo.

### Resposta rápida (nunca mais “O aplicativo não respondeu”)

O Discord cancela qualquer comando que não responda em **3 segundos**. Por isso o bot responde
**antes** de fazer o trabalho pesado:

- Todo comando faz `deferReply` automático no despachante (`src/comandos/index.js`) — efêmero por
  padrão; `/ranking`, `/vencedor` e `/wo` respondem em público.
- A resposta final chega com `editReply`, sem deixar a mensagem “pensando” na tela.
- Botões e menus fazem `deferUpdate` na hora; o resultado vai em mensagem privada e o painel
  continua intacto. Botões que abrem modal (`regras`, `liberar`) não são adiados, porque o modal
  precisa ser a primeira resposta.
- Qualquer erro inesperado vira uma mensagem amigável em vez de tela travada.

---

## 3. O que preencher no `.env` (importante)

Só o **token** é obrigatório. O resto é para o bot saber onde criar as coisas.

| Variável | Obrigatória | Para que serve | Exemplo |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | Senha do bot | `MTIzNDU2...` |
| `CLIENT_ID` | não | ID da aplicação (o bot descobre sozinho) | `123456789012345678` |
| `GUILD_ID` | não | ID do seu servidor. **Preencha para os comandos aparecerem na hora** (vazio = global, até 1h) | `987654321098765432` |
| `DATABASE_PATH` | não | Onde fica o banco | `database/royal.db` |
| `PORT` | não | Porta do servidor de saúde (Render define sozinho) | `3000` |
| `CATEGORIA_FILAS_ID` | recomendado | **Categoria das salas de partida**: quando a fila fecha, a sala privada nasce **dentro dela** (também dá para definir com `/boombot setcategoria`) | `111222333444555666` |
| `CATEGORY_TICKETS_ID` | recomendado | **Categoria dos tickets**: todo ticket novo nasce **dentro dela**, sem mensagem no chat (também dá para definir com `/boombot setticket`) | `111222333444555777` |
| `TICKET_CATEGORIA_ID` | opcional | Nome alternativo da categoria dos tickets | `111222333444555888` |
| `TICKET_DESTINO_ID` | opcional | Compatibilidade: se receber um canal, o bot usa a categoria onde ele está | `111222333444555777` |
| `NIX_API_URL` | opcional | Endereço da API de salas da Nix | `https://salas.nixbot.vip` |
| `NIX_API_KEY` | opcional | Chave da API gerada em nixff.vip (sem ela só o `/nix` fica limitado) | `nix_sk_...` |
| `CARGO_ADMIN_ID` | recomendado | Quem manda em tudo | ID do cargo ADM |
| `CARGO_STAFF_ID` | recomendado | Staff (pode publicar painel, ver salas, usar comandos de staff) | ID do cargo Staff |
| `CARGO_MEDIADOR_ID` | **importante** | Cargo marcado quando uma sala precisa de mediador | ID do cargo Mediador |
| `CARGO_SUPORTE_ID` | recomendado | Atende os tickets (não entra nas filas de aposta) | ID do cargo Suporte |
| `CARGO_AUX_ID` | opcional | Auxiliar do atendimento (também atende tickets) | ID do cargo Auxiliar |
| `TELAGEM_LINK` | opcional | Link real do Google Meet usado em toda telagem (tem prioridade sobre o provedor) | `https://meet.google.com/abc-defg-hij` |
| `TELAGEM_LINKS` | opcional | **Pool** de links reais do Meet, separados por vírgula (cada partida reserva um) | `https://meet.google.com/abc-defg-hij,https://meet.google.com/xyz-abcd-efg` |
| `TELAGEM_PROVEDOR` | opcional | `jitsi` (padrão, sala exclusiva criada na hora) ou `google` (link no formato do Meet) | `jitsi` |
| `TELAGEM_URL_BASE` | opcional | Servidor do Jitsi (só vale com `TELAGEM_PROVEDOR=jitsi`) | `https://meet.jit.si` |
| `FREE_FIRE_LINK` | opcional | Link do botão "Abrir Free Fire" na sala liberada | `https://ff.garena.com/` |
| `CANAL_LOGS_ID` | opcional | Canal de auditoria (também dá para definir com `/logs`) | ID do canal |
| `COMISSAO_PADRAO` | não | Comissão padrão do mediador (`0.05` = 5%) | `0.05` |
| `MOEDA` | não | Nome da moeda da loja | `Royal Coin` |

**Como pegar um ID:** no Discord, Configurações → Avançado → **Modo desenvolvedor** ligado. Depois
clique com o botão direito no cargo/canal/categoria → **Copiar ID**.

### 3.1 Filas no canal atual e salas dentro da categoria

Nada de canal novo para as filas: quando a staff roda `/filasx1mobile`, `/filasx4emu` etc., o bot
publica as **15 mensagens** (uma por faixa de aposta) **no próprio canal onde o comando foi
executado** — o comando não cria canal nenhum.

Já a **sala privada da partida** (criada quando dois jogadores fecham a mesma faixa) nasce
**dentro da categoria** configurada em `CATEGORIA_FILAS_ID` (ou `/boombot setcategoria`). Sem
categoria configurada, o bot procura uma categoria de filas pelo nome antes de criar na raiz:

```
💵 R$ 100,00   ← primeira mensagem (topo)
💵 R$ 70,00
...
💵 R$ 1,00
💵 R$ 0,50     ← última mensagem (fica embaixo)
```

Cada mensagem é um card enxuto — título `1v1 Mobile | R$ 0,50` e o campo **Jogadores**
(`Nenhum jogador na fila.` ou `Gelo Normal | @jogador`) — atualizado na hora em que alguém entra
ou sai daquela faixa.

O botão **❌ Sair da fila** é dinâmico: ele não fica no card público (que é igual para todos),
aparece só na resposta efêmera de quem está naquela faixa — ninguém mais vê o botão.

### 3.2 Tickets: categoria e aviso temporário

Com `CATEGORY_TICKETS_ID` (ou `/boombot setticket destino:#sua-categoria`), o canal do ticket nasce
**dentro da categoria de atendimento** — nada de canal solto na raiz do servidor. Ao clicar em um
botão da Central de Atendimento, **nada é publicado no chat**: o jogador recebe apenas uma resposta
efêmera (só ele vê) com o link do ticket e o botão **Ignorar mensagem**, que apaga esse aviso da
tela dele.

> Se um cargo ficar vazio, o bot usa as permissões do Discord como reserva: quem tem
> **Gerenciar Servidor** é tratado como staff/ADM.

### Intents (no Developer Portal)

Menu **Bot** → **Privileged Gateway Intents** → ligue **Server Members Intent** e salve.
É usado para `/envio_massa` e para contar convites.

**Não precisa** ligar *Message Content Intent* — o bot só usa botões, menus e modais.

### Convite do bot com as permissões certas

```
https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=268692560&scope=bot%20applications.commands
```

Permissões incluídas (268692560): Ver Canais · Gerenciar Canais · Gerenciar Mensagens · Enviar
Mensagens · Inserir Links · Ler Histórico · Gerenciar Cargos (necessário para criar canal privado) ·
Mencionar Everyone · Anexar Arquivos.

---

## 4. Configuração dentro do Discord (depois de ligar o bot)

1. `/boombot setcategoria categoria:#filas aqui` — onde as salas privadas nascem.
2. `/logs canal:#logs-royal` — canal de auditoria.
3. Cada mediador roda `/registrar_pix chave:SuaChave titular:SeuNome` — **sem PIX ninguém assume sala**.
4. `/ticketfixo` no canal de atendimento — publica a Central de Atendimento permanente.
5. Publique os 15 painéis, **um em cada canal**:
   `/filasx1mobile` no canal 1x1 mobile, `/filasx2mobile` no 2x2 mobile, … `/filasx4misto` no 4x4 misto.
6. Deixe o cargo **Mediador** com acesso aos canais de AP (o bot também libera na sala criada).

> **Onde os tickets nascem:** o bot aceita **ID de categoria** ou **ID de canal de texto** em
> `TICKET_DESTINO_ID` (e nos nomes antigos `CATEGORY_TICKETS_ID` / `CATEGORIA_SUPORTE_ID`).
> Com categoria, o ticket nasce dentro dela; com canal de texto, o ticket nasce na mesma categoria
> desse canal e o bot manda o link no canal. Sem nada configurado, ele procura uma categoria com
> nome de atendimento/suporte — e **nunca** usa a categoria das filas. Também dá para trocar pelo
> Discord com `/boombot setticket destino:#categoria-ou-canal`.

---

## 5. Como funciona um AP

1. **Jogador** escolhe a faixa no menu do painel (R$ 0,50 até R$ 100,00) e o tipo de gelo.
2. Quando o grupo fecha (2 jogadores no 1x1, 8 no 4x4…), o bot limpa a fila do painel e **cria a
   sala privada** (`#fila-gelo-normal-001`, `#fila-gelo-normal-002`…) **dentro da categoria de
   filas**, só com os jogadores + mediadores/ADM.
3. A sala nasce com o card **⏳ Aguardando · 1v1 Mobile Gelo Normal** — aposta, premiação e os
   jogadores numerados — e os botões **Confirmar Partida** e **Cancelar**.
4. Cada confirmação aparece no chat da sala: *“✅ @Jogador1 confirmou a partida. Agora falta apenas
   @Jogador2 para confirmar.”* e, na segunda, *“Todos confirmaram! Partida iniciando...”* — marcando
   só **@MEDIADOR / @ADM** (o atendimento de tickets não é chamado em partida).
5. O bot marca o cargo Mediador. Um mediador clica em **👑 Assumir sala**.
6. **💸 Liberar PIX** (botão) ou **`/pix`** na sala → a chave PIX **daquele mediador** aparece na
   sala e na DM dos jogadores. Ele confere os comprovantes e clica em **✅ Pagamento recebido**.
7. **🎮 Criar sala (Nix)** → a API cria a sala no jogo e o bot publica **ID, senha e um botão para
   abrir o Free Fire** direto no canal da fila (onde as 15 mensagens foram publicadas).
8. Os dois jogadores entram na sala do Free Fire e cada um digita **`/go`** no canal da partida. No
   segundo GO o bot anuncia *“Os dois jogadores estão prontos! A partida irá iniciar em 3 segundos.”*
   e a partida passa para **em andamento**.
9. Fim da partida: **🏆 Equipe 1/2 venceu** (ou **⚠️ W.O.**). O bot atualiza estatísticas, ranking,
   comissão do mediador e auditoria.

Estados da sala: `confirmando` → `aguardando_mediador` → `aguardando_pagamento` → `pago` →
`sala_liberada` → `em_andamento` → `finalizada` / `cancelada`. O painel da sala se atualiza sozinho
em cada etapa.

### 5.4 Início rápido com `/go`

Depois que o mediador publica o ID e a senha, os jogadores entram na sala personalizada do Free Fire
e **cada um digita `/go` no canal privado da partida**:

- o primeiro `/go` só registra e avisa no canal (*“O jogador @X deu GO na sala!”*);
- o segundo `/go` dispara *“Os dois jogadores estão prontos! A partida irá iniciar em 3 segundos.”*
  e a partida vai para **em andamento**;
- `/go` repetido não conta duas vezes;
- o comando aceita ser digitado **no canal da fila**: o bot encontra a partida ativa do jogador e
  anuncia **só no canal privado** daquela partida;
- se a sala foi criada pelo bot (botão **Criar sala (Nix)**), o segundo `/go` chama a API da Nix e
  **inicia a sala na hora**, sem esperar os 10 minutos do `start_delay`.

Se o nome do jogador não aparecer no painel depois de entrar, o painel é **republicado sozinho**
quando as mensagens antigas foram apagadas ou pertencem a outra instância do bot. Se persistir, dê
ao bot **Ver canal**, **Enviar mensagens** e **Gerenciar mensagens** no canal da fila e rode o
comando de painel uma vez.

### 5.1 Telagem (call para a triagem)

Quem tem um dos **cargos configurados no `/mediadores`** (Mediador ou ADM) usa **`/criar_telagem`**
em qualquer canal. O código é **exclusivo por canal/partida** (o mesmo canal sempre reaproveita a
mesma sala; canais diferentes nunca dividem a call) e o painel **✅ Sala de Telagem Criada** mostra
código, plataforma, URL e o botão **Entrar na Call**.

**Pool de links reais do Meet:** cadastre links oficiais com `/telagem_links adicionar`
(`/telagem_links listar` mostra o pool e as salas em uso) ou informe vários de uma vez em
`TELAGEM_LINKS`, separados por vírgula. Cada partida **reserva um link ainda livre** e ele fica
fixo no canal; quando a partida termina, o link volta para o pool. Se todos estiverem em uso, o bot
avisa para adicionar mais — nenhuma partida divide a call com outra.

Provedores (`TELAGEM_PROVEDOR`):

- `jitsi` (padrão): `https://meet.jit.si/royal-ap-<código>` — a sala é criada **na hora** em que o
  link é aberto, então nunca aparece "reunião inexistente" e funciona no navegador do Android/iOS.
- `google`: `https://meet.google.com/<código>` — formato oficial do Meet. O Google **não cria sala
  por API**, então para garantir que a reunião exista use `TELAGEM_LINK` com um link real do Meet
  ou passe `/criar_telagem link:https://meet.google.com/...`.

### 5.2 Mediação: plantão, cargos e PIX individual

1. **`/mediadores`** (só ADM) abre o **Módulo de Mediadores**: escolha os **cargos** que atuam como
   mediador, o **canal do plantão** (bate-ponto) e o **canal de cadastro** (PIX). Os menus salvam na
   hora; **Modo: Rodízio** alterna o modo e **Limpar Fila** zera o plantão.
2. **`/painel_mediadores tipo:fila`** publica e fixa o painel **👤 Fila de Mediadores** no canal
   atual, com **Entrar**, **Sair**, **Atualizar** e **Config**. Quem está no plantão fica na ordem
   de chamada.
3. **`/painel_mediadores tipo:registro`** publica a **💳 Central de Pagamentos: Mediadores**. O
   mediador clica em **Configurar Pix** e cadastra **chave, nome completo e cidade** (modal, só ele
   vê). **Verificar Cadastro** mostra o que já está salvo.

Quando o mediador assume uma sala e clica em **Liberar PIX**, o bot usa a chave **individual** dele
(nada de chave compartilhada), manda na sala e na DM dos jogadores. A criação da sala do jogo usa a
API da Nix (`NIX_API_KEY`).

> Separação de responsabilidades: **mediadores/ADM** atuam nas filas de aposta; **Suporte/Auxiliar**
> (`CARGO_SUPORTE_ID`, `CARGO_AUX_ID`) atendem os tickets. As menções de partida usam só
> mediador/ADM, e o canal do ticket é liberado só para o atendimento.

### 5.3 Placar

**`/verp @jogador`** mostra o placar público: **vitórias**, **derrotas** (com W.O.), aproveitamento,
posição no ranking, total apostado e prêmios. Quem vence ganha **+1 vitória**; quem perde ganha
**+1 derrota** — na hora, sem ajuste manual.

---

## 6. Comandos (60)

**Painéis de AP (15)** — publicam o painel no canal atual (cards de R$ 0,50 a R$ 100,00):

`/filasx1mobile` `/filasx2mobile` `/filasx3mobile` `/filasx4mobile`
`/filasx1fullcapa` `/filasx2fullcapa` `/filasx3fullcapa` `/filasx4fullcapa`
`/filasx1emu` `/filasx2emu` `/filasx3emu` `/filasx4emu`
`/filasx2misto` `/filasx3misto` `/filasx4misto`

Cada painel publica **15 mensagens** (uma por faixa), do **R$ 100,00 no topo** ao **R$ 0,50 no fundo**, e os botões mudam conforme a categoria do canal:

| Categoria | Botões do card |
|---|---|
| Mobile | 🧊 Gelo Infinito · 🧊 Gelo Normal · ❓ Como funciona |
| Emulador | ✔️ Normal · 🔫 Full UMP e XM8 · ❓ Como funciona |
| Full Capa | 🎯 Full Capa · ❓ Como funciona |
| Misto 2x2 | 🎮 1 Emu |
| Misto 3x3 | 🎮 1 Emu · 🎮 2 Emu |
| Misto 4x4 | 🎮 1 Emu · 🎮 2 Emu · 🎮 3 Emu |

O **Sair** não fica nesse card público: ele aparece na resposta efêmera de quem está na fila daquela faixa.

O ranking **não** fica dentro dos painéis: é o comando separado `/ranking`.

**ADM · perfil do bot** — `/botperfil` (atalho `/setbot`) abre um painel só para ADM com botões para
trocar **nome**, **avatar** (link da imagem), **descrição/sobre mim** e **status** do bot pelo próprio
Discord, sem abrir o Developer Portal.

**Jogador**

| Comando | Para que serve |
|---|---|
| `/perfil [usuario]` | Vitórias, derrotas, aproveitamento, moedas, giros, posição, convites |
| `/verp [usuario]` | Placar público de vitórias/derrotas e posição no ranking |
| `/ranking [tipo]` | Top 10 por vitórias, moedas ou giros |
| `/apostas [usuario]` | Histórico das últimas apostas |
| `/convites [usuario]` | Ranking de convites |
| `/go` | Avisa no canal da partida que você já está na sala do Free Fire |
| `/ajuda` | Explica o fluxo e os comandos |
| `/aux` | Reservado: só avisa para usar `/ticket` |
| `/ticket` | Central de Atendimento só para você, que se apaga em 15 segundos |
| `/ticketfixo` | Publica a Central de Atendimento fixa no canal (só ADM) |
| `/ssmob` `/ssemu` `/temu` | Regras de mobile/emulador e ferramentas |
| `/nix status\|jogador\|criarsala\|iniciar\|statussala\|chutar\|liberar\|resultado` | Salas automáticas de Free Fire pela API da Nix FF |

**Staff / mediador**

| Comando | Para que serve |
|---|---|
| `/registrar_pix chave: [titular:] [comissao:]` | Salva sua chave PIX de mediador |
| `/pix` | Envia sua chave PIX — funciona em qualquer canal do servidor |
| `/painel_mediador` | Painel de controle da moderação |
| `/criar_telagem [link:]` | Telagem exclusiva do canal; exige cargo de mediador/ADM |
| `/telagem_links adicionar\|remover\|listar\|limpar` | Gerencia o pool de links reais do Google Meet (só ADM) |
| `/mediadores` | Módulo de configuração: cargos, canal do plantão e canal do PIX (só ADM) |
| `/painel_mediadores tipo:fila\|registro` | Publica e fixa o painel de plantão ou o de PIX (só ADM) |
| `/vencedor time: [partida:]` | Declara o vencedor e fecha a aposta |
| `/wo ausente: [partida:]` | Aplica W.O. |
| `/receita_mediadores [dias:]` | Relatório de comissões |
| `/analista` | Volume, ticket médio, modos que mais fecham |
| `/blacklist adicionar\|listar\|remover` | Lista negra |
| `/anunciar titulo: mensagem: [canal:]` | Anúncio formatado |
| `/anunciar2 texto:` | Anúncio com o mesmo embed do `/anunciar`, só com o texto |
| `/conectarbotcall canal:` | Coloca o bot na call de voz escolhida |
| `/tirarbotcall` | Desconecta o bot da call |
| `/enviar_dm usuario: mensagem:` | DM pelo bot (com registro) |
| `/limpar quantidade:` | Apaga mensagens do canal |
| `/addvitoria` `/vitoria` `/addgiros` | Ajustes manuais de perfil |
| `/loja addcoins\|removecoins\|enviar` | Moedas da loja |
| `/logs [canal:]` | Canal de auditoria / últimas ações |
| `/painel` | Painel geral de controle |
| `/boombot status\|setlog\|setcategoria` | Saúde e configuração do bot |
| `/conectar` `/desconectar` | Integrações/APIs externas |
| `/envio_massa mensagem: confirmar:` | DM para todos (com confirmação) |
| `/limpardm usuario:` | Apaga histórico de DMs com um jogador |

---

## 7. Estrutura do código

```
index.js                      → entrada: valida .env, abre banco, conecta
src/config.js                 → 15 modos, 14 faixas de preço, botões por categoria
src/servidor.js               → servidor HTTP de saúde (porta do Render)
src/db/esquema.js             → esquema SQLite (12 tabelas)
src/db/index.js               → conexão, criação e configurações por servidor
src/util/embeds.js            → embeds, formatação de R$, datas
src/util/seguranca.js         → permissões (ADM/Staff/Mediador) e respostas seguras
src/servicos/usuarios.js      → perfil, moedas, giros, estatísticas
src/servicos/staff.js         → PIX, comissão, relatório de receita
src/servicos/filas.js         → entrar/sair/listar/reservar grupo (transação)
src/servicos/partidas.js      → criação, regras, mediação, pagamento, resultado
src/servicos/paineis.js       → embed + menu + botões de gelo
src/servicos/fluxo.js         → fluxo do AP, canal privado e envio do PIX
src/servicos/tickets.js       → Central de Atendimento (5 setores e boas-vindas)
src/servicos/auditoria.js     → log no banco + canal de logs
src/servicos/blacklist.js     → lista negra
src/servicos/convites.js      → contagem de convites
src/comandos/*.js             → comandos separados por área
src/interacoes/*.js           → botões, menus e modais
src/eventos/index.js          → conexão, interações, convites, erros
testes/rodar.js               → testes offline (npm test)
```

Todo clique e todo comando roda dentro de `try/catch`: um erro numa interação nunca derruba o bot —
ele responde "deu um erro aqui", registra na auditoria e continua online.

---

## 8. Testar sem Discord

```bash
npm test
```

Os testes criam um banco temporário e um Discord falso em memória. Cobrem: esquema do banco, moedas e
giros, fila (entrada, saída, reserva atômica), partida completa (regras → mediador → pagamento →
sala → resultado), comissão, W.O., cancelamento, blacklist, painéis, os 15 modos, os 60 comandos, o `/go`, os tickets, o servidor HTTP e
os handlers de `/registrar_pix`, `/ajuda`, `/perfil`, `/loja`, `/pix` e `/boombot`.

---

## 9. Banco de dados e backup

Tudo fica em `database/royal.db` (o bot cria a pasta). Para backup, copie esse arquivo com o bot
desligado (ou copie também `royal.db-wal` e `royal.db-shm` se ele estiver rodando).

Não apague o `database/` se quiser manter ranking, apostas, PIX e auditoria.

---

## 10. Deixar 24h online

Funciona em qualquer máquina com Node 18+: PC ligado, VPS, ou hospedagem de bot (Discloud e
similares). Suba a pasta **sem** `node_modules` e **sem** `.env` (nessas hospedagens o token vai como
variável de ambiente; se precisar, inclua o `.env` só com o token).

No Termux, use `termux-wake-lock` antes de `npm start` para o Android não pausar o processo.

---

## 11. Problemas comuns

| Problema | Solução |
|---|---|
| `Configuração incompleta` | Falta o `DISCORD_TOKEN` no `.env` |
| `Token inválido` | Gere outro (Reset Token) e cole numa linha só |
| `O bot precisa do intent de membros ligado` | Developer Portal → Bot → **Server Members Intent** |
| Comando não aparece | Confira `GUILD_ID` no `.env` e reinicie; ou espere a propagação global |
| `não consegui criar a sala privada` | Dê ao bot **Gerenciar Canais** e **Gerenciar Cargos**, e defina a categoria com `/boombot setcategoria` |
| Mediador não consegue assumir | Ele precisa de cargo de staff/mediador **e** `/registrar_pix` |
| PIX não aparece | O mediador precisa ter rodado `/registrar_pix`; o botão só funciona para quem assumiu |
| Ranking zerado | Confira se est�� rodando na mesma pasta onde está `database/royal.db` |
| `Nenhum motor de SQLite disponível` | Atualize o Node para 22.13+ ou rode `npm install better-sqlite3` |
| `/envio_massa` não acha membros | Server Members Intent ligado + reiniciar o bot |

---

## 12. Aviso importante

Apostas com dinheiro real são responsabilidade do servidor. O bot **não processa pagamento nenhum**:
ele só mostra a chave PIX que o mediador cadastrou e registra o que a staff confirmou. Combine as
regras, taxas e punições com a ORG e deixe tudo escrito nos canais de regras.
