'use strict';

/**
 * Voz: bot entra e sai de um canal de call (sem tocar áudio).
 * Exemplo de uso: staff chama /conectarbotcall para o bot ficar na call da
 * telagem; /tirarbotcall desconecta.
 *
 * A biblioteca @discordjs/voice é carregada na hora (lazy) para o bot nunca
 * deixar de subir caso a dependência não esteja instalada na hospedagem.
 */

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { exigirStaff, responderErro } = require('../util/seguranca');
const auditoria = require('../servicos/auditoria');

let cacheVoz;

function voz() {
  if (cacheVoz !== undefined) return cacheVoz;
  try {
    cacheVoz = require('@discordjs/voice');
  } catch (erro) {
    console.error('[voz] @discordjs/voice não está instalada:', erro.message);
    cacheVoz = null;
  }
  return cacheVoz;
}

async function registrar(db, client, interaction, acao, detalhe) {
  await auditoria
    .registrar(db, client, {
      guildId: interaction.guildId,
      autorId: interaction.user.id,
      acao,
      detalhe,
    })
    .catch(() => {});
}

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('conectarbotcall')
      .setDescription('Coloca o bot em um canal de voz (staff)')
      .addChannelOption((opcao) =>
        opcao
          .setName('canal')
          .setDescription('Canal de voz onde o bot deve entrar')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),

    async executar(interaction, { db, client }) {
      if (!interaction.guild) return responderErro(interaction, 'Use esse comando dentro do servidor.');
      if (!(await exigirStaff(interaction, 'Só a staff/ADM pode colocar o bot na call.'))) return;

      const canal = interaction.options.getChannel('canal');
      if (!canal?.id) return responderErro(interaction, 'Escolha um canal de voz.');

      const disco = voz();
      if (!disco) {
        return responderErro(
          interaction,
          'A biblioteca de voz não está instalada no servidor. Rode `npm install` e reinicie o bot.',
        );
      }

      try {
        disco.joinVoiceChannel({
          channelId: canal.id,
          guildId: interaction.guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: true,
        });
      } catch (erro) {
        console.error('[voz] não consegui entrar na call:', erro.message);
        return responderErro(interaction, `Não consegui entrar em **${canal.name}**: ${erro.message}`);
      }

      await registrar(db, client, interaction, 'Bot entrou na call', `#${canal.name}`);

      return responderErro === null
        ? null
        : interaction.editReply({ content: `🎙️ Entrei na call **${canal.name}**. Use \`/tirarbotcall\` para sair.` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('tirarbotcall')
      .setDescription('Desconecta o bot do canal de voz atual (staff)'),

    async executar(interaction, { db, client }) {
      if (!interaction.guild) return responderErro(interaction, 'Use esse comando dentro do servidor.');
      if (!(await exigirStaff(interaction, 'Só a staff/ADM pode tirar o bot da call.'))) return;

      const disco = voz();
      const conexao = disco?.getVoiceConnection?.(interaction.guildId) || null;

      if (!conexao) {
        return interaction.editReply({ content: '🔇 O bot não está em nenhuma call agora.' });
      }

      const canalId = conexao.joinConfig?.channelId || null;
      try {
        conexao.destroy();
      } catch (erro) {
        console.error('[voz] não consegui sair da call:', erro.message);
        return interaction.editReply({ content: `❌ Não consegui sair da call: ${erro.message}` });
      }

      await registrar(db, client, interaction, 'Bot saiu da call', canalId ? `<#${canalId}>` : 'call atual');
      return interaction.editReply({ content: '👋 Saí da call.' });
    },
  },
];

module.exports = { comandos };
