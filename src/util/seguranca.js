'use strict';

/**
 * Permissões e respostas seguras.
 * Toda resposta sai daqui para nunca estourar "InteractionAlreadyReplied".
 */

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config');
const { embedErro } = require('./embeds');

const EFEMERO = MessageFlags?.Ephemeral ?? 64;
const reconhecidaRemotamente = new WeakSet();

function jaFoiReconhecida(erro) {
  return (
    Number(erro?.code) === 40060 ||
    erro?.name === 'InteractionAlreadyReplied' ||
    /interaction has already been acknowledged|interaction already replied/i.test(String(erro?.message || ''))
  );
}

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

/** Só botões/menus usam deferUpdate; modais e comandos usam deferReply. */
function ehComponente(interaction) {
  if (typeof interaction.isMessageComponent === 'function') return interaction.isMessageComponent();
  return Boolean(interaction.isButton?.() || interaction.isAnySelectMenu?.());
}

/** Responde sem saber se a interação já foi respondida. */
async function responder(interaction, payload) {
  const corpo = typeof payload === 'string' ? { content: payload } : payload;
  // Comando já adiado (deferReply) → usa a mensagem "pensando" (editReply).
  if (interaction.deferred && !ehComponente(interaction)) return interaction.editReply(corpo);
  // Componente já confirmado (deferUpdate/update) → followUp, sem mexer no painel.
  if (interaction.deferred || interaction.replied || reconhecidaRemotamente.has(interaction)) {
    return interaction.followUp(corpo);
  }
  try {
    return await interaction.reply(corpo);
  } catch (erro) {
    // Se o Discord aceitou o ACK mas a resposta HTTP se perdeu, os flags locais
    // continuam falsos. 40060 prova que já houve ACK: não tente reply de novo.
    if (!jaFoiReconhecida(erro)) throw erro;
    reconhecidaRemotamente.add(interaction);
    return interaction.followUp(corpo);
  }
}

/** Responde só para quem clicou (ninguém mais vê). */
async function responderPrivado(interaction, payload) {
  const corpo = typeof payload === 'string' ? { content: payload } : { ...payload };
  corpo.flags = (corpo.flags ?? 0) | EFEMERO;
  return responder(interaction, corpo);
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

module.exports = {
  EFEMERO,
  temCargo,
  ehAdmin,
  ehMediador,
  ehStaff,
  ehComponente,
  responder,
  responderPrivado,
  responderErro,
  atualizar,
  exigirStaff,
  exigirMediador,
  exigirAdmin,
};
