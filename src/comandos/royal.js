'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const royal = require('../servicos/royalSupabase');
const { responder, responderPrivado, responderErro } = require('../util/seguranca');
const { embed, embedSucesso, numeroBR } = require('../util/embeds');

function precisaSupabase() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('O sistema persistente ainda não está configurado. Defina o Supabase na hospedagem.');
  }
}

async function entregarCargo(interaction, roleId) {
  if (!roleId || !interaction.member?.roles?.add) {
    throw new Error('Não foi possível localizar o cargo ou membro para entrega.');
  }
  await interaction.member.roles.add(String(roleId));
}

async function auditarEntregaPendente({ guildId, userId, requestId, tipo, valor, erro }) {
  await royal.auditar({
    guildId,
    actorId: userId,
    action: 'reward.delivery.pending',
    entityType: tipo,
    entityId: requestId,
    requestId,
    detail: `Entrega pendente (${valor}): ${String(erro?.message || 'falha Discord').slice(0, 300)}`,
  });
}

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('roleta')
      .setDescription('Roleta persistente da ORG Royal AP')
      .addSubcommand((sub) => sub.setName('girar').setDescription('Gira a roleta usando um giro disponível'))
      .addSubcommand((sub) => sub.setName('painel').setDescription('Mostra o painel da roleta')),

    async executar(interaction) {
      precisaSupabase();
      const sub = interaction.options.getSubcommand();
      if (sub === 'painel') {
        return responder(interaction, {
          embeds: [
            embed(
              '🎰 Roleta Royal AP',
              'Use **/roleta girar** para sortear um prêmio. O giro, o resultado e os prêmios são registrados no Supabase.',
              { cor: config.CORES.principal },
            ),
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('ap:roletagirar')
                .setLabel('Girar roleta')
                .setEmoji('🎰')
                .setStyle(ButtonStyle.Primary),
            ),
          ],
        });
      }

      const resultado = await royal.girar({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        request: interaction.id,
      });
      if (!resultado) throw new Error('A roleta não retornou um resultado. Confira os prêmios ativos no Supabase.');

      let entrega = 'O giro foi debitado e o prêmio foi registrado com segurança.';
      if (resultado.reward_type === 'role') {
        try {
          await entregarCargo(interaction, resultado.reward_value);
          await royal.marcarRecompensaEntregue({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            request: interaction.id,
          });
          entrega = 'O cargo foi concedido e a entrega foi marcada no Supabase.';
        } catch (erro) {
          await auditarEntregaPendente({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            requestId: resultado.spin_id,
            tipo: 'roulette_spin',
            valor: resultado.reward_value,
            erro,
          });
          entrega = 'O prêmio foi registrado, mas a entrega do cargo ficou pendente para a staff.';
        }
      }

      await royal.auditar({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'roulette.spin',
        entityType: 'roulette_spin',
        entityId: resultado.spin_id,
        requestId: interaction.id,
        detail: resultado.prize_name,
      });
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `🎰 Você ganhou **${resultado.prize_name}**!\n` +
              `Recompensa: **${resultado.reward_type} · ${resultado.reward_value}**\n\n${entrega}`,
          ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('lojinha')
      .setDescription('Lojinha persistente da ORG Royal AP')
      .addSubcommand((sub) => sub.setName('listar').setDescription('Lista os produtos disponíveis'))
      .addSubcommand((sub) =>
        sub
          .setName('comprar')
          .setDescription('Compra um produto pelo ID')
          .addStringOption((opcao) => opcao.setName('item').setDescription('ID do produto').setRequired(true)),
      ),

    async executar(interaction) {
      precisaSupabase();
      const sub = interaction.options.getSubcommand();
      const itens = await royal.listarItens(interaction.guildId);
      if (sub === 'listar') {
        const corpo = itens.length
          ? itens
              .map(
                (item) =>
                  `**${item.name}** — ${numeroBR(item.price)} ${config.MOEDA}\n` +
                  `\`${item.id}\` · ${item.description || 'Sem descrição'} · ` +
                  `${item.stock === null ? 'estoque livre' : `${item.stock} disponível(is)`}`,
              )
              .join('\n\n')
          : 'Nenhum produto ativo foi cadastrado.';
        return responderPrivado(interaction, {
          embeds: [embed('🛍️ Lojinha Royal AP', corpo, { cor: config.CORES.ouro, rodape: 'Compre usando /lojinha comprar item:<ID>' })],
        });
      }

      const id = interaction.options.getString('item');
      const item = itens.find((linha) => linha.id === id || linha.slug === id);
      if (!item) return responderErro(interaction, 'Produto não encontrado ou indisponível. Use `/lojinha listar`.');

      const compra = await royal.comprar({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        itemId: item.id,
        request: interaction.id,
      });
      let entrega = 'O item foi adicionado ao seu inventário.';

      if (item.reward_type === 'role' && compra.status === 'pending') {
        try {
          await entregarCargo(interaction, item.reward_value);
          await royal.marcarCompraEntregue({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            purchaseId: compra.purchase_id,
          });
          entrega = 'O cargo foi concedido e a entrega foi registrada no Supabase.';
        } catch (erro) {
          await auditarEntregaPendente({
            guildId: interaction.guildId,
            userId: interaction.user.id,
            requestId: compra.purchase_id,
            tipo: 'purchase',
            valor: item.reward_value,
            erro,
          });
          entrega = 'A compra foi registrada, mas a entrega do cargo ficou pendente para a staff.';
        }
      } else if (item.reward_type === 'role') {
        entrega = compra.status === 'delivered'
          ? 'O cargo já foi concedido.'
          : 'A entrega do cargo está registrada como pendente para a staff.';
      } else if (['physical', 'pix'].includes(item.reward_type)) {
        entrega = 'Seu resgate foi registrado como pendente para pagamento ou entrega pela ADM.';
      }

      await royal.auditar({
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        action: 'shop.purchase',
        entityType: 'purchase',
        entityId: compra.purchase_id,
        requestId: interaction.id,
        detail: item.name,
      });
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `✅ Compra registrada: **${item.name}**\n` +
              `Saldo restante: **${numeroBR(compra.new_balance)} ${config.MOEDA}**\n\n${entrega}`,
          ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('inventario')
      .setDescription('Mostra seus itens resgatados'),

    async executar(interaction) {
      precisaSupabase();
      const itens = await royal.inventario(interaction.guildId, interaction.user.id);
      const corpo = itens.length
        ? itens
            .map(
              (item) =>
                `**${item.royal_shop_items?.name || 'Item'}** ×${item.quantity}\n` +
                `${item.royal_shop_items?.description || ''}`,
            )
            .join('\n\n')
        : 'Seu inventário está vazio.';
      return responderPrivado(interaction, {
        embeds: [embed('🎒 Meu inventário', corpo, { cor: config.CORES.principal })],
      });
    },
  },
];

module.exports = { comandos };
