'use strict';

/**
 * Permissões e respostas seguras.
 * Toda resposta sai daqui para nunca estourar "InteractionAlreadyReplied".
 */

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const { embedErro } = require('./embeds');

const EFEMERO = MessageFlags?.Ephemeral ?? 64;

function temCargo(member, id) {
  if (!id || !member) return false;
  const cargos = member.roles?.cache;
  if (!cargos?.has) return false;
  return cargos.has(id);
}

function ehAdmin(member) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return temCargo(member, config.CARGO_ADMIN_ID);
}

function ehMediador(member) {
  if (ehAdmin(member)) return true;
  if (temCargo(member, config.CARGO_MEDIADOR_ID)) return true;
  return temCargo(member, config.CARGO_STAFF_ID);
}

function ehStaff(member) {
  if (ehMediador(member)) return true;
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

/** Atendimento de tickets: só Suporte/Auxiliar (e quem gerencia o servidor). */
function ehSuporte(member) {
  if (temCargo(member, config.CARGO_SUPORTE_ID) || temCargo(member, config.CARGO_AUX_ID)) return true;
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

/**
 * A pessoa é o MEDIADOR RESPONSÁVEL por esta partida? (ADM também pode.)
 * Ter o cargo de mediador NÃO basta: quem assumiu a sala é que manda nela.
 */
function ehMediadorDaPartida(partida, member, userId) {
  if (!partida) return false;
  if (ehAdmin(member)) return true;
  return Boolean(partida.mediador_id) && String(partida.mediador_id) === String(userId ?? member?.id ?? '');
}

/** A interação está acontecendo no canal privado da partida? */
function noCanalDaPartida(partida, interaction) {
  return Boolean(partida) && String(partida.canal_id) === String(interaction?.channelId ?? '');
}

/** Clique em botão/menu/modal: a primeira resposta já foi consumida pelo ack. */
function ehComponente(interaction) {
  return Boolean(
    interaction.isButton?.() ||
      interaction.isAnySelectMenu?.() ||
      interaction.isModalSubmit?.() ||
      interaction.isContextMenuCommand?.(),
  );
}

/** Responde sem saber se a interação já foi respondida. */
async function responder(interaction, payload) {
  const corpo = typeof payload === 'string' ? { content: payload } : payload;
  // Comando já adiado (deferReply) → usa a mensagem "pensando" (editReply).
  if (interaction.deferred && !ehComponente(interaction)) return interaction.editReply(corpo);
  // Componente já confirmado (deferUpdate/update) → followUp, sem mexer no painel.
  if (interaction.deferred || interaction.replied) return interaction.followUp(corpo);
  return interaction.reply(corpo);
}

/** Responde só para quem clicou (ninguém mais vê). */
async function responderPrivado(interaction, payload) {
  const corpo = typeof payload === 'string' ? { content: payload } : { ...payload };
  corpo.flags = (corpo.flags ?? 0) | EFEMERO;
  if (interaction.deferred && !ehComponente(interaction)) return interaction.editReply(corpo);
  if (interaction.deferred || interaction.replied) return interaction.followUp(corpo);
  return interaction.reply(corpo);
}

async function responderErro(interaction, mensagem) {
  return responderPrivado(interaction, { embeds: [embedErro(mensagem)] });
}

/** Atualiza a mensagem do painel (cliques em botão). */
async function atualizar(interaction, payload) {
  const corpo = typeof payload === 'string' ? { content: payload } : payload;
  return interaction.update(corpo);
}

/**
 * Garante permissão. Devolve true quando pode seguir;
 * quando não pode, já responde e devolve false.
 */
async function exigir(interaction, teste, mensagem) {
  if (teste(interaction.member)) return true;
  await responderErro(interaction, mensagem);
  return false;
}

const exigirStaff = (i, mensagem = 'Esse comando é só para a staff/ADM da ORG Royal AP.') =>
  exigir(i, ehStaff, mensagem);

const exigirMediador = (i, mensagem = 'Esse comando é só para mediadores e ADMs.') =>
  exigir(i, ehMediador, mensagem);

const exigirAdmin = (i, mensagem = 'Esse comando é só para ADMs da ORG Royal AP.') =>
  exigir(i, ehAdmin, mensagem);

/** Exige o mediador que assumiu a partida (ou ADM). Responde e devolve false. */
async function exigirMediadorDaPartida(
  interaction,
  partida,
  mensagem = 'Só o mediador responsável por esta sala (ou um ADM) pode fazer isso.',
) {
  if (ehMediadorDaPartida(partida, interaction.member, interaction.user?.id)) return true;
  await responderErro(interaction, mensagem);
  return false;
}

module.exports = {
  EFEMERO,
  temCargo,
  ehAdmin,
  ehMediador,
  ehStaff,
  ehSuporte,
  ehMediadorDaPartida,
  noCanalDaPartida,
  ehComponente,
  responder,
  responderPrivado,
  responderErro,
  atualizar,
  exigirStaff,
  exigirMediador,
  exigirAdmin,
  exigirMediadorDaPartida,
};
