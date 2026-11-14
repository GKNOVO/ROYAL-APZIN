'use strict';

/** Perfil do jogador, ranking, histórico de apostas e convites. */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const usuarios = require('../servicos/usuarios');
const staff = require('../servicos/staff');
const convites = require('../servicos/convites');
const auditoria = require('../servicos/auditoria');
const royalSupabase = require('../servicos/royalSupabase');
const { responderPrivado, responder } = require('../util/seguranca');
const { embed, reais, numeroBR, dataBR, mencao } = require('../util/embeds');

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('perfil')
      .setDescription('Mostra estatísticas, saldo e histórico do jogador')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Ver o perfil de outra pessoa')),

    async executar(interaction, { db }) {
      const alvo = interaction.options.getUser('usuario') ?? interaction.user;
      const resumo = usuarios.resumo(db, interaction.guildId, alvo.id);
      const posicao = usuarios.posicaoNoRanking(db, interaction.guildId, alvo.id, 'vitorias');
      const registroStaff = staff.obter(db, interaction.guildId, alvo.id);
      const ultimas = usuarios.historicoApostas(db, interaction.guildId, alvo.id, 3);

      const campos = [
        { name: 'Vitórias', value: resumo.vitorias.toString(), inline: true },
        { name: 'Derrotas', value: `${resumo.derrotas}${resumo.wos ? ` (${resumo.wos} W.O.)` : ''}`, inline: true },
        { name: 'Aproveitamento', value: `${resumo.aproveitamento}%`, inline: true },
        { name: `${config.MOEDA}`, value: numeroBR(resumo.coins), inline: true },
        { name: 'Giros', value: numeroBR(resumo.giros), inline: true },
        { name: 'Já apostou', value: reais(resumo.apostado), inline: true },
        { name: 'Prêmios recebidos', value: reais(resumo.ganho), inline: true },
        { name: 'Posição no ranking', value: posicao ? `#${posicao}` : 'fora do top', inline: true },
        { name: 'Convites', value: convites.contar(db, interaction.guildId, alvo.id).toString(), inline: true },
      ];

      if (registroStaff?.pix_chave) {
        campos.push({
          name: 'Mediador',
          value: `Comissão ${(registroStaff.comissao * 100).toFixed(0)}%${registroStaff.ativo ? '' : ' · inativo'}`,
          inline: true,
        });
      }

      if (ultimas.length) {
        campos.push({
          name: 'Últimas apostas',
          value: ultimas
            .map((partida) => {
              const ganhou = partida.meu_time === partida.vencedor_time;
              const icone = partida.status === 'cancelada' ? '🚫' : ganhou ? '✅' : '❌';
              return `${icone} ${reais(partida.preco)} · ${partida.modo}`;
            })
            .join('\n'),
          inline: false,
        });
      }

      return responderPrivado(interaction, {
        embeds: [
          embed(`📊 Perfil de ${alvo.username}`, `Membro ${mencao(alvo.id)} · ${resumo.total} AP(s) jogados`, {
            cor: config.CORES.ouro,
            campos,
            thumbnail: alvo.displayAvatarURL?.(),
            rodape: 'ORG Royal AP',
          }),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('ranking')
      .setDescription('Tabela de líderes da ORG Royal AP')
      .addStringOption((opcao) =>
        opcao
          .setName('tipo')
          .setDescription('O que rankear')
          .addChoices(
            { name: 'Vitórias', value: 'vitorias' },
            { name: `${config.MOEDA}`, value: 'coins' },
            { name: 'Giros', value: 'giros' },
            { name: 'Invites', value: 'invites' },
          ),
      ),

    async executar(interaction, { db }) {
      const tipo = interaction.options.getString('tipo') ?? 'vitorias';
      const lista = tipo === 'invites' && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
        ? await royalSupabase.rankingConvites(interaction.guildId, config.LIMITES.RANKING)
        : usuarios.top(db, interaction.guildId, tipo, config.LIMITES.RANKING);
      const medalhas = ['🥇', '🥈', '🥉'];

      const corpo = lista.length
        ? lista
            .map((linha, indice) => {
              const posicao = medalhas[indice] ?? `**${indice + 1}.**`;
              const valor = tipo === 'invites'
                  ? `${numeroBR(linha.total)} convite(s)`
                  : tipo === 'coins'
                  ? `${numeroBR(linha.coins)} ${config.MOEDA}`
                  : tipo === 'giros'
                    ? `${numeroBR(linha.giros)} giros`
                    : `${linha.vitorias}V / ${linha.derrotas}D`;
              return `${posicao} ${mencao(linha.user_id)} — ${valor}`;
            })
            .join('\n')
        : 'Ainda não tem ninguém no ranking. Publiquem os painéis e comecem os APs!';
      const titulo = tipo === 'invites' ? '📨 Ranking de invites' : tipo === 'coins' ? '💰 Ranking de moedas' : tipo === 'giros' ? '🎰 Ranking de giros' : '🏆 Ranking de vitórias';
      return responder(interaction, { embeds: [embed(titulo, corpo, { rodape: 'ORG Royal AP' })] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('apostas')
      .setDescription('Histórico de apostas de um jogador')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Ver o histórico de outra pessoa')),

    async executar(interaction, { db }) {
      const alvo = interaction.options.getUser('usuario') ?? interaction.user;
      const lista = usuarios.historicoApostas(db, interaction.guildId, alvo.id, config.LIMITES.HISTORICO);

      const corpo = lista.length
        ? lista
            .map((partida) => {
              const resultado =
                partida.status === 'cancelada'
                  ? '🚫 cancelada'
                  : partida.meu_time === partida.vencedor_time
                    ? '✅ vitória'
                    : '❌ derrota';
              return `\`${partida.id}\` · ${reais(partida.preco)} · ${partida.modo} · ${resultado} · ${dataBR(partida.finalizada_em)}`;
            })
            .join('\n')
        : 'Nenhuma aposta finalizada ainda.';

      return responderPrivado(interaction, {
        embeds: [embed(`🎲 Apostas de ${alvo.username}`, corpo, { rodape: 'ORG Royal AP' })],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('convites')
      .setDescription('Ranking de quem mais convida para a ORG')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Ver os convites de uma pessoa')),

    async executar(interaction, { db }) {
      const alvo = interaction.options.getUser('usuario');
      if (alvo) {
        const total = convites.contar(db, interaction.guildId, alvo.id);
        const quemConvidou = convites.doConvidado(db, interaction.guildId, alvo.id);
        return responderPrivado(interaction, {
          embeds: [
            embed(
              `📨 Convites de ${alvo.username}`,
              `Convidou **${total}** pessoa(s) para a ORG.` +
                (quemConvidou ? `\nEntrou por convite de ${mencao(quemConvidou.convidador_id)}.` : ''),
            ),
          ],
        });
      }

      const lista = convites.top(db, interaction.guildId, config.LIMITES.RANKING);
      const corpo = lista.length
        ? lista.map((linha, indice) => `**${indice + 1}.** ${mencao(linha.convidador_id)} — ${linha.total} convite(s)`).join('\n')
        : 'Ainda não registrei convites. Eu conto a partir do momento em que o bot ficou online.';

      return responderPrivado(interaction, {
        embeds: [embed('📨 Ranking de convites', corpo, { rodape: 'ORG Royal AP' })],
      });
    },
  },
];

module.exports = { comandos };
