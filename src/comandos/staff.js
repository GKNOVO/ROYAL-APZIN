'use strict';

/** Comandos da staff: PIX, comissões, painel do mediador e análise. */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require('discord.js');
const config = require('../config');
const staff = require('../servicos/staff');
const partidas = require('../servicos/partidas');
const usuarios = require('../servicos/usuarios');
const auditoria = require('../servicos/auditoria');
const fluxo = require('../servicos/fluxo');
const {
  exigirStaff,
  exigirMediador,
  ehAdmin,
  ehMediador,
  responderPrivado,
  responderErro,
} = require('../util/seguranca');
const { embed, embedSucesso, reais, numeroBR, mencao, dataBR } = require('../util/embeds');

const DIA = 24 * 60 * 60 * 1000;

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('registrar_pix')
      .setDescription('Cadastra sua chave PIX de mediador (aparece nas salas que você assumir)')
      .addStringOption((opcao) =>
        opcao.setName('chave').setDescription('Sua chave PIX (CPF, e-mail, telefone ou aleatória)').setRequired(true),
      )
      .addStringOption((opcao) => opcao.setName('titular').setDescription('Nome de quem recebe'))
      .addNumberOption((opcao) =>
        opcao.setName('comissao').setDescription('Sua comissão em % (padrão 5)').setMinValue(0).setMaxValue(50),
      ),

    async executar(interaction, { db, client }) {
      if (!(await exigirStaff(interaction, 'Só staff/mediador com cargo pode registrar PIX.'))) return;

      const chave = interaction.options.getString('chave');
      const titular = interaction.options.getString('titular');
      const porcento = interaction.options.getNumber('comissao');
      const comissao = porcento === null || porcento === undefined ? undefined : porcento / 100;

      const registro = staff.registrarPix(db, {
        guildId: interaction.guildId,
        userId: interaction.user.id,
        chave,
        titular,
        comissao,
      });

      await auditoria.registrar(db, client, {
        guildId: interaction.guildId,
        autorId: interaction.user.id,
        acao: 'PIX de mediador atualizado',
        detalhe: `${mencao(interaction.user.id)} · comissão ${(registro.comissao * 100).toFixed(1)}%`,
      });

      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `Sua chave PIX foi salva e vai aparecer nas salas que você assumir.\n` +
              `**Chave:** \`${registro.pix_chave}\`\n` +
              `**Comissão:** ${(registro.comissao * 100).toFixed(1)}%\n\n` +
              '_A chave fica visível apenas para os jogadores das suas salas._',
          ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('pix')
      .setDescription('Envia sua chave PIX na sala de AP que você está mediando'),

    async executar(interaction, { db, client }) {
      if (!ehMediador(interaction.member) && !ehAdmin(interaction.member)) {
        return responderErro(interaction, 'Só o mediador da sala pode enviar o PIX.');
      }

      // Pode ser usado em QUALQUER canal: procura a sala do mediador.
      const abertas = db
        .prepare(
          `SELECT * FROM partidas
            WHERE guild_id = ? AND status IN ('aguardando_pagamento', 'pago')
            ORDER BY id DESC`,
        )
        .all(String(interaction.guildId));

      let partida = abertas.find((linha) => String(linha.canal_id) === String(interaction.channelId)) || null;

      if (!partida) {
        const minhas = abertas.filter(
          (linha) => !linha.mediador_id || String(linha.mediador_id) === String(interaction.user.id),
        );
        if (minhas.length === 1) {
          [partida] = minhas;
        } else if (minhas.length > 1) {
          return responderErro(
            interaction,
            'Você tem mais de uma sala aguardando PIX. Use `/pix` dentro do canal da sala desejada:\n' +
              minhas.map((linha) => `• <#${linha.canal_id}>`).join('\n'),
          );
        }
      }

      if (!partida) {
        return responderErro(
          interaction,
          'Nenhuma sala aguardando PIX agora. Abra o `/pix` dentro da sala ou aguarde o pagamento dos jogadores.',
        );
      }

      const registro = staff.obter(db, interaction.guildId, interaction.user.id);
      if (!registro?.pix_chave) {
        return responderErro(
          interaction,
          'Cadastre sua chave primeiro: `/registrar_pix chave:SuaChave`.',
        );
      }

      if (partida.mediador_id && partida.mediador_id !== interaction.user.id && !ehAdmin(interaction.member)) {
        return responderErro(interaction, 'Essa sala é de outro mediador.');
      }

      try {
        await fluxo.anunciarPix(client, db, {
          partidaId: partida.id,
          mediadorId: interaction.user.id,
          chave: registro.pix_chave,
          titular: registro.pix_titular,
        });
        await auditoria.registrar(db, client, {
          guildId: interaction.guildId,
          autorId: interaction.user.id,
          acao: 'PIX enviado na sala',
          detalhe: `Sala ${partida.id} · ${registro.pix_chave}`,
        });
        return responderPrivado(interaction, {
          embeds: [embedSucesso('PIX enviado na sala e na DM dos jogadores. Confira os comprovantes.')],
        });
      } catch (erro) {
        return responderErro(interaction, erro.message);
      }
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('receita_mediadores')
      .setDescription('Relatório de comissões dos mediadores')
      .addIntegerOption((opcao) =>
        opcao.setName('dias').setDescription('Período em dias (padrão 30)').setMinValue(1).setMaxValue(365),
      ),

    async executar(interaction, { db }) {
      if (!(await exigirStaff(interaction))) return;
      const dias = interaction.options.getInteger('dias') ?? 30;
      const desde = Date.now() - dias * DIA;
      const linhas = staff.receita(db, interaction.guildId, desde);

      const corpo = linhas.length
        ? linhas
            .map(
              (linha) =>
                `${mencao(linha.mediador_id)}\n` +
                `┄ ${linha.partidas} partida(s) · movimentado ${reais(linha.movimentado)}\n` +
                `┄ comissão: **${reais(Math.round(linha.comissao))}**`,
            )
            .join('\n\n')
        : 'Nenhuma partida finalizada com mediador nesse período.';

      const total = linhas.reduce((soma, linha) => soma + Math.round(linha.comissao), 0);
      return responderPrivado(interaction, {
        embeds: [
          embed(`💼 Receita dos mediadores · últimos ${dias} dias`, corpo, {
            cor: config.CORES.ouro,
            rodape: `Total de comissões: ${reais(total)}`,
          }),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('painel_mediador')
      .setDescription('Publica o painel de controle da moderação/mediadores'),

    async executar(interaction, { db, client }) {
      if (!(await exigirMediador(interaction))) return;
      const ativas = partidas.ativas(db, interaction.guildId);
      const pendentes = ativas.filter((partida) => partida.status !== 'confirmando').length;

      const embedPainel = embed(
        '👑 Painel do Mediador',
        [
          '**Rotina de uma sala:**',
          '1. Assuma a sala pelo botão **Assumir sala** dentro do canal do AP.',
          '2. Clique em **Enviar PIX** (ou use `/pix` na sala) e confira os comprovantes.',
          '3. Clique em **Pagamento recebido** e depois em **Liberar sala** com o ID e a senha.',
          '4. No fim, declare o vencedor pelo botão ou com `/vencedor`.',
          '',
          '**Comandos úteis:** `/vencedor` · `/wo` · `/registrar_pix` · `/pix` · `/receita_mediadores` · `/ticket`',
        ].join('\n'),
        {
          cor: config.CORES.principal,
          campos: [
            { name: 'Salas em andamento', value: String(ativas.length), inline: true },
            { name: 'Aguardando você', value: String(pendentes), inline: true },
            {
              name: 'Sua comissão',
              value: staff.obter(db, interaction.guildId, interaction.user.id)
                ? `${(staff.obter(db, interaction.guildId, interaction.user.id).comissao * 100).toFixed(1)}%`
                : 'sem PIX cadastrado',
              inline: true,
            },
          ],
          rodape: 'ORG Royal AP',
        },
      );

      const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ap:minhasalas').setLabel('Minhas salas').setEmoji('📋').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ap:pixinfo').setLabel('Meu PIX').setEmoji('💸').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ap:ranking').setLabel('Ranking').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
      );

      await interaction.channel.send({ embeds: [embedPainel], components: [botoes] });
      return responderPrivado(interaction, { content: '✅ Painel do mediador publicado neste canal.' });
    },
  },

  {
    data: new SlashCommandBuilder().setName('analista').setDescription('Ferramentas de análise para a staff'),

    async executar(interaction, { db }) {
      if (!(await exigirStaff(interaction))) return;
      const guildId = interaction.guildId;
      const todas = db
        .prepare('SELECT * FROM partidas WHERE guild_id = ?')
        .all(String(guildId));
      const finalizadas = todas.filter((partida) => partida.status === 'finalizada');
      const canceladas = todas.filter((partida) => partida.status === 'cancelada');
      const emAndamento = todas.filter((partida) => !['finalizada', 'cancelada'].includes(partida.status));
      const movimentado = finalizadas.reduce(
        (soma, partida) => soma + partida.preco * (config.modoPorId(partida.modo)?.jogadores ?? 2),
        0,
      );
      const porModo = new Map();
      for (const partida of finalizadas) {
        porModo.set(partida.modo, (porModo.get(partida.modo) || 0) + 1);
      }
      const modos = [...porModo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const semRegras = finalizadas.filter((partida) => !partida.regras).length;
      const ticketMedio = finalizadas.length ? Math.round(movimentado / finalizadas.length) : 0;

      const corpo = [
        `**APs finalizados:** ${finalizadas.length}`,
        `**Em andamento:** ${emAndamento.length}`,
        `**Cancelados:** ${canceladas.length}`,
        `**Valor movimentado:** ${reais(movimentado)}`,
        `**Ticket médio:** ${reais(ticketMedio)}`,
        `**Salas sem regra registrada:** ${semRegras}`,
        '',
        modos.length
          ? `**Modos que mais fecham:**\n${modos.map(([modo, total]) => `┄ ${modo}: ${total}`).join('\n')}`
          : '**Modos que mais fecham:** ainda sem dados',
      ].join('\n');

      return responderPrivado(interaction, {
        embeds: [embed('📈 Análise da ORG Royal AP', corpo, { cor: config.CORES.gelo, rodape: 'ORG Royal AP' })],
      });
    },
  },
];

module.exports = { comandos };
