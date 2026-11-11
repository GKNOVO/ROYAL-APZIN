'use strict';

/**
 * /criar_telagem — abre a sala de call exclusiva do canal/partida.
 *
 * • Reserva um link REAL do Google Meet do pool (TELAGEM_LINKS + /telagem_links).
 *   O mesmo canal/partida sempre recebe o mesmo link; canais diferentes nunca
 *   dividem a call.
 * • Restrito a quem tem um dos CARGOS configurados no /mediadores (Mediador/ADM).
 * • `link:` fixa um Meet específico para aquela partida.
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
      .setDescription('Cria a telagem do canal com um link exclusivo do Google Meet')
      .addStringOption((opcao) =>
        opcao
          .setName('link')
          .setDescription('Link real do Meet para esta partida (vazio = pega um do pool)'),
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
      if (informado && !telagem.linkValido(informado)) {
        return responderErro(
          interaction,
          'Link inválido. Cole um link real do Google Meet, ex: `https://meet.google.com/abc-defg-hij`.',
        );
      }

      const partida = partidas.porCanal(db, interaction.guildId, interaction.channelId);

      // Cada partida tem sua chave; fora de partida a chave é o próprio canal.
      const chave = partida ? `partida:${partida.id}` : `canal:${interaction.channelId}`;

      let sala;
      try {
        sala = informado
          ? telagem.fixar(db, interaction.guildId, chave, informado)
          : telagem.reservar(db, interaction.guildId, chave);
      } catch (erro) {
        return responderErro(interaction, erro.message);
      }

      // Pool vazio e sem link informado: usa o provedor padrão (nunca fica sem sala).
      const codigo = sala?.codigo || telagem.codigoDoCanal(interaction.guildId, chave);
      const url = sala?.url || null;

      await canal.send(telagem.painel(codigo, { url, origem: sala?.origem || null }));

      const destino = telagem.link(codigo, { url });
      const deOnde = sala?.origem === 'pool' || sala?.origem === 'reservado'
        ? 'link exclusivo do pool do Meet'
        : sala?.origem === 'manual'
          ? 'link informado no comando'
          : 'sala gerada (configure o pool do Meet com /telagem_links)';

      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            (partida ? `Sala de telagem criada para a partida \`${partida.id}\`.` : 'Sala de telagem criada para este canal.') +
              `\n**Código:** \`${codigo}\`` +
              `\n**Link:** ${destino}` +
              `\n**Origem:** ${deOnde}`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
