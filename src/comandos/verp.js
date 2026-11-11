'use strict';

/**
 * /verp [@usuario] — placar direto do jogador: vitórias, derrotas e ranking.
 * Vitória = +1 vitória (e estatísticas no ranking); derrota = +1 derrota.
 */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const usuarios = require('../servicos/usuarios');
const { responder } = require('../util/seguranca');
const { embed, mencao, reais } = require('../util/embeds');

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('verp')
      .setDescription('Mostra o placar (vitórias e derrotas) de um jogador')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Ver o placar de outra pessoa')),

    // Placar é público: todos do canal podem ver.
    defer: 'publico',

    async executar(interaction, { db }) {
      const alvo = interaction.options.getUser('usuario') ?? interaction.user;
      const resumo = usuarios.resumo(db, interaction.guildId, alvo.id);
      const posicao = usuarios.posicaoNoRanking(db, interaction.guildId, alvo.id, 'vitorias');

      return responder(interaction, {
        embeds: [
          embed(`📊 Placar de ${alvo.username}`, `Membro ${mencao(alvo.id)} · ${resumo.total} AP(s) jogados`, {
            cor: config.CORES.ouro,
            campos: [
              { name: '🏆 Vitórias', value: String(resumo.vitorias), inline: true },
              {
                name: '❌ Derrotas',
                value: `${resumo.derrotas}${resumo.wos ? ` (${resumo.wos} W.O.)` : ''}`,
                inline: true,
              },
              { name: '📈 Aproveitamento', value: `${resumo.aproveitamento}%`, inline: true },
              { name: 'Ranking', value: posicao ? `#${posicao}` : 'fora do top', inline: true },
              { name: 'Já apostou', value: reais(resumo.apostado), inline: true },
              { name: 'Prêmios recebidos', value: reais(resumo.ganho), inline: true },
            ],
            thumbnail: alvo.displayAvatarURL?.(),
            rodape: 'ORG Royal AP · placar',
          }),
        ],
      });
    },
  },
];

module.exports = { comandos };
