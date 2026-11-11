'use strict';

/**
 * /mediadores          → painel de configuração (cargos, canais, modo).
 * /painel_mediadores   → publica o painel institucional no canal atual:
 *   tipo:fila     → bate-ponto (Entrar/Sair/Atualizar/Config)
 *   tipo:registro → Central de Pagamentos (Configurar PIX / Verificar Cadastro)
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mediadores = require('../servicos/mediadores');
const plantao = require('../servicos/plantao');
const { exigirAdmin, responderPrivado, responderErro } = require('../util/seguranca');
const { embedSucesso } = require('../util/embeds');

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('mediadores')
      .setDescription('Painel de configuração dos mediadores (cargos, canais e modo)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async executar(interaction, { db }) {
      if (!(await exigirAdmin(interaction, 'Só ADM pode configurar o módulo de mediadores.'))) return;
      return responderPrivado(interaction, mediadores.painelConfig(db, interaction.guildId));
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('painel_mediadores')
      .setDescription('Publica o painel de plantão ou o painel de PIX no canal atual')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((opcao) =>
        opcao
          .setName('tipo')
          .setDescription('Qual painel publicar')
          .addChoices(
            { name: 'Fila / bate-ponto dos mediadores', value: 'fila' },
            { name: 'Registro de PIX', value: 'registro' },
          ),
      ),

    async executar(interaction, { db }) {
      if (!(await exigirAdmin(interaction, 'Só ADM pode publicar os painéis de mediação.'))) return;

      const tipo = interaction.options.getString('tipo') || 'fila';
      const canal = interaction.channel;
      if (!canal?.send) {
        return responderErro(interaction, 'Use esse comando em um canal de texto.');
      }

      const painel = tipo === 'registro' ? plantao.painelRegistroPix() : plantao.painel(db, interaction.guildId);
      const mensagem = await canal.send(painel).catch((erro) => {
        console.error('[mediadores] não consegui publicar o painel:', erro.message);
        return null;
      });
      if (!mensagem) return responderErro(interaction, 'Não consegui publicar o painel neste canal.');

      if (typeof mensagem.pin === 'function') await mensagem.pin().catch(() => {});

      if (tipo === 'fila') mediadores.definirCanalBatePonto(db, interaction.guildId, canal.id);
      else mediadores.definirCanalConfigPix(db, interaction.guildId, canal.id);

      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            tipo === 'registro'
              ? `Central de Pagamentos publicada e fixada em <#${canal.id}>.`
              : `Fila de mediadores publicada e fixada em <#${canal.id}>.`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
