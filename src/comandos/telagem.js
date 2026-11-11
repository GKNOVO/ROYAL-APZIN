'use strict';

/**
 * /criar_telagem — abre a sala de call (Google Meet) da partida.
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
      .setDescription('Cria a sala de telagem (call do Google Meet) e publica o painel no canal')
      .addStringOption((opcao) =>
        opcao
          .setName('link')
          .setDescription('Link real do Google Meet (vazio = gera no formato oficial)'),
      ),

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

      // Link opcional: só aceita meet.google.com (evita link estranho no botão).
      const informado = interaction.options.getString('link');
      const url = informado ? telagem.linkValido(informado) : null;
      if (informado && !url) {
        return responderErro(
          interaction,
          'Link inválido. Cole um link do Google Meet, ex: `https://meet.google.com/abc-defg-hij`.',
        );
      }

      const partida = partidas.porCanal(db, interaction.guildId, interaction.channelId);
      const codigo = telagem.novoCodigo();
      await canal.send(telagem.painel(codigo, { url }));

      const destino = url || telagem.link(codigo);
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            (partida
              ? `Sala de telagem criada para a partida \`${partida.id}\`.`
              : 'Sala de telagem criada neste canal.') +
              `\n**Código:** \`${codigo}\`\n**Link:** ${destino}`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
