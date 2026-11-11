'use strict';

/**
 * Filas de AP: UMA MENSAGEM POR FAIXA DE APOSTA (15 mensagens no canal).
 *
 * Ordem de envio: do MAIOR preço para o MENOR. No Discord a mensagem mais nova
 * fica embaixo, então a faixa mais barata (R$ 0,50) é a última mensagem do
 * canal e os valores vão subindo conforme você rola para cima — exatamente o
 * layout combinado com a ORG.
 *
 * Os canais das filas NÃO nascem mais dentro de categoria: eles nascem logo
 * ABAIXO do canal de referência (CANAL_FILA_ID no .env ou `/boombot setfila`).
 */

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');
const config = require('../config');
const { obterConfig } = require('../db');
const { embed, reais, listaUsuarios } = require('../util/embeds');
const filasServico = require('./filas');

/** Preços do maior para o menor: é essa a ordem em que as mensagens saem. */
const PRECOS_ENVIO = [...config.PRECOS].sort((a, b) => b - a);

/** Linhas de cada tipo de entrada (gelo/categoria) com os jogadores na fila. */
function linhasDeEntrada(modo, preco, entradas) {
  const doPreco = entradas.filter((linha) => Number(linha.preco) === Number(preco));
  const variantes = config.variantesDoModo(modo).map((variante) => {
    const ids = doPreco.filter((linha) => linha.gelo === variante.id).map((linha) => linha.user_id);
    return `${variante.emoji} **${variante.nome}** (${ids.length}/${modo.jogadores}): ${listaUsuarios(ids)}`;
  });
  return { doPreco, variantes };
}

/** Card de um valor (usado no painel antigo, de uma mensagem só). */
function linhaDePreco(modo, preco, entradas) {
  const { doPreco, variantes } = linhasDeEntrada(modo, preco, entradas);
  return {
    name: `💵 ${reais(preco)} · ${doPreco.length} na fila`,
    value: variantes.join('\n') || '`fila vazia`',
    inline: false,
  };
}

/** Painel antigo (todos os valores em um embed) — mantido para compatibilidade. */
function embedPainel(modo, entradas = []) {
  return embed(`🎯 AP ${modo.titulo}`, [
    `**Modo:** ${modo.titulo}   ·   **Fecha com:** ${modo.jogadores} jogadores (${modo.time}x${modo.time})`,
    `**Cards:** de ${reais(config.PRECOS[0])} (topo) até ${reais(config.PRECOS[config.PRECOS.length - 1])} (fundo).`,
    '',
    '**Como entrar:** escolha o valor no menu abaixo e depois o botão da sua categoria.',
    'Quando o grupo fecha, o bot abre uma **sala privada** com a regra, o mediador e o PIX.',
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
        description: `AP ${modo.titulo} · ${modo.jogadores} jogadores`,
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
 *  mobile   → Gelo Infinito · Gelo Normal · Sair · Como funciona
 *  emu      → Normal · Full UMP e XM8 · Sair · Como funciona
 *  fullcapa → Full Capa · Sair · Como funciona
 *  misto    → 1 Emu (2 Emu, 3 Emu conforme o time) · Sair  (sem "Como funciona")
 */
function componentesEntrada(modo, preco) {
  const estilos = [ButtonStyle.Primary, ButtonStyle.Success, ButtonStyle.Secondary];
  const botoes = config.variantesDoModo(modo).map((variante, indice) =>
    new ButtonBuilder()
      .setCustomId(`ap:entrar:${modo.id}:${preco}:${variante.id}`)
      .setLabel(variante.nome)
      .setEmoji(variante.emoji)
      .setStyle(estilos[indice] || ButtonStyle.Secondary),
  );

  botoes.push(
    new ButtonBuilder()
      .setCustomId(`ap:sair:${modo.id}:${preco}`)
      .setLabel('Sair')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
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

  return [new ActionRowBuilder().addComponents(...botoes)];
}

/** UMA mensagem da fila: só a faixa de preço dela, com os botões dela. */
function mensagemPreco(modo, preco, entradas = []) {
  const { doPreco, variantes } = linhasDeEntrada(modo, preco, entradas);
  const corpo = [
    `${modo.titulo} · fecha com **${modo.jogadores}** jogadores (${modo.time}x${modo.time})`,
    '',
    ...(variantes.length ? variantes : ['`fila vazia`']),
    '',
    `**Aposta desta faixa:** ${reais(preco)} · **Na fila:** ${doPreco.length}/${modo.jogadores}`,
    '_Entre pelo botão da sua categoria. Grupo fechado = sala privada automática._',
  ].join('\n');

  return {
    embeds: [
      embed(`💵 ${reais(preco)} · AP ${modo.titulo}`, corpo, {
        cor: config.CORES.principal,
        rodape: `ORG Royal AP · ${reais(preco)}`,
      }),
    ],
    components: componentesEntrada(modo, preco),
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

/** Envia as 15 mensagens da fila no canal e guarda os IDs no banco. */
async function publicarFila(db, canal, { guildId, modo, entradas = [] }) {
  const enviadas = [];
  for (const { preco, payload } of mensagensFila(modo, entradas)) {
    const mensagem = await canal.send(payload);
    enviadas.push({ preco, mensagemId: mensagem.id });
  }
  salvarFila(db, { guildId, modo: modo.id, canalId: canal.id, mensagens: enviadas });
  return enviadas;
}

/** Redesenha as mensagens da fila (todas ou só a faixa informada). */
async function atualizar(client, db, { guildId, modo, preco = null }) {
  const modoInfo = config.modoPorId(modo);
  if (!modoInfo) return false;

  const entradas = filasServico.listar(db, { guildId, modo: modoInfo.id });
  const linhas = mensagensSalvas(db, { guildId, modo: modoInfo.id });

  if (linhas.length) {
    const alvo =
      preco === null || preco === undefined
        ? linhas
        : linhas.filter((linha) => Number(linha.preco) === Number(preco));
    let editadas = 0;

    for (const linha of alvo) {
      try {
        const canal =
          client.channels.cache.get(linha.canal_id) || (await client.channels.fetch(linha.canal_id));
        if (!canal) continue;
        const mensagem = await canal.messages.fetch(linha.mensagem_id).catch(() => null);
        if (!mensagem) continue;
        await mensagem.edit(mensagemPreco(modoInfo, Number(linha.preco), entradas));
        editadas += 1;
      } catch (erro) {
        console.error(`[paineis] não consegui atualizar ${reais(Number(linha.preco))}:`, erro.message);
      }
    }
    return editadas > 0;
  }

  // Compatibilidade: painel antigo, com todos os cards em uma mensagem só.
  const painel = obter(db, { guildId, modo: modoInfo.id });
  if (!painel) return false;
  try {
    const canal =
      client.channels.cache.get(painel.canal_id) || (await client.channels.fetch(painel.canal_id));
    if (!canal) return false;
    const mensagem = await canal.messages.fetch(painel.mensagem_id).catch(() => null);
    if (!mensagem) return false;
    await mensagem.edit(mensagemPainel(modoInfo, entradas));
    return true;
  } catch (erro) {
    console.error(`[paineis] não consegui atualizar o painel ${modoInfo.id}:`, erro.message);
    return false;
  }
}

/** Canal de referência das filas (banco → .env). */
async function canalDeReferencia(guild, db, chave = 'canal_fila', envId = config.CANAL_FILA_ID) {
  const salvo = db ? obterConfig(db, guild.id, chave, envId) : envId;
  const id = String(salvo || '').trim();
  if (!id) return null;
  const doCache = guild?.channels?.cache?.get?.(id);
  if (doCache) return doCache;
  if (typeof guild?.channels?.fetch !== 'function') return null;
  return (await guild.channels.fetch(id).catch(() => null)) || null;
}

/** Coloca o canal logo ABAIXO do canal de referência. */
async function posicionarAbaixo(canal, referencia) {
  if (!canal || !referencia || typeof canal.setPosition !== 'function') return false;
  try {
    await canal.setPosition(Number(referencia.position ?? 0) + 1);
    return true;
  } catch (erro) {
    console.warn(`[paineis] não consegui posicionar ${canal.name} abaixo de ${referencia.name}:`, erro.message);
    return false;
  }
}

const nomeCanalFila = (modo) => `fila-${modo.id}`.toLowerCase().slice(0, 95);

/**
 * Garante o canal da fila do modo: reutiliza se já existe, senão cria e
 * posiciona logo abaixo do canal de referência.
 * Devolve { canal, referencia, criado, motivo }.
 */
async function garantirCanalFila(guild, db, modo) {
  const referencia = await canalDeReferencia(guild, db);
  if (!referencia) return { canal: null, referencia: null, criado: false, motivo: 'sem-canal-referencia' };

  const nome = nomeCanalFila(modo);
  const existente = guild.channels.cache.find(
    (canal) => canal.name === nome && canal.type === ChannelType.GuildText,
  );
  if (existente) return { canal: existente, referencia, criado: false, motivo: null };

  const canal = await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    topic: `Fila de AP ${modo.titulo} · ORG Royal AP`,
  });
  await posicionarAbaixo(canal, referencia);
  return { canal, referencia, criado: true, motivo: null };
}

module.exports = {
  PRECOS_ENVIO,
  embedPainel,
  componentesPainel,
  componentesEntrada,
  componentesGelo: componentesEntrada,
  mensagemPreco,
  mensagensFila,
  mensagemPainel,
  salvar,
  salvarFila,
  mensagensSalvas,
  publicarFila,
  obter,
  todos,
  atualizar,
  canalDeReferencia,
  posicionarAbaixo,
  garantirCanalFila,
};
