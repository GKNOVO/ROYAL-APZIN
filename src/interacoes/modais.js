'use strict';

/** Modais: regra da partida e ID/senha da sala. */

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const config = require('../config');
const partidas = require('../servicos/partidas');
const fluxo = require('../servicos/fluxo');
const { responderPrivado, responderErro, ehMediador } = require('../util/seguranca');
const { embedSucesso } = require('../util/embeds');

async function abrirModalRegras(interaction, db, partidaId) {
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return responderErro(interaction, 'Sala não encontrada.');
  const jogadores = partidas.jogadores(db, partidaId);
  if (!jogadores.some((linha) => linha.user_id === interaction.user.id)) {
    return responderErro(interaction, 'Só quem está jogando essa sala pode enviar a regra.');
  }

  const modal = new ModalBuilder()
    .setCustomId(`ap:modalregras:${partidaId}`)
    .setTitle('Regra da partida')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('regra')
          .setLabel('Escreva a regra combinada')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Ex: 1x1 mobile, sem emulador, gelo infinito, 3 quedas, quem fizer mais pontos vence.')
          .setMinLength(5)
          .setMaxLength(config.LIMITES.REGRAS)
          .setRequired(true),
      ),
    );

  return interaction.showModal(modal);
}

async function abrirModalSala(interaction, db, partidaId) {
  if (!ehMediador(interaction.member)) {
    return responderErro(interaction, 'Só o mediador pode liberar a criação da sala.');
  }
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return responderErro(interaction, 'Sala não encontrada.');

  const modal = new ModalBuilder()
    .setCustomId(`ap:modalsala:${partidaId}`)
    .setTitle('Liberar sala')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sala_id')
          .setLabel('ID da sala')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Ex: 12345678')
          .setMaxLength(40)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sala_senha')
          .setLabel('Senha da sala (se tiver)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(40)
          .setRequired(false),
      ),
    );

  return interaction.showModal(modal);
}

async function handleModal(interaction, { db, client }) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap') return false;

  const tipo = partes[1];
  const partidaId = partes[2];

  try {
    if (tipo === 'modalregras') {
      const texto = interaction.fields.getTextInputValue('regra');
      partidas.definirRegras(db, partidaId, texto, interaction.user.id);
      await fluxo.atualizarPartida(client, db, partidaId);
      await responderPrivado(interaction, {
        embeds: [embedSucesso('Regra registrada na sala! Agora todos clicam em **Confirmar Regras**.')],
      });
      return true;
    }

    if (tipo === 'modalsala') {
      if (!ehMediador(interaction.member)) {
        await responderErro(interaction, 'Só o mediador pode liberar a sala.');
        return true;
      }
      const salaId = interaction.fields.getTextInputValue('sala_id');
      const senha = interaction.fields.getTextInputValue('sala_senha');
      partidas.liberarSala(db, partidaId, { salaId, senha });
      await fluxo.atualizarPartida(client, db, partidaId);
      await responderPrivado(interaction, {
        embeds: [embedSucesso(`Sala liberada para os jogadores: ID \`${salaId}\`${senha ? ` · Senha \`${senha}\`` : ''}.`)],
      });
      return true;
    }

    return false;
  } catch (erro) {
    console.error(`[modais] erro em ${interaction.customId}:`, erro);
    await responderErro(interaction, erro.message || 'Deu um erro aqui. Tente de novo.');
    return true;
  }
}

module.exports = { abrirModalRegras, abrirModalSala, handleModal };
