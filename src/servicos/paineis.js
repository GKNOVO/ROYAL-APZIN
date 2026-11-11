'use strict';

/**
 * Filas de AP: UMA MENSAGEM POR FAIXA DE APOSTA (15 mensagens no canal).
 *
 * Ordem de envio: do MAIOR preço para o MENOR. No Discord a mensagem mais nova
 * fica embaixo, então a faixa mais barata (R$ 0,50) é a última mensagem do
 * canal e os valores vão subindo conforme você rola para cima — exatamente o
 * layout combinado com a ORG.
 *
 * O comando `/filas…` publica as 15 mensagens no canal onde foi executado —
 * NÃO cria canal. Quem cria canal é o matchmaking: quando a fila fecha, a sala
 * privada da partida nasce DENTRO da categoria configurada (CATEGORIA_FILAS_ID
 * no .env ou `/boombot setcategoria`).
 */

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const config = require('../config');
const { obterConfig } = require('../db');
const { embed, reais, mencao, tituloCurto, listaUsuarios } = require('../util/embeds');
const filasServico = require('./filas');

/** Preços do maior para o menor: é essa a ordem em que as mensagens saem. */
const PRECOS_ENVIO = [...config.PRECOS].sort((a, b) => b - a);

/** Linhas de cada tipo de entrada (gelo/categoria) com os jogadores na fila. */
function linhasDeEntrada(modo, preco, entradas) {
  const doPreco = entradas.filter((linha) => Number(linha.preco) === Number(preco));
  const variantes = config.variantesDoModo(modo).map((variante) => {
    const ids = doPreco.filter((linha) => linha.gelo === variante.id).map((linha) => linha.user_id);
    return `${variante.emoji} **${variante.nome}** (${ids.length}/${config.CAPITAES_POR_PARTIDA} capitães): ${listaUsuarios(ids)}`;
  });
  return { doPreco, variantes };
}

/** Card de um valor (usado no painel antigo, de uma mensagem só). */
function linhaDePreco(modo, preco, entradas) {
  const { doPreco, variantes } = linhasDeEntrada(modo, preco, entradas);
  return {
    name: `💵 ${reais(preco)} · ${doPreco.length} na fila`,
    value: variantes.join('\n') || 'Nenhum jogador na fila.',
    inline: false,
  };
}

/** Painel antigo (todos os valores em um embed) — mantido para compatibilidade. */
function embedPainel(modo, entradas = []) {
  return embed(`🎯 AP ${modo.titulo}`, [
    `**Modo:** ${modo.titulo}   ·   **Abre com:** ${config.CAPITAES_POR_PARTIDA} capitães (1 por time) · formato ${modo.time}x${modo.time}`,
    `**Cards:** de ${reais(config.PRECOS[0])} (topo) até ${reais(config.PRECOS[config.PRECOS.length - 1])} (fundo).`,
    '',
    '**Como entrar:** escolha o valor no menu abaixo e depois o botão da sua categoria.',
    'Quando os 2 capitães entram, o bot abre uma **sala privada** com a regra, o mediador e o PIX.',
  ].join('\n'), {
    cor: config.CORES.principal,
    campos: config.PRECOS.map((preco) => linhaDePreco(modo, preco, entradas)),
    rodape: `ORG Royal AP · ${entradas.length} jogador(es) na fila`,
  });
}

/** Menu com todos os valores + Sair + Como funciona (ranking é comando separado). */
function componentesPainel(modo) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ap:preco:${modo.id}`)
    .setPlaceholder('Escolha a faixa de aposta…')
    .addOptions(
      config.PRECOS.map((preco) => ({
        label: reais(preco),
        value: String(preco),
        description: `AP ${modo.titulo} · 2 capitães (1 por time)`,
      })),
    );

  const botoes = [
    new ButtonBuilder()
      .setCustomId(`ap:sair:${modo.id}:todos`)
      .setLabel('Sair da Fila')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  ];
  if (config.mostrarComoFunciona(modo)) {
    botoes.push(
      new ButtonBuilder()
        .setCustomId('ap:como')
        .setLabel('Como funciona')
        .setEmoji('❓')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  return [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(...botoes)];
}

/**
 * Botões do card, conforme a categoria do canal:
 *  mobile   → Gelo Infinito · Gelo Normal · Como funciona · Sair
 *  emu      → Normal · Full UMP e XM8 · Como funciona · Sair
 *  fullcapa → Full Capa · Como funciona · Sair
 *  misto    → 1 Emu (2 Emu, 3 Emu conforme o time) · Sair  (sem "Como funciona")
 */
function componentesEntrada(modo, preco, opcoes = {}) {
  const estilos = [ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Secondary];
  const botoes = config.variantesDoModo(modo).map((variante, indice) =>
    new ButtonBuilder()
      .setCustomId(`ap:entrar:${modo.id}:${preco}:${variante.id}`)
      .setLabel(variante.nome)
      .setEmoji(variante.emoji)
      .setStyle(estilos[indice] || ButtonStyle.Secondary),
  );

  if (config.mostrarComoFunciona(modo)) {
    botoes.push(
      new ButtonBuilder()
        .setCustomId('ap:como')
        .setLabel('Como funciona')
        .setEmoji('❓')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  // "Sair da fila" entra na MESMA linha do card, ao lado de "Como funciona",
  // e só na faixa que tem jogador. Quando a faixa esvazia, o botão some.
  if (opcoes.sair) botoes.push(botaoSair(modo, preco));

  return [new ActionRowBuilder().addComponents(...botoes)];
}

/** Botão "Sair" de uma faixa (o card mostra só quando a faixa tem jogador). */
function botaoSair(modo, preco) {
  return new ButtonBuilder()
    .setCustomId(`ap:sair:${modo.id}:${preco}`)
    .setLabel('Sair da fila')
    .setEmoji('❌')
    .setStyle(ButtonStyle.Danger);
}

/** Linha pronta com o "Sair" para a resposta efêmera de quem entrou. */
function linhaSair(modo, preco) {
  return new ActionRowBuilder().addComponents(botaoSair(modo, preco));
}

/** Jogadores de uma faixa no formato limpo: "Gelo Normal | <@id>". */
function jogadoresDaFaixa(modo, preco, entradas = []) {
  return entradas
    .filter((linha) => Number(linha.preco) === Number(preco))
    .map((linha) => `${config.varianteDoModo(modo, linha.gelo)?.nome ?? linha.gelo} | ${mencao(linha.user_id)}`);
}

/**
 * UMA mensagem da fila: card minimalista com o título do modo + valor e o
 * campo Jogadores. Sem textão explicativo e sem rodapé pesado.
 */
function mensagemPreco(modo, preco, entradas = []) {
  const jogadores = jogadoresDaFaixa(modo, preco, entradas);

  return {
    embeds: [
      embed(`${tituloCurto(modo)} | ${reais(preco)}`, null, {
        cor: config.CORES.principal,
        campos: [
          {
            name: 'Jogadores',
            value: jogadores.length ? jogadores.join('\n') : 'Nenhum jogador na fila.',
            inline: false,
          },
        ],
      }),
    ],
    components: componentesEntrada(modo, preco, { sair: jogadores.length > 0 }),
  };
}

/**
 * As 15 mensagens da fila, na ordem de envio:
 * R$ 100,00 primeiro (topo) … R$ 0,50 por último (fica embaixo).
 */
function mensagensFila(modo, entradas = []) {
  return PRECOS_ENVIO.map((preco) => ({ preco, payload: mensagemPreco(modo, preco, entradas) }));
}

/** Painel antigo completo (uma mensagem só). */
function mensagemPainel(modo, entradas) {
  return { embeds: [embedPainel(modo, entradas)], components: componentesPainel(modo) };
}

function salvar(db, { guildId, modo, canalId, mensagemId }) {
  db.prepare(
    `INSERT INTO paineis (guild_id, modo, canal_id, mensagem_id, criado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, modo) DO UPDATE
       SET canal_id = excluded.canal_id, mensagem_id = excluded.mensagem_id, criado_em = excluded.criado_em`,
  ).run(String(guildId), String(modo), String(canalId), String(mensagemId), Date.now());
}

/** Grava a fila inteira: uma linha por faixa de preço. */
function salvarFila(db, { guildId, modo, canalId, mensagens }) {
  const executar = db.transaction(() => {
    db.prepare('DELETE FROM mensagens_painel WHERE guild_id = ? AND modo = ?').run(String(guildId), String(modo));
    const inserir = db.prepare(
      `INSERT INTO mensagens_painel (guild_id, modo, preco, canal_id, mensagem_id, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const agora = Date.now();
    for (const linha of mensagens) {
      inserir.run(
        String(guildId),
        String(modo),
        Math.trunc(linha.preco),
        String(canalId),
        String(linha.mensagemId),
        agora,
      );
    }
    salvar(db, { guildId, modo, canalId, mensagemId: String(mensagens[0]?.mensagemId ?? '') });
  });
  return executar();
}

/** Mensagens salvas, do maior preço para o menor (mesma ordem do canal). */
function mensagensSalvas(db, { guildId, modo }) {
  return db
    .prepare('SELECT * FROM mensagens_painel WHERE guild_id = ? AND modo = ? ORDER BY preco DESC')
    .all(String(guildId), String(modo));
}

function obter(db, { guildId, modo }) {
  return (
    db
      .prepare('SELECT * FROM paineis WHERE guild_id = ? AND modo = ?')
      .get(String(guildId), String(modo)) || null
  );
}

function todos(db, guildId) {
  return db.prepare('SELECT * FROM paineis WHERE guild_id = ?').all(String(guildId));
}

/**
 * Apaga mensagens do painel anterior que ainda existem no canal.
 * Só apaga o que o próprio bot enviou — mensagem de outro bot fica intocada.
 */
async function apagarMensagens(canal, antigas = [], manter = new Set()) {
  if (!canal?.messages?.fetch) return 0;
  let apagadas = 0;
  for (const linha of antigas) {
    if (String(linha.canal_id) !== String(canal.id)) continue;
    if (manter.has(String(linha.mensagem_id))) continue;
    try {
      const mensagem = await canal.messages.fetch(linha.mensagem_id).catch(() => null);
      if (!mensagem?.delete) continue;
      const autor = mensagem.author?.id;
      const eu = canal.client?.user?.id;
      if (autor && eu && autor !== eu) continue; // painel de outro bot: não mexe
      await mensagem.delete();
      apagadas += 1;
    } catch {
      /* mensagem já apagada ou sem permissão: segue o jogo */
    }
  }
  return apagadas;
}

/**
 * Envia as 15 mensagens da fila no canal e guarda os IDs no banco.
 * Antes de salvar, guarda o conjunto antigo e apaga essas mensagens depois —
 * assim publicar o painel de novo não deixa 15 mensagens velhas no canal.
 */
async function publicarFila(db, canal, { guildId, modo, entradas = [] }) {
  const antigas = mensagensSalvas(db, { guildId, modo: modo.id });
  const enviadas = [];
  for (const { preco, payload } of mensagensFila(modo, entradas)) {
    const mensagem = await canal.send(payload);
    enviadas.push({ preco, mensagemId: mensagem.id });
  }
  salvarFila(db, { guildId, modo: modo.id, canalId: canal.id, mensagens: enviadas });
  await apagarMensagens(canal, antigas, new Set(enviadas.map((linha) => String(linha.mensagemId))));
  return enviadas;
}

/**
 * Redesenha as mensagens da fila (todas ou só a faixa informada).
 *
 * Se NENHUMA mensagem puder ser editada (ID antigo, mensagem apagada ou painel
 * publicado por outro bot/token), o painel é republicado na hora e os novos
 * IDs são gravados — é isso que faz a fila voltar a mostrar os jogadores sem
 * precisar rodar o comando de painel de novo.
 */
async function atualizar(client, db, { guildId, modo, preco = null }) {
  const modoInfo = config.modoPorId(modo);
  if (!modoInfo) return false;

  const entradas = filasServico.listar(db, { guildId, modo: modoInfo.id });
  const linhas = mensagensSalvas(db, { guildId, modo: modoInfo.id });

  if (linhas.length) {
    const filtradas =
      preco === null || preco === undefined
        ? linhas
        : linhas.filter((linha) => Number(linha.preco) === Number(preco));
    // Faixa nova sem linha salva: atualiza o painel inteiro em vez de não fazer nada.
    const alvo = filtradas.length ? filtradas : linhas;
    let editadas = 0;
    const problemas = [];

    for (const linha of alvo) {
      try {
        const canal =
          client.channels.cache.get(linha.canal_id) || (await client.channels.fetch(linha.canal_id));
        if (!canal) {
          problemas.push(`canal ${linha.canal_id} não encontrado`);
          continue;
        }
        const mensagem = await canal.messages.fetch(linha.mensagem_id).catch(() => null);
        if (!mensagem) {
          problemas.push(`mensagem ${linha.mensagem_id} apagada`);
          continue;
        }
        if (client.user?.id && mensagem.author?.id && mensagem.author.id !== client.user.id) {
          problemas.push(`mensagem ${linha.mensagem_id} é de outro bot`);
          continue;
        }
        await mensagem.edit(mensagemPreco(modoInfo, Number(linha.preco), entradas));
        editadas += 1;
      } catch (erro) {
        problemas.push(erro.message);
        console.error(`[paineis] não consegui atualizar ${reais(Number(linha.preco))}:`, erro.message);
      }
    }
    if (editadas > 0) return true;

    const canalId = alvo[0]?.canal_id ?? linhas[0].canal_id;
    let canal = null;
    try {
      canal = client.channels.cache.get(canalId) || (await client.channels.fetch(canalId));
    } catch (erro) {
      problemas.push(erro.message);
    }
    if (!canal?.send) {
      console.error(
        `[paineis] painel ${modoInfo.id} sem edição e sem canal para republicar (${problemas.slice(0, 2).join(' | ')})`,
      );
      return false;
    }

    console.warn(
      `[paineis] painel ${modoInfo.id} será republicado (${problemas.slice(0, 2).join(' | ') || 'nada editado'})`,
    );
    try {
      const enviadas = await publicarFila(db, canal, { guildId, modo: modoInfo, entradas });
      return enviadas.length > 0;
    } catch (erro) {
      console.error(`[paineis] não consegui republicar o painel ${modoInfo.id}:`, erro.message);
      return false;
    }
  }

  // Compatibilidade: painel antigo, com todos os cards em uma mensagem só.
  const painel = obter(db, { guildId, modo: modoInfo.id });
  if (!painel) return false;
  try {
    const canal =
      client.channels.cache.get(painel.canal_id) || (await client.channels.fetch(painel.canal_id));
    if (!canal) return false;
    const mensagem = await canal.messages.fetch(painel.mensagem_id).catch(() => null);
    if (mensagem) {
      await mensagem.edit(mensagemPainel(modoInfo, entradas));
      return true;
    }
    // Painel antigo apagado: publica o formato novo de 15 mensagens.
    const enviadas = await publicarFila(db, canal, { guildId, modo: modoInfo, entradas });
    return enviadas.length > 0;
  } catch (erro) {
    console.error(`[paineis] não consegui atualizar o painel ${modoInfo.id}:`, erro.message);
    return false;
  }
}

/** "Gelo Normal" -> "gelo-normal" */
function slug(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Nome da sala privada da partida: #fila-gelo-normal-001, #fila-gelo-normal-002…
 * A numeração continua de onde parou (mesmo padrão do exemplo fila-gelo-normal-069).
 */
function nomeSalaFila(guild, modo, gelo) {
  const variante = config.varianteDoModo(modo, gelo);
  const base = `fila-${slug(variante?.nome ?? gelo) || 'ap'}`.slice(0, 90);
  const canais = guild?.channels?.cache?.filter?.((canal) => String(canal.name || '').startsWith(`${base}-`));

  let maior = 0;
  if (canais) {
    for (const canal of canais.values()) {
      const numero = Number(String(canal.name).slice(base.length + 1));
      if (Number.isFinite(numero) && numero > maior) maior = numero;
    }
  }
  return `${base}-${String(maior + 1).padStart(3, '0')}`;
}

module.exports = {
  PRECOS_ENVIO,
  embedPainel,
  componentesPainel,
  componentesEntrada,
  componentesGelo: componentesEntrada,
  linhaSair,
  jogadoresDaFaixa,
  nomeSalaFila,
  mensagemPreco,
  mensagensFila,
  mensagemPainel,
  salvar,
  salvarFila,
  mensagensSalvas,
  publicarFila,
  apagarMensagens,
  obter,
  todos,
  atualizar,
};
