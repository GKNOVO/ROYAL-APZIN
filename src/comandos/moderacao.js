'use strict';

/** Moderação: blacklist, limpeza, anúncios, DMs e logs. */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { obterConfig, definirConfig } = require('../db');
const blacklist = require('../servicos/blacklist');
const auditoria = require('../servicos/auditoria');
const { exigirStaff, exigirAdmin, responderPrivado, responderErro } = require('../util/seguranca');
const { embed, embedSucesso, embedErro, mencao, dataBR } = require('../util/embeds');

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('blacklist')
      .setDescription('Lista negra de jogadores')
      .addSubcommand((sub) =>
        sub
          .setName('adicionar')
          .setDescription('Bloqueia um jogador de entrar nas filas')
          .addUserOption((o) => o.setName('usuario').setDescription('Jogador').setRequired(true))
          .addStringOption((o) => o.setName('motivo').setDescription('Motivo do bloqueio').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remover')
          .setDescription('Tira um jogador da lista negra')
          .addUserOption((o) => o.setName('usuario').setDescription('Jogador').setRequired(true)),
      )
      .addSubcommand((sub) => sub.setName('listar').setDescription('Mostra todos os bloqueados')),

    async executar(interaction, { db, client }) {
      if (!(await exigirStaff(interaction))) return;
      const sub = interaction.options.getSubcommand();

      if (sub === 'listar') {
        const lista = blacklist.listar(db, interaction.guildId);
        const corpo = lista.length
          ? lista
              .map(
                (linha) =>
                  `${mencao(linha.user_id)} — **${linha.motivo}**\n┄ por ${mencao(linha.autor_id)} em ${dataBR(linha.criado_em)}`,
              )
              .join('\n\n')
          : 'Ninguém na lista negra. 🙌';
        return responderPrivado(interaction, {
          embeds: [embed('🚫 Lista negra', corpo, { cor: config.CORES.erro })],
        });
      }

      if (!(await exigirAdmin(interaction, 'Só ADM pode alterar a lista negra.'))) return;
      const alvo = interaction.options.getUser('usuario');

      if (sub === 'adicionar') {
        const motivo = interaction.options.getString('motivo');
        blacklist.adicionar(db, {
          guildId: interaction.guildId,
          userId: alvo.id,
          motivo,
          autorId: interaction.user.id,
        });
        await auditoria.registrar(db, client, {
          guildId: interaction.guildId,
          autorId: interaction.user.id,
          acao: 'Blacklist adicionada',
          detalhe: `${mencao(alvo.id)} · ${motivo}`,
        });
        return responderPrivado(interaction, {
          embeds: [embedSucesso(`${mencao(alvo.id)} foi bloqueado de entrar nas filas.\nMotivo: **${motivo}**`)],
        });
      }

      const removeu = blacklist.remover(db, { guildId: interaction.guildId, userId: alvo.id });
      if (!removeu) return responderErro(interaction, `${mencao(alvo.id)} não estava na lista negra.`);

      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'Blacklist removida',
        detalhe: mencao(alvo.id),
      });
      return responderPrivado(interaction, {
        embeds: [embedSucesso(`${mencao(alvo.id)} saiu da lista negra e já pode entrar nas filas.`)],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('limpar')
      .setDescription('Apaga mensagens do canal')
      .addIntegerOption((opcao) =>
        opcao
          .setName('quantidade')
          .setDescription('Quantas mensagens apagar (1 a 100)')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100),
      ),

    async executar(interaction) {
      if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageMessages)) {
        return responderErro(interaction, 'Você precisa da permissão **Gerenciar Mensagens**.');
      }
      const quantidade = Math.min(interaction.options.getInteger('quantidade'), config.LIMITES.MENSAGENS_LIMPAR);
      await interaction.deferReply({ flags: 64 }).catch(() => {});
      try {
        const apagadas = await interaction.channel.bulkDelete(quantidade, true);
        return interaction.editReply({
          content: `🧹 Apaguei **${apagadas.size}** mensagem(ns). (Mensagens com mais de 14 dias não podem ser apagadas em massa.)`,
        });
      } catch (erro) {
        return interaction.editReply({ content: `❌ Não consegui apagar: ${erro.message}` });
      }
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('anunciar')
      .setDescription('Envia um anúncio oficial formatado')
      .addStringOption((opcao) => opcao.setName('titulo').setDescription('Título do anúncio').setRequired(true))
      .addStringOption((opcao) => opcao.setName('mensagem').setDescription('Texto do anúncio').setRequired(true))
      .addChannelOption((opcao) => opcao.setName('canal').setDescription('Canal (vazio = aqui)')),

    async executar(interaction, { db, client }) {
      if (!(await exigirAdmin(interaction))) return;
      const titulo = interaction.options.getString('titulo');
      const mensagem = interaction.options.getString('mensagem');
      const canal = interaction.options.getChannel('canal') ?? interaction.channel;

      const enviado = await canal.send({
        content: '@everyone',
        embeds: [
          embed(`📢 ${titulo}`, mensagem, {
            cor: config.CORES.ouro,
            rodape: `ORG Royal AP · por ${interaction.user.username}`,
          }),
        ],
        allowedMentions: { parse: ['everyone'] },
      });

      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'Anúncio publicado',
        detalhe: `${titulo} em ${canal.name} · ${enviado.id}`,
      });

      return responderPrivado(interaction, { content: `✅ Anúncio publicado em ${canal}.` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('enviar_dm')
      .setDescription('Envia uma mensagem privada pelo bot')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Quem recebe').setRequired(true))
      .addStringOption((opcao) => opcao.setName('mensagem').setDescription('Texto da mensagem').setRequired(true)),

    async executar(interaction, { db, client }) {
      if (!(await exigirStaff(interaction))) return;
      const alvo = interaction.options.getUser('usuario');
      const mensagem = interaction.options.getString('mensagem');
      await interaction.deferReply({ flags: 64 }).catch(() => {});

      try {
        await alvo.send({
          embeds: [embed('📩 Mensagem da ORG Royal AP', mensagem, { rodape: 'Não responda esta mensagem: fale com a staff no servidor.' })],
        });
      } catch (erro) {
        return interaction.editReply({
          content: `❌ Não consegui mandar DM para ${mencao(alvo.id)} (a pessoa pode ter DMs fechadas).\n\`${erro.message}\``,
        });
      }

      db.prepare(
        'INSERT INTO logs_dm (guild_id, user_id, autor_id, mensagem, criado_em) VALUES (?, ?, ?, ?, ?)',
      ).run(interaction.guildId, alvo.id, interaction.user.id, mensagem, Date.now());

      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'DM enviada',
        detalhe: mencao(alvo.id),
      });
      return interaction.editReply({ content: `✅ DM enviada para ${mencao(alvo.id)}.` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('envio_massa')
      .setDescription('Envia uma mensagem para todos os membros (com confirmação)')
      .addStringOption((opcao) => opcao.setName('mensagem').setDescription('Texto que todos vão receber').setRequired(true))
      .addBooleanOption((opcao) =>
        opcao.setName('confirmar').setDescription('Marcar como true só depois de conferir o texto').setRequired(true),
      ),

    async executar(interaction, { db, client }) {
      if (!(await exigirAdmin(interaction))) return;
      const mensagem = interaction.options.getString('mensagem');
      const confirmar = interaction.options.getBoolean('confirmar');
      const guild = interaction.guild;

      let membros;
      try {
        membros = await guild.members.fetch();
      } catch (erro) {
        return responderErro(
          interaction,
          'Não consegui ler a lista de membros. Ative a opção **Server Members Intent** no Developer Portal (menu Bot).',
        );
      }
      const alvos = membros.filter((membro) => !membro.user.bot).first(config.LIMITES.DM_MASSA);

      if (!confirmar) {
        return responderPrivado(interaction, {
          embeds: [
            embed(
              '⚠️ Confirmação necessária',
              `Essa mensagem vai para **${alvos.length}** membros (limite ${config.LIMITES.DM_MASSA}).\n\n` +
                `**Texto:** ${mensagem}\n\n` +
                'Se estiver certo, rode de novo com `confirmar: true`.',
              { cor: config.CORES.aviso },
            ),
          ],
        });
      }

      await interaction.deferReply({ flags: 64 }).catch(() => {});
      let enviadas = 0;
      let falhas = 0;
      for (const membro of alvos) {
        try {
          await membro.send({ embeds: [embed('📣 Recado da ORG Royal AP', mensagem)] });
          enviadas += 1;
        } catch {
          falhas += 1;
        }
        await espera(150);
      }

      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'Envio em massa',
        detalhe: `${enviadas} enviadas, ${falhas} falhas`,
      });

      return interaction.editReply({
        content: `📣 Envio em massa terminado: **${enviadas}** entregues, **${falhas}** falharam (DM fechada ou membro saiu).`,
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('limpardm')
      .setDescription('Apaga o histórico de DMs do bot com um jogador')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Jogador').setRequired(true)),

    async executar(interaction, { db }) {
      if (!(await exigirAdmin(interaction))) return;
      const alvo = interaction.options.getUser('usuario');
      const info = db
        .prepare('DELETE FROM logs_dm WHERE guild_id = ? AND user_id = ?')
        .run(interaction.guildId, alvo.id);
      return responderPrivado(interaction, {
        content: `🧹 Apaguei **${info.changes}** registro(s) de DM com ${mencao(alvo.id)}.`,
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('logs')
      .setDescription('Define ou mostra o canal de auditoria')
      .addChannelOption((opcao) => opcao.setName('canal').setDescription('Canal que vai receber os logs')),

    async executar(interaction, { db }) {
      if (!(await exigirAdmin(interaction))) return;
      const canal = interaction.options.getChannel('canal');

      if (canal) {
        definirConfig(db, interaction.guildId, 'canal_logs', canal.id);
        return responderPrivado(interaction, {
          embeds: [embedSucesso(`Canal de logs definido: ${canal}.\nTudo que a staff fizer vai aparecer lá.`)],
        });
      }

      const atual = obterConfig(db, interaction.guildId, 'canal_logs', config.CANAL_LOGS_ID);
      const recentes = auditoria.recentes(db, interaction.guildId, 10);
      const corpo = recentes.length
        ? recentes
            .map((linha) => `\`${dataBR(linha.criado_em)}\` **${linha.acao}** — ${linha.detalhe || '—'}`)
            .join('\n')
        : 'Nenhuma ação registrada ainda.';

      return responderPrivado(interaction, {
        embeds: [
          embed('📋 Auditoria', corpo, {
            campos: [{ name: 'Canal de logs', value: atual ? `<#${atual}>` : 'não definido', inline: true }],
          }),
        ],
      });
    },
  },
];

module.exports = { comandos };
