'use strict';

/**
 * /criar_telagem — abre a sala de call (telagem) da partida.
 * Só mediador/ADM. Funciona em QUALQUER canal: dentro da sala da partida o
 * painel é vinculado a ela; fora, vale como telagem avulsa da staff.
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

      const canal = interaction.channel;
      if (!canal?.send) {
        return responderErro(interaction, 'Use esse comando em um canal de texto.');
      }

      // Pode ser em qualquer canal: se for a sala de uma partida, vincula a ela.
      const partida = partidas.porCanal(db, interaction.guildId, interaction.channelId);
      const codigo = telagem.novoCodigo();
      await canal.send(telagem.painel(codigo));

      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            (partida
              ? `Sala de telagem criada para a partida \`${partida.id}\`.`
              : 'Sala de telagem criada neste canal.') +
              `\n**Código:** \`${codigo}\`\n**Link:** ${telagem.link(codigo)}`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
