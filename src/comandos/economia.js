'use strict';

/** Economia: giros, moedas da loja e vitórias manuais. */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const usuarios = require('../servicos/usuarios');
const auditoria = require('../servicos/auditoria');
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
      const saldo = usuarios.adicionarGiros(db, {
        guildId: interaction.guildId,
        userId: alvo.id,
        quantidade,
        autorId: interaction.user.id,
      });
      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'Giros ajustados',
        detalhe: `${mencao(alvo.id)} · ${quantidade > 0 ? '+' : ''}${quantidade} giros · saldo ${saldo}`,
      });
      return responderPrivado(interaction, {
        embeds: [embedSucesso(`${mencao(alvo.id)} agora tem **${numeroBR(saldo)}** giros.`)],
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
      for (let i = 0; i < quantidade; i += 1) {
        usuarios.registrarVitoria(db, { guildId: interaction.guildId, userId: alvo.id });
      }
      const resumo = usuarios.resumo(db, interaction.guildId, alvo.id);
      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'Vitória manual',
        detalhe: `${mencao(alvo.id)} · +${quantidade} · total ${resumo.vitorias}`,
      });
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `+${quantidade} vitória(s) para ${mencao(alvo.id)}.\nAgora: **${resumo.vitorias}V / ${resumo.derrotas}D**.`,
          ),
        ],
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
      usuarios.registrarVitoria(db, {
        guildId: interaction.guildId,
        userId: alvo.id,
        apostado: centavos,
        ganho: centavos,
      });
      const resumo = usuarios.resumo(db, interaction.guildId, alvo.id);
      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'Vitória registrada',
        detalhe: `${mencao(alvo.id)} · valor ${centavos} centavos · total ${resumo.vitorias}`,
      });
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `Vitória registrada para ${mencao(alvo.id)}${centavos ? ` (R$ ${(centavos / 100).toFixed(2).replace('.', ',')})` : ''}.\n` +
              `Perfil: **${resumo.vitorias}V / ${resumo.derrotas}D** · ${resumo.aproveitamento}% de aproveitamento.`,
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
        usuarios.transferirCoins(db, {
          guildId: interaction.guildId,
          deId: interaction.user.id,
          paraId: alvo.id,
          valor: quantidade,
          motivo: 'envio entre jogadores',
          autorId: interaction.user.id,
        });
        const meu = usuarios.resumo(db, interaction.guildId, interaction.user.id);
        return responderPrivado(interaction, {
          embeds: [
            embedSucesso(
              `Você enviou **${numeroBR(quantidade)} ${config.MOEDA}** para ${mencao(alvo.id)}.\nSeu saldo: **${numeroBR(meu.coins)}**.`,
            ),
          ],
        });
      }

      if (!(await exigirAdmin(interaction, 'Só ADM pode mexer no saldo de outra pessoa.'))) return;

      const valor = sub === 'addcoins' ? Math.abs(quantidade) : -Math.abs(quantidade);
      const saldo = usuarios.adicionarCoins(db, {
        guildId: interaction.guildId,
        userId: alvo.id,
        valor,
        motivo: sub === 'addcoins' ? 'crédito da staff' : 'débito da staff',
        autorId: interaction.user.id,
        tipo: sub === 'addcoins' ? 'loja_credito' : 'loja_debito',
      });

      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: sub === 'addcoins' ? 'Moedas adicionadas' : 'Moedas removidas',
        detalhe: `${mencao(alvo.id)} · ${numeroBR(Math.abs(valor))} ${config.MOEDA} · saldo ${saldo}`,
      });

      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `${sub === 'addcoins' ? 'Adicionado' : 'Removido'} **${numeroBR(Math.abs(valor))} ${config.MOEDA}** de ${mencao(alvo.id)}.\nSaldo agora: **${numeroBR(saldo)}**.`,
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
