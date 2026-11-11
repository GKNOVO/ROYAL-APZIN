'use strict';

/**
 * /criar_telagem — abre a sala de call exclusiva do canal/partida.
 *
 * • Código único por canal (a mesma partida sempre reaproveita a mesma sala).
 * • Restrito a quem tem um dos CARGOS configurados no /mediadores (Mediador/ADM).
 * • Funciona em qualquer canal; dentro da sala da partida o painel é vinculado a ela.
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
      .setDescription('Cria a sala de telagem (call exclusiva do canal) e publica o painel')
      .addStringOption((opcao) =>
        opcao
          .setName('link')
          .setDescription('Link real do Google Meet (vazio = sala exclusiva gerada pelo bot)'),
      ),

    async executar(interaction, { db }) {
      if (!interaction.guild) {
        return responderErro(interaction, 'Use esse comando dentro do servidor da ORG.');
      }
      if (!mediadores.podeUsarSalas(db, interaction.guildId, interaction.member)) {
        return responderErro(interaction, mediadores.AVISO_CARGO);
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

      // Código exclusivo e estável deste canal/partida (não é aleatório global).
      const codigo = telagem.codigoDoCanal(interaction.guildId, partida?.id || interaction.channelId);
      await canal.send(telagem.painel(codigo, { url }));

      const destino = telagem.link(codigo, { url });
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            (partida
              ? `Sala de telagem criada para a partida \`${partida.id}\`.`
              : `Sala de telagem criada para este canal.`) +
              `\n**Código:** \`${codigo}\`\n**Link exclusivo:** ${destino}`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
