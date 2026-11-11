'use strict';

/**
 * Um comando de painel para cada um dos 15 modos de AP.
 *
 * Com CANAL_FILA_ID (ou `/boombot setfila`) configurado, o bot cria/reaproveita
 * o canal daquele modo LOGO ABAIXO do canal de referência e publica nele as 15
 * mensagens (uma por faixa de preço, a mais barata por último). Sem canal de
 * referência ele publica no canal onde o comando foi usado.
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
      `Publica a fila de AP ${modo.titulo} (${config.PRECOS.length} mensagens, de R$ 0,50 a R$ 100,00)`,
    ),

  async executar(interaction, { db, client }) {
    if (!interaction.guild) {
      return responderErro(interaction, 'Esse comando funciona apenas dentro do servidor da ORG.');
    }
    if (!(await exigirStaff(interaction, 'Só a staff/ADM pode publicar painéis de AP.'))) return;

    // O deferReply já foi feito pelo despachante (src/comandos/index.js).
    const entradas = filas.listar(db, { guildId: interaction.guildId, modo: modo.id });

    let canal = interaction.channel;
    let referencia = null;
    let criado = false;

    try {
      referencia = await paineis.canalDeReferencia(interaction.guild, db);
      if (referencia) {
        const alvo = await paineis.garantirCanalFila(interaction.guild, db, modo);
        if (!alvo.canal) throw new Error('Não consegui preparar o canal da fila.');
        canal = alvo.canal;
        criado = alvo.criado;
      }
    } catch (erro) {
      return responderErro(
        interaction,
        `Não consegui criar o canal da fila abaixo do canal de referência: ${erro.message}\n` +
          'Confira se o bot tem **Gerenciar Canais** e se o ID do canal está certo.',
      );
    }

    if (!canal || typeof canal.send !== 'function') {
      return responderErro(interaction, 'Use esse comando em um canal de texto.');
    }

    const enviadas = await paineis.publicarFila(db, canal, {
      guildId: interaction.guildId,
      modo,
      entradas,
    });

    await auditoria.registrar(db, client, {
      guildId: interaction.guildId,
      autorId: interaction.user.id,
      acao: 'Painel publicado',
      detalhe: `${modo.titulo} em #${canal.name} · ${enviadas.length} mensagens`,
    });

    const detalhe = referencia
      ? `\nNasceu **logo abaixo** de <#${referencia.id}>${criado ? ' (canal criado agora)' : ' (canal já existia)'}.`
      : '\n_Dica: defina o canal de referência com `/boombot setfila` para o bot posicionar a fila sozinho._';

    return responderPrivado(interaction, {
      embeds: [
        embedSucesso(
          `✅ Fila **${modo.titulo}** publicada em <#${canal.id}> com **${enviadas.length} mensagens** ` +
            `(menor valor por último, embaixo).${detalhe}`,
        ),
      ],
    });
  },
}));

module.exports = { comandos };
