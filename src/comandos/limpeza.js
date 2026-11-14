'use strict';

/** Limpeza silenciosa do canal sem clonar nem substituir o canal. */

const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { responderErro } = require('../util/seguranca');

const IDADE_LIMITE_EM_MASSA = 14 * 24 * 60 * 60 * 1000;
const PERMISSAO_PADRAO = PermissionFlagsBits.ManageMessages;
const MAXIMO_CLEAR = 100000;

function podeLimpar(interaction) {
  const permissoes = interaction.memberPermissions;
  return Boolean(
    permissoes?.has?.(PermissionFlagsBits.ManageMessages) ||
      permissoes?.has?.(PermissionFlagsBits.Administrator),
  );
}

function verificarCanal(canal) {
  if (!canal?.isTextBased?.() || !canal.messages?.fetch || typeof canal.bulkDelete !== 'function') {
    throw new Error('Este comando só funciona em canais de texto com histórico de mensagens.');
  }
}

/** Apaga exatamente as mensagens recebidas, usando exclusão individual para as antigas. */
async function apagarLote(canal, mensagens) {
  const agora = Date.now();
  const corte = agora - IDADE_LIMITE_EM_MASSA;
  const recentes = mensagens.filter((mensagem) => Number(mensagem.createdTimestamp) > corte);
  const antigas = mensagens.filter((mensagem) => Number(mensagem.createdTimestamp) <= corte);
  let apagadas = 0;

  if (recentes.length === 1) {
    await recentes[0].delete();
    apagadas += 1;
  } else if (recentes.length > 1) {
    const resultado = await canal.bulkDelete(recentes, false);
    apagadas += resultado.size;
    if (resultado.size !== recentes.length) {
      throw new Error(`O Discord apagou ${resultado.size} de ${recentes.length} mensagens recentes.`);
    }
  }

  for (const mensagem of antigas) {
    await mensagem.delete();
    apagadas += 1;
  }
  return apagadas;
}

async function apagarQuantidade(canal, quantidade) {
  verificarCanal(canal);
  let apagadas = 0;

  while (apagadas < quantidade) {
    const limite = Math.min(100, quantidade - apagadas);
    const lote = await canal.messages.fetch({ limit: limite });
    const mensagens = [...lote.values()].slice(0, limite);
    if (mensagens.length === 0) {
      throw new Error(`Só consegui apagar ${apagadas} mensagem(ns); não havia mais mensagens no canal.`);
    }

    const progresso = await apagarLote(canal, mensagens);
    if (progresso === 0) throw new Error('A limpeza parou porque nenhuma mensagem foi apagada.');
    apagadas += progresso;
  }
  return apagadas;
}

async function apagarTudo(canal) {
  verificarCanal(canal);
  let apagadas = 0;

  while (true) {
    const lote = await canal.messages.fetch({ limit: 100 });
    const mensagens = [...lote.values()];
    if (mensagens.length === 0) return apagadas;

    const progresso = await apagarLote(canal, mensagens);
    if (progresso === 0) throw new Error('A limpeza parou porque nenhuma mensagem foi apagada.');
    apagadas += progresso;
  }
}

async function removerResposta(interaction) {
  try {
    await interaction.deleteReply();
  } catch {
    // Uma limpeza longa pode ultrapassar a validade do token da interação. O
    // retorno é efêmero e, portanto, nunca fica visível no histórico do canal.
  }
}

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('clearall')
      .setDescription('Apaga todas as mensagens deste canal, inclusive as antigas')
      .setDefaultMemberPermissions(PERMISSAO_PADRAO),
    defer: 'privado',

    async executar(interaction) {
      if (!podeLimpar(interaction)) {
        return responderErro(interaction, 'Você precisa de **Manage Messages** ou **Administrator** para usar este comando.');
      }
      await apagarTudo(interaction.channel);
      return removerResposta(interaction);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Apaga a quantidade indicada das mensagens mais recentes deste canal')
      .addIntegerOption((opcao) =>
        opcao
          .setName('quantidade')
          .setDescription('Quantidade a apagar (1 a 100.000)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(MAXIMO_CLEAR),
      )
      .setDefaultMemberPermissions(PERMISSAO_PADRAO),
    defer: 'privado',

    async executar(interaction) {
      if (!podeLimpar(interaction)) {
        return responderErro(interaction, 'Você precisa de **Manage Messages** ou **Administrator** para usar este comando.');
      }
      const quantidade = interaction.options.getInteger('quantidade');
      await apagarQuantidade(interaction.channel, quantidade);
      return removerResposta(interaction);
    },
  },
];

module.exports = { comandos, apagarLote, apagarQuantidade, apagarTudo, podeLimpar };
