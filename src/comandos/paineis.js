'use strict';

/**
 * Um comando de painel para cada um dos 15 modos de AP.
 *
 * O comando NÃO cria canal nenhum: publica as 15 mensagens (da maior aposta no
 * topo até a menor na última, embaixo) direto no canal onde a staff executou o
 * comando.
 *
 * Quem cria canal é o matchmaking: quando dois jogadores fecham a mesma faixa,
 * o bot abre a sala privada da partida DENTRO da categoria configurada
 * (CATEGORIA_FILAS_ID no .env ou `/boombot setcategoria`).
 */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const paineis = require('../servicos/paineis');
const filas = require('../servicos/filas');
const auditoria = require('../servicos/auditoria');
const { exigirStaff, responderErro, responderPrivado } = require('../util/seguranca');
const { embedSucesso } = require('../util/embeds');

const comandos = config.MODOS.map((modo) => ({
  data: new SlashCommandBuilder()
    .setName(modo.comando)
    .setDescription(
      `Publica a fila de AP ${modo.titulo} NESTE canal (${config.PRECOS.length} mensagens, de R$ 0,50 a R$ 100,00)`,
    ),

  async executar(interaction, { db, client }) {
    if (!interaction.guild) {
      return responderErro(interaction, 'Esse comando funciona apenas dentro do servidor da ORG.');
    }
    if (!(await exigirStaff(interaction, 'Só a staff/ADM pode publicar painéis de AP.'))) return;

    // Sempre o canal ATUAL do comando: o bot não cria nem move canal aqui.
    const canal = interaction.channel;
    if (!canal || typeof canal.send !== 'function') {
      return responderErro(interaction, 'Use esse comando em um canal de texto.');
    }

    const entradas = filas.listar(db, { guildId: interaction.guildId, modo: modo.id });
    const enviadas = await paineis.publicarFila(db, canal, {
      guildId: interaction.guildId,
      modo,
      entradas,
    });

    await auditoria.registrar(db, client, {
      guildId: interaction.guildId,
      autorId: interaction.user.id,
      acao: 'Painel publicado',
      detalhe: `${modo.titulo} em #${canal.name || canal.id} · ${enviadas.length} mensagens`,
    });

    return responderPrivado(interaction, {
      embeds: [
        embedSucesso(
          `✅ Fila **${modo.titulo}** publicada aqui em <#${canal.id}> com **${enviadas.length} mensagens** ` +
            '(menor valor por último, embaixo).' +
            '\n_Quando dois jogadores fecharem a mesma faixa, a sala privada nasce dentro da categoria das filas._',
        ),
      ],
    });
  },
}));

module.exports = { comandos };
