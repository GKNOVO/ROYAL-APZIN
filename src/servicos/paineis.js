'use strict';

/** Painéis de AP: embed da fila, menu de preços, botões de gelo e gravação do painel. */

const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed, reais, listaUsuarios } = require('../util/embeds');
const filasServico = require('./filas');

function linhaDePreco(modo, preco, entradas) {
  const doPreco = entradas.filter((linha) => Number(linha.preco) === preco);
  const infinito = doPreco.filter((linha) => linha.gelo === 'infinito').map((linha) => linha.user_id);
  const normal = doPreco.filter((linha) => linha.gelo === 'normal').map((linha) => linha.user_id);
  return {
    name: `${reais(preco)} · ${doPreco.length} na fila`,
    value:
      `🧊 **Gelo Infinito** (${infinito.length}/${modo.jogadores}): ${listaUsuarios(infinito)}\n` +
      `🧊 **Gelo Normal** (${normal.length}/${modo.jogadores}): ${listaUsuarios(normal)}`,
    inline: false,
  };
}

function embedPainel(modo, entradas = []) {
  return embed(`🎯 AP ${modo.titulo}`, [
    `**Modo:** ${modo.titulo}   ·   **Fecha com:** ${modo.jogadores} jogadores (${modo.time}x${modo.time})`,
    `**Apostas:** ${config.PRECOS.map(reais).join(' · ')}`,
    '',
    '**Como entrar:** escolha a faixa de aposta no menu abaixo e depois o tipo de gelo.',
    'Quando o grupo fecha, o bot abre uma **sala privada** com a regra, o mediador e o PIX.',
  ].join('\n'), {
    cor: config.CORES.principal,
    campos: config.PRECOS.map((preco) => linhaDePreco(modo, preco, entradas)),
    rodape: `ORG Royal AP · ${entradas.length} jogador(es) na fila`,
  });
}

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

  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ap:sair:${modo.id}:todos`)
      .setLabel('Sair da Fila')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ap:ranking')
      .setLabel('Ranking')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('ap:como')
      .setLabel('Como funciona')
      .setEmoji('❓')
      .setStyle(ButtonStyle.Secondary),
  );

  return [new ActionRowBuilder().addComponents(menu), botoes];
}

/** Botões que aparecem para quem escolheu um preço (só a pessoa vê). */
function componentesGelo(modo, preco) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ap:gelo:${modo.id}:${preco}:infinito`)
        .setLabel('Gelo Infinito')
        .setEmoji('🧊')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ap:gelo:${modo.id}:${preco}:normal`)
        .setLabel('Gelo Normal')
        .setEmoji('🧊')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ap:sair:${modo.id}:${preco}`)
        .setLabel('Sair da Fila')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

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

/** Redesenha o painel já publicado (chamado depois de entrar/sair da fila). */
async function atualizar(client, db, { guildId, modo }) {
  const modoInfo = config.modoPorId(modo);
  if (!modoInfo) return false;
  const painel = obter(db, { guildId, modo: modoInfo.id });
  if (!painel) return false;

  try {
    const canal = client.channels.cache.get(painel.canal_id) || (await client.channels.fetch(painel.canal_id));
    if (!canal) return false;
    const mensagem = await canal.messages.fetch(painel.mensagem_id).catch(() => null);
    if (!mensagem) return false;
    const entradas = filasServico.listar(db, { guildId, modo: modoInfo.id });
    await mensagem.edit(mensagemPainel(modoInfo, entradas));
    return true;
  } catch (erro) {
    console.error(`[paineis] não consegui atualizar o painel ${modoInfo.id}:`, erro.message);
    return false;
  }
}

module.exports = {
  embedPainel,
  componentesPainel,
  componentesGelo,
  mensagemPainel,
  salvar,
  obter,
  todos,
  atualizar,
};
