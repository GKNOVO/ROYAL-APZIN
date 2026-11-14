'use strict';

/** Mensagens de entrada e saída nos canais configurados por servidor. */

const { EmbedBuilder, Events } = require('discord.js');
const { obterConfig } = require('../db');

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

async function publicar(client, db, member, chave, montarEmbed) {
  const canalId = obterConfig(db, member.guild.id, chave);
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

function registrar(client, db) {
  client.on(Events.GuildMemberAdd, (member) =>
    publicar(client, db, member, 'canal_boas_vindas', embedEntrada),
  );
  client.on(Events.GuildMemberRemove, (member) =>
    publicar(client, db, member, 'canal_saida', embedSaida),
  );
}

module.exports = { registrar, publicar, embedEntrada, embedSaida };
