'use strict';

/** Economia: perfis, moedas, giros e vitórias persistidos no Supabase. */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const royal = require('../servicos/royalSupabase');
const { exigirStaff, exigirAdmin, responderPrivado } = require('../util/seguranca');
const { embedSucesso, numeroBR, mencao } = require('../util/embeds');

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('addgiros')
      .setDescription('Adiciona (ou tira) giros de um jogador')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Jogador').setRequired(true))
      .addIntegerOption((opcao) =>
        opcao.setName('quantidade').setDescription('Quantidade (use negativo para tirar)').setRequired(true),
      ),

    async executar(interaction, { db, client }) {
      if (!(await exigirStaff(interaction))) return;
      const alvo = interaction.options.getUser('usuario');
      const quantidade = interaction.options.getInteger('quantidade');
      if (!Number.isInteger(quantidade) || quantidade === 0) throw new Error('A quantidade de giros não pode ser zero.');
      const perfil = await royal.ajustarPerfil({
        guildId: interaction.guildId,
        userId: alvo.id,
        deltas: { spins: quantidade },
        reason: 'ajuste da staff',
        actorId: interaction.user.id,
        request: interaction.id,
      });
      await royal.auditar({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'wallet.spins.adjust',
        entityType: 'profile',
        entityId: alvo.id,
        requestId: interaction.id,
        detail: `${quantidade > 0 ? '+' : ''}${quantidade} giros`,
      });
      return responderPrivado(interaction, {
        embeds: [embedSucesso(`${mencao(alvo.id)} agora tem **${numeroBR(perfil.spins)}** giros.`)],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('addvitoria')
      .setDescription('Soma vitórias no perfil do jogador')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Jogador').setRequired(true))
      .addIntegerOption((opcao) =>
        opcao.setName('quantidade').setDescription('Quantas vitórias somar').setMinValue(1).setMaxValue(50),
      ),

    async executar(interaction, { db, client }) {
      if (!(await exigirStaff(interaction))) return;
      const alvo = interaction.options.getUser('usuario');
      const quantidade = interaction.options.getInteger('quantidade') ?? 1;
      const perfil = await royal.ajustarPerfil({
        guildId: interaction.guildId,
        userId: alvo.id,
        deltas: { wins: quantidade },
        reason: 'vitória manual',
        actorId: interaction.user.id,
        request: interaction.id,
      });
      await royal.auditar({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'profile.wins.adjust',
        entityType: 'profile',
        entityId: alvo.id,
        requestId: interaction.id,
        detail: `+${quantidade} vitória(s)`,
      });
      return responderPrivado(interaction, {
        embeds: [embedSucesso(`+${quantidade} vitória(s) para ${mencao(alvo.id)}.\nAgora: **${perfil.wins}V / ${perfil.losses}D**.`)],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('vitoria')
      .setDescription('Registra uma vitória (e opcionalmente o valor apostado)')
      .addUserOption((opcao) => opcao.setName('usuario').setDescription('Jogador').setRequired(true))
      .addNumberOption((opcao) =>
        opcao.setName('valor').setDescription('Valor apostado em reais (ex: 5 ou 5,50)').setMinValue(0),
      ),

    async executar(interaction, { db, client }) {
      if (!(await exigirStaff(interaction))) return;
      const alvo = interaction.options.getUser('usuario');
      const valor = interaction.options.getNumber('valor') ?? 0;
      const centavos = Math.max(0, Math.round(valor * 100));
      const perfil = await royal.ajustarPerfil({
        guildId: interaction.guildId,
        userId: alvo.id,
        deltas: { wins: 1, apostado: centavos, ganho: centavos },
        reason: 'vitória manual',
        actorId: interaction.user.id,
        request: interaction.id,
      });
      await royal.auditar({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'profile.win.register',
        entityType: 'profile',
        entityId: alvo.id,
        requestId: interaction.id,
        detail: `vitória; apostado/ganho ${centavos} centavos`,
      });
      const total = perfil.wins + perfil.losses;
      const aproveitamento = total ? Math.round((perfil.wins / total) * 100) : 0;
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `Vitória registrada para ${mencao(alvo.id)}${centavos ? ` (R$ ${(centavos / 100).toFixed(2).replace('.', ',')})` : ''}.\n` +
              `Perfil: **${perfil.wins}V / ${perfil.losses}D** · ${aproveitamento}% de aproveitamento.`,
          ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('loja')
      .setDescription('Loja de moedas da ORG')
      .addSubcommand((sub) =>
        sub
          .setName('addcoins')
          .setDescription('Adiciona moedas para um jogador')
          .addUserOption((o) => o.setName('usuario').setDescription('Jogador').setRequired(true))
          .addIntegerOption((o) => o.setName('quantidade').setDescription('Quantidade de moedas').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('removecoins')
          .setDescription('Remove moedas de um jogador')
          .addUserOption((o) => o.setName('usuario').setDescription('Jogador').setRequired(true))
          .addIntegerOption((o) => o.setName('quantidade').setDescription('Quantidade de moedas').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('enviar')
          .setDescription('Envia moedas para outro jogador')
          .addUserOption((o) => o.setName('usuario').setDescription('Quem recebe').setRequired(true))
          .addIntegerOption((o) => o.setName('quantidade').setDescription('Quantidade de moedas').setRequired(true)),
      ),

    async executar(interaction, { db, client }) {
      const sub = interaction.options.getSubcommand();
      const alvo = interaction.options.getUser('usuario');
      const quantidade = interaction.options.getInteger('quantidade');

      if (sub === 'enviar') {
        if (!Number.isInteger(quantidade) || quantidade <= 0) throw new Error('Informe uma quantidade maior que zero.');
        if (alvo.id === interaction.user.id) throw new Error('Você não pode enviar moedas para você mesmo.');
        const transferencia = await royal.transferirCoins({
          guildId: interaction.guildId,
          deId: interaction.user.id,
          paraId: alvo.id,
          valor: quantidade,
          actorId: interaction.user.id,
          reason: 'envio entre jogadores',
          request: interaction.id,
        });
        await royal.auditar({
          guildId: interaction.guildId,
          actorId: interaction.user.id,
          action: 'wallet.coins.transfer',
          entityType: 'profile',
          entityId: interaction.user.id,
          requestId: interaction.id,
          detail: `${numeroBR(quantidade)} ${config.MOEDA} para usuário ${alvo.id}`,
        });
        return responderPrivado(interaction, {
          embeds: [
            embedSucesso(
              `Você enviou **${numeroBR(quantidade)} ${config.MOEDA}** para ${mencao(alvo.id)}.\n` +
                `Seu saldo: **${numeroBR(transferencia.from_balance)}**.`,
            ),
          ],
        });
      }

      if (!(await exigirAdmin(interaction, 'Só ADM pode mexer no saldo de outra pessoa.'))) return;
      if (!Number.isInteger(quantidade) || quantidade <= 0) throw new Error('Informe uma quantidade maior que zero.');
      const valor = sub === 'addcoins' ? quantidade : -quantidade;
      const perfil = await royal.ajustarPerfil({
        guildId: interaction.guildId,
        userId: alvo.id,
        deltas: { coins: valor },
        reason: sub === 'addcoins' ? 'crédito da staff' : 'débito da staff',
        actorId: interaction.user.id,
        request: interaction.id,
      });
      await royal.auditar({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: sub === 'addcoins' ? 'wallet.coins.credit' : 'wallet.coins.debit',
        entityType: 'profile',
        entityId: alvo.id,
        requestId: interaction.id,
        detail: `${numeroBR(Math.abs(valor))} ${config.MOEDA}`,
      });

      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `${sub === 'addcoins' ? 'Adicionado' : 'Removido'} **${numeroBR(Math.abs(valor))} ${config.MOEDA}** de ${mencao(alvo.id)}.\n` +
              `Saldo agora: **${numeroBR(perfil.coins)}**.`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
