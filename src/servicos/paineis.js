'use strict';

/**
 * Painéis de AP: um card por faixa de aposta, do menor (R$ 0,50, no topo) para
 * o maior (R$ 100,00, no fundo), menu de valores e botões específicos por
 * categoria (mobile, emu, full capa e misto).
 */

const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed, reais, listaUsuarios } = require('../util/embeds');
const filasServico = require('./filas');

/** Card de um valor: mostra cada tipo de entrada com quantos já estão na fila. */
function linhaDePreco(modo, preco, entradas) {
  const doPreco = entradas.filter((linha) => Number(linha.preco) === preco);
  const variantes = config.variantesDoModo(modo).map((variante) => {
    const ids = doPreco.filter((linha) => linha.gelo === variante.id).map((linha) => linha.user_id);
    return `${variante.emoji} **${variante.nome}** (${ids.length}/${modo.jogadores}): ${listaUsuarios(ids)}`;
  });
  return {
    name: `💵 ${reais(preco)} · ${doPreco.length} na fila`,
    value: variantes.join('\n') || '`fila vazia`',
    inline: false,
  };
}

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
  componentesEntrada,
  componentesGelo: componentesEntrada,
  mensagemPainel,
  salvar,
  obter,
  todos,
  atualizar,
};
