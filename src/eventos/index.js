'use strict';

/**
 * Eventos do Discord: conexão, interações, convites, entradas e erros.
 */

const { Events } = require('discord.js');
const config = require('../config');
const comandos = require('../comandos');
const { handleBotao } = require('../interacoes/botoes');
const { handleSelect } = require('../interacoes/selects');
const { handleModal } = require('../interacoes/modais');
const convites = require('../servicos/convites');
const auditoria = require('../servicos/auditoria');
const { embedErro } = require('../util/embeds');

const EFEMERO = 64;

function montar(client, db) {
  const ctx = { db, client };

  client.once(Events.ClientReady, async (conectado) => {
    console.log(`\n✅ Conectado como ${conectado.user.tag}`);
    console.log(`   Servidores: ${conectado.guilds.cache.size}`);
    try {
      conectado.user.setActivity('AP da ORG Royal AP', { type: 3 });
    } catch {
      /* atividade é opcional */
    }

    try {
      const lista = comandos.definicoes();
      if (config.GUILD_ID) {
        const guild = await conectado.guilds.fetch(config.GUILD_ID);
        await guild.commands.set(lista);
        console.log(`✅ ${lista.length} comandos registrados em "${guild.name}" (na hora).`);
      } else {
        await conectado.application.commands.set(lista);
        console.log(`✅ ${lista.length} comandos registrados globalmente (pode levar até 1 hora).`);
        console.log('   Dica: preencha GUILD_ID no .env para aparecer na hora.');
      }
      const filasPublicadas = db.prepare('SELECT COUNT(*) AS total FROM paineis').get().total;
      console.log(`   Painéis de AP já publicados: ${filasPublicadas}/15\n`);
    } catch (erro) {
      console.error('❌ Não consegui registrar os comandos:', erro.message);
      if (/Missing Access|Missing Permissions/i.test(erro.message)) {
        console.error('   Convide o bot novamente com o escopo applications.commands.');
      }
    }

    for (const guild of conectado.guilds.cache.values()) {
      await convites.atualizarCache(guild).catch(() => {});
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await comandos.executar(interaction, ctx);
        return;
      }
      if (interaction.isButton()) {
        const tratado = await handleBotao(interaction, ctx);
        if (!tratado) {
          console.warn(`[interacao] botão sem tratamento: ${interaction.customId}`);
        }
        return;
      }
      if (interaction.isStringSelectMenu()) {
        await handleSelect(interaction, ctx);
        return;
      }
      if (interaction.isModalSubmit()) {
        await handleModal(interaction, ctx);
        return;
      }
    } catch (erro) {
      console.error(`[interacao] erro em ${interaction.customId || interaction.commandName}:`, erro);
      try {
        const aviso = {
          embeds: [embedErro('Deu um erro aqui. A staff já foi avisada — tente de novo em alguns segundos.')],
          flags: EFEMERO,
        };
        // Comando já adiado → edita a mensagem "pensando" (não deixa fantasma).
        if (interaction.deferred && interaction.isChatInputCommand?.()) await interaction.editReply(aviso);
        else if (interaction.deferred || interaction.replied) await interaction.followUp(aviso);
        else await interaction.reply(aviso);
      } catch {
        /* se nem isso funcionar, o log acima já registrou */
      }
      await auditoria
        .registrar(db, client, {
          guildId: interaction.guildId,
          autorId: interaction.user?.id,
          acao: 'Erro em interação',
          detalhe: `${interaction.customId || interaction.commandName} · ${erro.message}`,
        })
        .catch(() => {});
    }
  });

  client.on(Events.GuildMemberAdd, async (membro) => {
    try {
      const codigo = await convites.detectar(db, membro);
      if (codigo) {
        const guild = membro.guild;
        const cacheConvites = await guild.invites.fetch().catch(() => null);
        const convite = cacheConvites?.get(codigo);
        if (convite?.inviter) {
          convites.registrar(db, {
            guildId: guild.id,
            convidadorId: convite.inviter.id,
            convidadoId: membro.id,
            codigo,
          });
        }
      }
    } catch (erro) {
      console.error('[convites] erro ao registrar convite:', erro.message);
    }
  });

  const atualizarConvites = (guild) => convites.atualizarCache(guild).catch(() => {});
  client.on(Events.InviteCreate, (convite) => atualizarConvites(convite.guild));
  client.on(Events.InviteDelete, (convite) => atualizarConvites(convite.guild));

  client.on(Events.Error, (erro) => console.error('[discord] erro do cliente:', erro.message));

  return ctx;
}

function ligarProcesso(db) {
  process.on('unhandledRejection', (motivo) => {
    console.error('[processo] promise rejeitada sem tratamento:', motivo);
  });
  process.on('uncaughtException', (erro) => {
    console.error('[processo] exceção não capturada:', erro);
  });

  const desligar = (sinal) => {
    console.log(`\n👋 Recebi ${sinal}, fechando o banco com segurança...`);
    try {
      db.close();
    } catch {
      /* já fechado */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => desligar('SIGINT'));
  process.on('SIGTERM', () => desligar('SIGTERM'));
}

module.exports = { montar, ligarProcesso };
