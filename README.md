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

Quando aparecer `✅ Conectado como ...` e `✅ 48 comandos registrados`, está no ar.

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
   `CATEGORIA_FILAS_ID`, `CATEGORIA_SUPORTE_ID`, `CARGO_ADMIN_ID`, `CARGO_STAFF_ID`,
   `CARGO_MEDIADOR_ID`, `CANAL_LOGS_ID`.
   Não precisa criar `PORT`: o Render injeta essa variável sozinho.
5. **Create Web Service**. Nos logs deve aparecer:

```
🌐 Servidor HTTP de saúde aberto na porta 10000 (Render/Docker ok)
✅ Conectado como SeuBot#1234
✅ 48 comandos registrados
```

**Teste rápido:** abra a URL do serviço (`https://seu-bot.onrender.com`) no navegador. Deve aparecer
**“Bot Royal AP Online e Operante!”**. É essa resposta 200 que mantém o Render feliz.

> Se preferir rodar no seu computador ou celular, nada muda: o servidor sobe na porta `3000`
> (`PORT=3000` no `.env` se quiser trocar) e o bot funciona igual.

⚠️ **Atenção ao disco no Render gratuito:** o disco é temporário, então `database/royal.db` é
apagado a cada reinício/deploy — filas em andamento, ranking e histórico voltam do zero. Para
guardar tudo de verdade use um **Persistent Disk** (plano pago) com `DATABASE_PATH=/var/data/royal.db`,
ou continue hospedando no celular/Termux, onde o arquivo fica salvo.

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
| `CATEGORIA_FILAS_ID` | recomendado | Categoria onde as salas privadas de AP são criadas | `111222333444555666` |
| `CATEGORIA_SUPORTE_ID` | opcional | Categoria dos tickets (`/aux`) | `111222333444555777` |
| `CARGO_ADMIN_ID` | recomendado | Quem manda em tudo | ID do cargo ADM |
| `CARGO_STAFF_ID` | recomendado | Staff (pode publicar painel, ver salas, usar comandos de staff) | ID do cargo Staff |
| `CARGO_MEDIADOR_ID` | **importante** | Cargo marcado quando uma sala precisa de mediador | ID do cargo Mediador |
| `CANAL_LOGS_ID` | opcional | Canal de auditoria (também dá para definir com `/logs`) | ID do canal |
| `COMISSAO_PADRAO` | não | Comissão padrão do mediador (`0.05` = 5%) | `0.05` |
| `MOEDA` | não | Nome da moeda da loja | `Royal Coin` |

**Como pegar um ID:** no Discord, Configurações → Avançado → **Modo desenvolvedor** ligado. Depois
clique com o botão direito no cargo/canal/categoria → **Copiar ID**.

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

---

## 5. Como funciona um AP

1. **Jogador** escolhe a faixa no menu do painel (R$ 0,50 até R$ 100,00) e o tipo de gelo.
2. Quando o grupo fecha (2 jogadores no 1x1, 8 no 4x4…), o bot **cria a sala privada** na categoria
   de filas, só com os jogadores + staff.
3. Um jogador clica em **📜 Enviar regra** e escreve a regra; todos clicam em **✅ Confirmar Regras**.
4. O bot marca o cargo Mediador. Um mediador clica em **👑 Assumir sala**.
5. **💸 Enviar PIX** (botão) ou **`/pix`** na sala → a chave cadastrada aparece na sala e na DM dos
   jogadores. O mediador confere os comprovantes e clica em **✅ Pagamento recebido**.
6. **🎮 Liberar sala** → o mediador digita ID e senha; o bot publica para os jogadores.
7. Fim da partida: **🏆 Equipe 1/2 venceu** (ou **⚠️ W.O.**). O bot atualiza estatísticas, ranking,
   comissão do mediador e auditoria.

Estados da sala: `confirmando` → `aguardando_mediador` → `aguardando_pagamento` → `pago` →
`sala_liberada` → `finalizada` / `cancelada`. O painel da sala se atualiza sozinho em cada etapa.

---

## 6. Comandos (48)

**Painéis de AP (15)** — publicam o painel no canal atual (cards de R$ 0,50 a R$ 100,00):

`/filasx1mobile` `/filasx2mobile` `/filasx3mobile` `/filasx4mobile`
`/filasx1fullcapa` `/filasx2fullcapa` `/filasx3fullcapa` `/filasx4fullcapa`
`/filasx1emu` `/filasx2emu` `/filasx3emu` `/filasx4emu`
`/filasx2misto` `/filasx3misto` `/filasx4misto`

Cada painel mostra **14 cards**, do **R$ 0,50 no topo** ao **R$ 100,00 no fundo**, e os botões mudam conforme a categoria do canal:

| Categoria | Botões do card |
|---|---|
| Mobile | 🧊 Gelo Infinito · 🧊 Gelo Normal · ❌ Sair · ❓ Como funciona |
| Emulador | ✔️ Normal · 🔫 Full UMP e XM8 · ❌ Sair · ❓ Como funciona |
| Full Capa | 🎯 Full Capa · ❌ Sair · ❓ Como funciona |
| Misto 2x2 | 🎮 1 Emu · ❌ Sair |
| Misto 3x3 | 🎮 1 Emu · 🎮 2 Emu · ❌ Sair |
| Misto 4x4 | 🎮 1 Emu · 🎮 2 Emu · 🎮 3 Emu · ❌ Sair |

O ranking **não** fica dentro dos painéis: é o comando separado `/ranking`.

**Jogador**

| Comando | Para que serve |
|---|---|
| `/perfil [usuario]` | Vitórias, derrotas, aproveitamento, moedas, giros, posição, convites |
| `/ranking [tipo]` | Top 10 por vitórias, moedas ou giros |
| `/apostas [usuario]` | Histórico das últimas apostas |
| `/convites [usuario]` | Ranking de convites |
| `/ajuda` | Explica o fluxo e os comandos |
| `/aux` | Reservado: só avisa para usar `/ticket` |
| `/ticket` | Central de Atendimento só para você, que se apaga em 15 segundos |
| `/ticketfixo` | Publica a Central de Atendimento fixa no canal (só ADM) |
| `/ssmob` `/ssemu` `/temu` | Regras de mobile/emulador e ferramentas |

**Staff / mediador**

| Comando | Para que serve |
|---|---|
| `/registrar_pix chave: [titular:] [comissao:]` | Salva sua chave PIX de mediador |
| `/pix` | Envia sua chave na sala do AP que você está mediando |
| `/painel_mediador` | Painel de controle da moderação |
| `/vencedor time: [partida:]` | Declara o vencedor e fecha a aposta |
| `/wo ausente: [partida:]` | Aplica W.O. |
| `/receita_mediadores [dias:]` | Relatório de comissões |
| `/analista` | Volume, ticket médio, modos que mais fecham |
| `/blacklist adicionar\|listar\|remover` | Lista negra |
| `/anunciar titulo: mensagem: [canal:]` | Anúncio formatado |
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
sala → resultado), comissão, W.O., cancelamento, blacklist, painéis, os 15 modos, os 48 comandos, os tickets, o servidor HTTP e
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
| Ranking zerado | Confira se está rodando na mesma pasta onde está `database/royal.db` |
| `Nenhum motor de SQLite disponível` | Atualize o Node para 22.13+ ou rode `npm install better-sqlite3` |
| `/envio_massa` não acha membros | Server Members Intent ligado + reiniciar o bot |

---

## 12. Aviso importante

Apostas com dinheiro real são responsabilidade do servidor. O bot **não processa pagamento nenhum**:
ele só mostra a chave PIX que o mediador cadastrou e registra o que a staff confirmou. Combine as
regras, taxas e punições com a ORG e deixe tudo escrito nos canais de regras.
