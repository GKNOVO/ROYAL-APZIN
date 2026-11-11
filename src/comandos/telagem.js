'use strict';

/**
 * /criar_telagem — abre a sala de call (telagem) da partida ativa.
 * Só mediador/ADM, e só dentro do canal da sala privada da partida.
 */

const { SlashCommandBuilder } = require('discord.js');
const mediadores = require('../servicos/mediadores');
const partidas = require('../servicos/partidas');
const telagem = require('../servicos/telagem');
const { responderPrivado, responderErro } = require('../util/seguranca');
const { embedSucesso } = require('../util/embeds');

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('criar_telagem')
      .setDescription('Cria a sala de telagem (call) desta partida e publica o painel no canal'),

    async executar(interaction, { db }) {
      if (!interaction.guild) {
        return responderErro(interaction, 'Use esse comando dentro do servidor da ORG.');
      }
      if (!mediadores.ehMediador(db, interaction.guildId, interaction.member)) {
        return responderErro(interaction, 'Só mediadores/ADM podem criar a telagem.');
      }

      const partida = partidas.porCanal(db, interaction.guildId, interaction.channelId);
      if (!partida) {
        return responderErro(
          interaction,
          'Use este comando **dentro do canal da partida** (a sala privada criada quando a fila fechou).',
        );
      }
      if (!interaction.channel?.send) {
        return responderErro(interaction, 'Não consegui enviar o painel neste canal.');
      }

      const codigo = telagem.novoCodigo();
      await interaction.channel.send(telagem.painel(codigo));

      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `Sala de telagem criada para a partida \`${partida.id}\`.\n` +
              `**Código:** \`${codigo}\`\n**Link:** ${telagem.link(codigo)}`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
