'use strict';

/** Um comando de painel para cada um dos 15 modos de AP. */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const paineis = require('../servicos/paineis');
const filas = require('../servicos/filas');
const auditoria = require('../servicos/auditoria');
const { exigirStaff, responderErro } = require('../util/seguranca');

const EFEMERO = MessageFlags?.Ephemeral ?? 64;

const comandos = config.MODOS.map((modo) => ({
  data: new SlashCommandBuilder()
    .setName(modo.comando)
    .setDescription(`Publica o painel de AP ${modo.titulo} (R$ 0,50 a R$ 100,00) neste canal`),

  async executar(interaction, { db, client }) {
    if (!interaction.guild) {
      return responderErro(interaction, 'Esse comando funciona apenas dentro do servidor da ORG.');
    }
    if (!(await exigirStaff(interaction, 'Só a staff/ADM pode publicar painéis de AP.'))) return;

    const canal = interaction.channel;
    if (!canal || !canal.isTextBased?.()) {
      return responderErro(interaction, 'Use esse comando em um canal de texto.');
    }

    // O deferReply já foi feito pelo despachante (src/comandos/index.js).
    const entradas = filas.listar(db, { guildId: interaction.guildId, modo: modo.id });
    const mensagem = await canal.send(paineis.mensagemPainel(modo, entradas));

    paineis.salvar(db, {
      guildId: interaction.guildId,
      modo: modo.id,
      canalId: canal.id,
      mensagemId: mensagem.id,
    });

    await auditoria.registrar(db, client, {
      guildId: interaction.guildId,
      autorId: interaction.user.id,
      acao: 'Painel publicado',
      detalhe: `${modo.titulo} em ${canal.name}`,
    });

    return interaction.editReply({
      content: `✅ Painel **AP ${modo.titulo}** publicado em ${canal}. Os botões já estão ativos.`,
    });
  },
}));

module.exports = { comandos };
