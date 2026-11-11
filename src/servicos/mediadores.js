'use strict';

/**
 * Módulo de mediadores: cargos permitidos, canais do painel e modo de trabalho.
 * Tudo fica na tabela `configuracoes` (por servidor), com fallback no .env.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const { obterConfig, definirConfig } = require('../db');
const { embed, mencaoCargo } = require('../util/embeds');

const LIMITE_CARGOS = 10;
const MODOS = {
  rodizio: 'Rodízio',
  fila: 'Fila',
};

const padrao = () => [config.CARGO_MEDIADOR_ID, config.CARGO_ADMIN_ID].filter(Boolean);
const lerJson = (valor) => {
  try {
    const lista = JSON.parse(valor);
    return Array.isArray(lista) ? lista.map(String).filter(Boolean) : null;
  } catch {
    return null;
  }
};

/** Cargos que atuam como mediador/ADM nas filas (banco → .env). */
function cargos(db, guildId) {
  const doBanco = db ? lerJson(obterConfig(db, guildId, 'cargos_mediadores', null)) : null;
  const lista = doBanco && doBanco.length ? doBanco : padrao();
  return [...new Set(lista)].slice(0, LIMITE_CARGOS);
}

function definirCargos(db, guildId, ids) {
  const lista = [...new Set((ids || []).map(String).filter(Boolean))].slice(0, LIMITE_CARGOS);
  definirConfig(db, guildId, 'cargos_mediadores', JSON.stringify(lista));
  return lista;
}

const canalBatePonto = (db, guildId) => obterConfig(db, guildId, 'canal_bateponto', null);
const canalConfigPix = (db, guildId) => obterConfig(db, guildId, 'canal_configpix', null);
const definirCanalBatePonto = (db, guildId, id) => definirConfig(db, guildId, 'canal_bateponto', id);
const definirCanalConfigPix = (db, guildId, id) => definirConfig(db, guildId, 'canal_configpix', id);

const modo = (db, guildId) => {
  const salvo = String(obterConfig(db, guildId, 'modo_mediadores', 'rodizio') || 'rodizio').toLowerCase();
  return MODOS[salvo] ? salvo : 'rodizio';
};
const definirModo = (db, guildId, valor) => {
  const escolhido = MODOS[String(valor || '').toLowerCase()] ? String(valor).toLowerCase() : 'rodizio';
  definirConfig(db, guildId, 'modo_mediadores', escolhido);
  return escolhido;
};

const limparFilaAuto = (db, guildId) => obterConfig(db, guildId, 'limpar_fila_auto', '0') === '1';
const definirLimparFilaAuto = (db, guildId, ativo) =>
  definirConfig(db, guildId, 'limpar_fila_auto', ativo ? '1' : '0');

/** Cargos do atendimento (tickets) — separados dos mediadores. */
function cargosSuporte() {
  return [config.CARGO_SUPORTE_ID, config.CARGO_AUX_ID].filter(Boolean);
}

/**
 * Tem algum dos CARGOS configurados para mediação?
 * Sem bypass de permissão: serve para o botão "Entrar" do plantão, onde o
 * requisito é ter o cargo de Mediador ou de ADM configurado no módulo.
 */
function temCargoMediador(db, guildId, member) {
  const cache = member?.roles?.cache;
  if (!cache?.has) return false;
  return cargos(db, guildId).some((id) => cache.has(id));
}

/** O membro pode atuar como mediador/ADM nas filas? */
function ehMediador(db, guildId, member) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const cache = member.roles?.cache;
  if (!cache?.has) return false;
  return cargos(db, guildId).some((id) => cache.has(id));
}

/** Menções usadas nos avisos de partida (só mediadores e ADM). */
function mencoes(db, guildId) {
  return [...new Set([...cargos(db, guildId), config.CARGO_ADMIN_ID].filter(Boolean))];
}

/** Painel de configuração (/mediadores) — usado também pelos selects. */
function painelConfig(db, guildId) {
  const ids = cargos(db, guildId);
  const fila = canalBatePonto(db, guildId);
  const pix = canalConfigPix(db, guildId);
  const atual = modo(db, guildId);

  const corpo = [
    'Configure como os mediadores interagem com o sistema.',
    '',
    `**Cargos de Mediador:** ${ids.length ? ids.map((id) => mencaoCargo(id)).join(', ') : '`nenhum`'}`,
    `**Painel de Fila:** ${fila ? `<#${fila}>` : '`não definido`'}`,
    `**Painel de Cadastro:** ${pix ? `<#${pix}>` : '`não definido`'}`,
    `**Limpar Fila Auto:** ${limparFilaAuto(db, guildId) ? 'Ativado' : 'Desativado'}`,
    `**Modo Atual:** ${MODOS[atual]}`,
    '',
    `╰ \`${MODOS[atual]}:\` o mediador entra em uma fila e é chamado na ordem.`,
  ].join('\n');

  const cargosRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('ap:medcargos')
      .setPlaceholder('Selecionar cargos de mediador…')
      .setMinValues(1)
      .setMaxValues(LIMITE_CARGOS),
  );
  const filaRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('ap:medfila')
      .setPlaceholder('Canal do painel de fila (bate-ponto)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );
  const pixRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('ap:medpix')
      .setPlaceholder('Canal do painel de cadastro (PIX)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );
  const acoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ap:medlimpar').setLabel('Limpar Fila').setEmoji('🕒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ap:medgestaopix').setLabel('Gestão PIX').setEmoji('💠').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ap:medmodo').setLabel(`Modo: ${MODOS[atual]}`).setEmoji('🔄').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ap:medreenviar').setLabel('Reenviar').setEmoji('📨').setStyle(ButtonStyle.Primary),
  );

  return {
    embeds: [embed('👤 Módulo de Mediadores', corpo, { cor: config.CORES.principal, rodape: 'ORG Royal AP · mediação' })],
    components: [cargosRow, filaRow, pixRow, acoes],
  };
}

module.exports = {
  MODOS,
  LIMITE_CARGOS,
  cargos,
  definirCargos,
  canalBatePonto,
  canalConfigPix,
  definirCanalBatePonto,
  definirCanalConfigPix,
  modo,
  definirModo,
  limparFilaAuto,
  definirLimparFilaAuto,
  cargosSuporte,
  temCargoMediador,
  ehMediador,
  mencoes,
  painelConfig,
};
