'use strict';

/** Mensagens de entrada e saída nos canais configurados por servidor. */

const { EmbedBuilder, Events } = require('discord.js');
const persistenciaSupabase = require('../servicos/supabase');

const COR_ESCURO = 0x2b2d31;

function urlAvatar(member) {
  return member.user.displayAvatarURL({ dynamic: true, size: 256 });
}

function embedEntrada(member) {
  const criado = Math.floor(member.user.createdTimestamp / 1000);
  return new EmbedBuilder()
    .setColor(COR_ESCURO)
    .setTitle('👋 Novo Jogador')
    .setDescription(
      `<@${member.id}> • \`${member.user.username}\`\n\n` +
        `**Conta criada:** <t:${criado}:R>\n` +
        `**Jogadores agora:** ${member.guild.memberCount}`,
    )
    .setThumbnail(urlAvatar(member));
}

function embedSaida(member) {
  const criado = Math.floor(member.user.createdTimestamp / 1000);
  return new EmbedBuilder()
    .setColor(COR_ESCURO)
    .setTitle('👋 Jogador saiu')
    .setDescription(
      `<@${member.id}> • ${member.user.username}\n` +
        `**Conta criada:** <t:${criado}:R>\n` +
        `**Jogadores agora:** ${member.guild.memberCount}`,
    )
    .setThumbnail(urlAvatar(member));
}

async function publicar(member, chave, montarEmbed, clienteSupabase) {
  let canalId;
  try {
    canalId = await persistenciaSupabase.obterConfig(member.guild.id, chave, clienteSupabase);
  } catch (erro) {
    console.error(`[membros] não consegui ler ${chave} no Supabase: ${erro.message}`);
    return null;
  }
  if (!canalId) return null;

  let canal;
  try {
    canal = await member.guild.channels.fetch(canalId);
  } catch (erro) {
    console.warn(`[membros] não consegui buscar o canal ${canalId}: ${erro.message}`);
    return null;
  }
  if (!canal?.isTextBased?.() || typeof canal.send !== 'function') return null;

  try {
    return await canal.send({
      embeds: [montarEmbed(member)],
      allowedMentions: { parse: [], users: [member.id] },
    });
  } catch (erro) {
    console.error(`[membros] não consegui enviar mensagem em ${canalId}: ${erro.message}`);
    return null;
  }
}

function registrar(client) {
  client.on(Events.GuildMemberAdd, (member) =>
    publicar(member, 'canal_boas_vindas', embedEntrada),
  );
  client.on(Events.GuildMemberRemove, (member) =>
    publicar(member, 'canal_saida', embedSaida),
  );
}

module.exports = { registrar, publicar, embedEntrada, embedSaida };
