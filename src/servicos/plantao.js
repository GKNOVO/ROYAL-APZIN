'use strict';

/**
 * Bate-ponto / plantão dos mediadores: fila de quem está online e apto a
 * receber partidas, com o painel institucional (Imagem 3) e a Central de
 * Pagamentos (Imagem 4) para registro do PIX individual.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed, mencao } = require('../util/embeds');

const agora = () => Date.now();

function entrar(db, { guildId, userId }) {
  const info = db
    .prepare('INSERT OR IGNORE INTO plantao (guild_id, user_id, entrou_em) VALUES (?, ?, ?)')
    .run(String(guildId), String(userId), agora());
  return info.changes === 1;
}

function sair(db, { guildId, userId }) {
  return db
    .prepare('DELETE FROM plantao WHERE guild_id = ? AND user_id = ?')
    .run(String(guildId), String(userId)).changes;
}

function listar(db, guildId) {
  return db
    .prepare('SELECT * FROM plantao WHERE guild_id = ? ORDER BY entrou_em ASC, rowid ASC')
    .all(String(guildId));
}

function total(db, guildId) {
  const linha = db.prepare('SELECT COUNT(*) AS total FROM plantao WHERE guild_id = ?').get(String(guildId));
  return linha ? linha.total : 0;
}

function posicao(db, { guildId, userId }) {
  const fila = listar(db, guildId);
  const indice = fila.findIndex((linha) => linha.user_id === String(userId));
  return indice === -1 ? null : indice + 1;
}

function limpar(db, guildId) {
  return db.prepare('DELETE FROM plantao WHERE guild_id = ?').run(String(guildId)).changes;
}

/** Próximo da fila (rodízio) — usado quando uma sala precisa de mediador. */
function proximo(db, guildId) {
  const fila = listar(db, guildId);
  return fila.length ? fila[0].user_id : null;
}

function componentes() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ap:plantaoentrar').setLabel('Entrar').setEmoji('✅').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ap:plantaosair').setLabel('Sair').setEmoji('🚪').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ap:plantaostatus').setLabel('Atualizar').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ap:plantaoconfig').setLabel('Config').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function embedFila(db, guildId) {
  const fila = listar(db, guildId);
  const corpo = [
    '**Seja bem-vindo(a) ao painel de mediação ORG ⚡ Royal AP!**',
    '',
    `**Status atual:** ${fila.length} mediador(es) na fila`,
    fila.length
      ? ''
      : '⚠️ **Atenção** — Nenhum mediador na fila no momento.',
    fila.length ? fila.map((linha, indice) => `**${indice + 1}.** ${mencao(linha.user_id)}`).join('\n') : '',
    '',
    'Clique no botão abaixo para entrar ou sair da fila de mediação.',
  ]
    .filter((linha) => linha !== '')
    .join('\n');

  return embed('👤 Fila de Mediadores', corpo, { cor: config.CORES.principal, rodape: 'ORG Royal AP · mediação' });
}

const painel = (db, guildId) => ({ embeds: [embedFila(db, guildId)], components: componentes() });

/** Central de Pagamentos: Mediadores (registro individual de PIX). */
function painelRegistroPix() {
  const corpo = [
    'Bem-vindo ao sistema de remuneração. Para garantir o recebimento ágil de suas participações, mantenha seus dados PIX sempre atualizados.',
    '',
    '🏷️ **Chave PIX:** CPF, E-mail, Telefone ou Chave Aleatória',
    '👤 **Nome Completo:** Titular da conta bancária',
    '💬 **Cidade:** Cidade de registro da conta',
    '',
    '⚠️ **Importante:** Os pagamentos são processados com base nestes dados. Verifique cuidadosamente antes de salvar.',
  ].join('\n');

  const linha = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ap:pixregistrar').setLabel('Configurar Pix').setEmoji('💠').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ap:pixverificar').setLabel('Verificar Cadastro').setEmoji('ℹ️').setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [
      embed('💳 Central de Pagamentos: Mediadores', corpo, { cor: config.CORES.principal, rodape: 'ORG Royal AP · PIX' }),
    ],
    components: [linha],
  };
}

module.exports = {
  entrar,
  sair,
  listar,
  total,
  posicao,
  limpar,
  proximo,
  componentes,
  embedFila,
  painel,
  painelRegistroPix,
};
