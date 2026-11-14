'use strict';

/** Versículo do dia e configuração dos canais de entrada/saída. */

const {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const persistenciaSupabase = require('../servicos/supabase');
const versiculos = require('../servicos/versiculos');
const { embedErro } = require('../util/embeds');
const { responderErro, responderPrivado } = require('../util/seguranca');

function dataHoraBrasilia(data = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);
  const porTipo = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${porTipo.day}/${porTipo.month}/${porTipo.year} ${porTipo.hour}:${porTipo.minute}`;
}

function embedVersiculo(usuario, versiculo, data = new Date()) {
  const nome = usuario.tag || usuario.username || usuario.globalName || usuario.id;
  const rodape = `Pedido por @${nome} | ${dataHoraBrasilia(data)}`;
  const avatar = usuario.displayAvatarURL?.({ dynamic: true, size: 256 });
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('📿 Versículo do Dia')
    .setDescription(`*"${versiculo.texto}"*\n\n**— ${versiculo.referencia}**`)
    .setFooter(avatar ? { text: rodape, iconURL: avatar } : { text: rodape });
  return embed;
}

function temAdministrator(interaction) {
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator));
}

async function configurarCanal(interaction, chave, rotulo, clienteSupabase) {
  if (!temAdministrator(interaction)) {
    return responderErro(interaction, 'Você precisa da permissão **Administrator** do Discord para configurar este canal.');
  }

  const canal = interaction.options.getChannel('canal') || interaction.channel;
  if (!canal?.isTextBased?.() || typeof canal.send !== 'function') {
    return responderErro(interaction, 'Escolha um canal de texto válido, ou execute o comando em um canal de texto.');
  }

  await persistenciaSupabase.definirConfig(interaction.guildId, chave, canal.id, clienteSupabase);
  return responderPrivado(interaction, { content: `✅ Canal de ${rotulo} salvo: ${canal}.` });
}

const canaisDeTexto = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const permissaoAdmin = PermissionFlagsBits.Administrator;

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('versiculododia')
      .setDescription('Envia um versículo bíblico ainda não usado')
      .setDefaultMemberPermissions(null),
    defer: 'publico',

    async executar(interaction, contexto = {}) {
      try {
        const sorteio = await versiculos.sortear({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          cliente: contexto.supabase,
        });
        return interaction.editReply({ embeds: [embedVersiculo(interaction.user, sorteio.versiculo)] });
      } catch (erro) {
        console.error('[versiculos] falha no sorteio:', erro.message);
        await interaction.deleteReply().catch(() => null);
        return interaction.followUp({
          embeds: [embedErro('A base de versículos não está disponível. A equipe precisa conferir o Supabase e carregar a lista.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('configcanal1')
      .setDescription('Define o canal de boas-vindas para a entrada de jogadores')
      .addChannelOption((opcao) =>
        opcao.setName('canal').setDescription('Canal de boas-vindas (vazio = canal atual)').addChannelTypes(...canaisDeTexto),
      )
      .setDefaultMemberPermissions(permissaoAdmin),

    async executar(interaction, contexto = {}) {
      return configurarCanal(interaction, 'canal_boas_vindas', 'boas-vindas', contexto.supabase);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('configcanal2')
      .setDescription('Define o canal de saída de jogadores')
      .addChannelOption((opcao) =>
        opcao.setName('canal').setDescription('Canal de saída (vazio = canal atual)').addChannelTypes(...canaisDeTexto),
      )
      .setDefaultMemberPermissions(permissaoAdmin),

    async executar(interaction, contexto = {}) {
      return configurarCanal(interaction, 'canal_saida', 'saída', contexto.supabase);
    },
  },
];

module.exports = { comandos, dataHoraBrasilia, embedVersiculo, configurarCanal };
