'use strict';

/**
 * /botperfil (e o atalho /setbot): painel de ADM para mudar o perfil do bot
 * direto pelo Discord, sem abrir o Developer Portal.
 *
 *   Nome      → client.user.setUsername (2 trocas por hora, limite do Discord)
 *   Avatar    → client.user.setAvatar (link direto da imagem)
 *   Descrição → client.application.edit({ description }) (o "sobre mim")
 *   Status    → client.user.setPresence (atividade do bot)
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { exigirAdmin, responderPrivado } = require('../util/seguranca');
const { embed } = require('../util/embeds');

function botao(customId, label, emoji, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

function painelPerfil() {
  const linha = new ActionRowBuilder().addComponents(
    botao('ap:botnome', 'Nome', '📝', ButtonStyle.Primary),
    botao('ap:botavatar', 'Avatar', '🖼️', ButtonStyle.Secondary),
    botao('ap:botdescricao', 'Descrição', '💬', ButtonStyle.Secondary),
    botao('ap:botstatus', 'Status', '🎮', ButtonStyle.Secondary),
  );

  const corpo = [
    'Escolha o que quer mudar — abre um formulário só para você.',
    '',
    '📝 **Nome** — nome de usuário do bot (o Discord limita a 2 trocas por hora).',
    '🖼️ **Avatar** — cole o link direto da imagem (png, jpg ou gif).',
    '💬 **Descrição** — o "sobre mim" da aplicação (até 400 caracteres).',
    '🎮 **Status** — texto que aparece embaixo do nome do bot.',
    '',
    '_Nada aqui pede token: o bot usa a própria conexão para se editar._',
  ].join('\n');

  return {
    embeds: [embed('🤖 Perfil do bot', corpo, { cor: config.CORES.principal, rodape: 'ORG Royal AP · ADM' })],
    components: [linha],
  };
}

async function executar(interaction) {
  if (!(await exigirAdmin(interaction, 'Só ADM/Gerente pode mudar o perfil do bot.'))) return;
  return responderPrivado(interaction, painelPerfil());
}

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('botperfil')
      .setDescription('Muda nome, avatar, descrição e status do bot (só ADM)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    executar,
  },
  {
    data: new SlashCommandBuilder()
      .setName('setbot')
      .setDescription('Atalho do /botperfil — perfil do bot (só ADM)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    executar,
  },
];

module.exports = { comandos, painelPerfil };
