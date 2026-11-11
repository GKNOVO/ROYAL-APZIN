'use strict';

/** Resultado da sala: vencedor e W.O. */

const { SlashCommandBuilder } = require('discord.js');
const partidas = require('../servicos/partidas');
const fluxo = require('../servicos/fluxo');
const { exigirMediador, responderErro, responderPrivado } = require('../util/seguranca');
const { reais, mencao } = require('../util/embeds');

/** Acha a partida pelo ID informado ou pela sala onde o comando foi usado. */
function localizar(db, interaction) {
  const idInformado = interaction.options.getString('partida');
  if (idInformado) {
    const partida = partidas.buscar(db, idInformado.trim());
    if (!partida) throw new Error(`Não achei nenhuma sala com o ID \`${idInformado}\`.`);
    return partida;
  }
  const porCanal = partidas.porCanal(db, interaction.guildId, interaction.channelId);
  if (!porCanal) {
    throw new Error('Use o comando dentro da sala da partida ou informe o ID da sala.');
  }
  return porCanal;
}

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('vencedor')
      .setDescription('Declara o time vencedor do AP e fecha a aposta')
      .addIntegerOption((opcao) =>
        opcao
          .setName('time')
          .setDescription('Quem venceu a partida')
          .setRequired(true)
          .addChoices({ name: 'Equipe 1', value: 1 }, { name: 'Equipe 2', value: 2 }),
      )
      .addStringOption((opcao) =>
        opcao.setName('partida').setDescription('ID da sala (vazio = sala onde você usou o comando)'),
      ),

    async executar(interaction, { db, client }) {
      if (!(await exigirMediador(interaction))) return;

      const time = interaction.options.getInteger('time');
      const partida = localizar(db, interaction);
      const resultado = await fluxo.encerrarPartida(client, db, {
        partidaId: partida.id,
        vencedorTime: time,
        autorId: interaction.user.id,
      });

      return interaction.editReply({
        content:
          `🏆 Resultado registrado na sala \`${partida.id}\`: **${fluxo.nomeTime(time)}** venceu o AP de ${reais(partida.preco)}.\n` +
          `Estatísticas de ${resultado.jogadores.length} jogadores atualizadas.`,
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('wo')
      .setDescription('Aplica W.O. quando um time não aparece')
      .addIntegerOption((opcao) =>
        opcao
          .setName('ausente')
          .setDescription('Time que NÃO apareceu (o outro vence)')
          .setRequired(true)
          .addChoices({ name: 'Equipe 1 não apareceu', value: 1 }, { name: 'Equipe 2 não apareceu', value: 2 }),
      )
      .addStringOption((opcao) =>
        opcao.setName('partida').setDescription('ID da sala (vazio = sala onde você usou o comando)'),
      ),

    async executar(interaction, { db, client }) {
      if (!(await exigirMediador(interaction))) return;

      const ausente = interaction.options.getInteger('ausente');
      const partida = localizar(db, interaction);
      const resultado = await fluxo.aplicarWO(client, db, {
        partidaId: partida.id,
        timeAusente: ausente,
        autorId: interaction.user.id,
      });

      return interaction.editReply({
        content:
          `⚠️ W.O. aplicado na sala \`${partida.id}\`.\n` +
          `**${fluxo.nomeTime(ausente)}** não apareceu — vitória de **${fluxo.nomeTime(ausente === 1 ? 2 : 1)}**.`,
      });
    },
  },
];

module.exports = { comandos, localizar };
