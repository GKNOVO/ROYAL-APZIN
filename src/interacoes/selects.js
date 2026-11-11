'use strict';

/** Menu de valores: mostra o card com os botões da categoria só para quem escolheu. */

const config = require('../config');
const filas = require('../servicos/filas');
const paineis = require('../servicos/paineis');
const mediadores = require('../servicos/mediadores');
const { responderPrivado, responderErro, ehAdmin } = require('../util/seguranca');
const { embed, reais, listaUsuarios } = require('../util/embeds');

async function handleSelect(interaction, ctx) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap') return false;

  // Menus do /mediadores: cargos, canal do plantão e canal do PIX.
  if (['medcargos', 'medfila', 'medpix'].includes(partes[1])) {
    try {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    } catch (erro) {
      console.error('[selects] não consegui confirmar o clique:', erro.message);
    }

    if (!ehAdmin(interaction.member)) {
      await responderErro(interaction, 'Só ADM configura o módulo de mediadores.');
      return true;
    }

    const valores = (interaction.values || []).map(String).filter(Boolean);
    if (partes[1] === 'medcargos') mediadores.definirCargos(ctx.db, interaction.guildId, valores);
    if (partes[1] === 'medfila') mediadores.definirCanalBatePonto(ctx.db, interaction.guildId, valores[0]);
    if (partes[1] === 'medpix') mediadores.definirCanalConfigPix(ctx.db, interaction.guildId, valores[0]);

    await interaction.editReply(mediadores.painelConfig(ctx.db, interaction.guildId));
    return true;
  }

  if (partes[1] !== 'preco') return false;

  // Confirma o clique na hora: o Discord exige resposta em menos de 3 segundos.
  try {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
  } catch (erro) {
    console.error('[selects] não consegui confirmar o clique:', erro.message);
  }

  const modo = config.modoPorId(partes[2]);
  if (!modo) {
    await responderErro(interaction, 'Painel antigo. Peça para a staff publicar de novo.');
    return true;
  }

  const preco = Number(interaction.values?.[0]);
  if (!config.PRECOS.includes(preco)) {
    await responderErro(interaction, 'Faixa de aposta inválida.');
    return true;
  }

  const entradas = filas.listar(ctx.db, { guildId: interaction.guildId, modo: modo.id, preco });
  const linhas = config.variantesDoModo(modo).map((variante) => {
    const ids = entradas.filter((linha) => linha.gelo === variante.id).map((linha) => linha.user_id);
    return `${variante.emoji} **${variante.nome}** (${ids.length}/${modo.jogadores}): ${listaUsuarios(ids)}`;
  });

  const descricao = [
    `**Modo:** ${modo.titulo}`,
    `**Aposta:** ${reais(preco)} por jogador`,
    `**Fecha com:** ${modo.jogadores} jogadores`,
    '',
    ...linhas,
    '',
    'Escolha o botão da sua categoria para entrar:',
  ].join('\n');

  await responderPrivado(interaction, {
    embeds: [embed(`🎯 AP ${modo.titulo} · ${reais(preco)}`, descricao, { cor: config.CORES.gelo })],
    components: paineis.componentesEntrada(modo, preco),
  });
  return true;
}

module.exports = { handleSelect };
