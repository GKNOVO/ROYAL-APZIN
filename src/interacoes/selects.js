'use strict';

/** Menu de preços: mostra os botões de gelo só para quem escolheu a faixa. */

const config = require('../config');
const filas = require('../servicos/filas');
const paineis = require('../servicos/paineis');
const { responderPrivado, responderErro } = require('../util/seguranca');
const { embed, reais, listaUsuarios } = require('../util/embeds');

async function handleSelect(interaction, ctx) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap' || partes[1] !== 'preco') return false;

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
  const infinito = entradas.filter((linha) => linha.gelo === 'infinito').map((linha) => linha.user_id);
  const normal = entradas.filter((linha) => linha.gelo === 'normal').map((linha) => linha.user_id);

  const descricao = [
    `**Modo:** ${modo.titulo}`,
    `**Aposta:** ${reais(preco)} por jogador`,
    `**Fecha com:** ${modo.jogadores} jogadores`,
    '',
    `🧊 **Gelo Infinito** (${infinito.length}/${modo.jogadores}): ${listaUsuarios(infinito)}`,
    `🧊 **Gelo Normal** (${normal.length}/${modo.jogadores}): ${listaUsuarios(normal)}`,
    '',
    'Escolha o tipo de gelo para entrar:',
  ].join('\n');

  await responderPrivado(interaction, {
    embeds: [embed(`🎯 AP ${modo.titulo} · ${reais(preco)}`, descricao, { cor: config.CORES.gelo })],
    components: paineis.componentesGelo(modo, preco),
  });
  return true;
}

module.exports = { handleSelect };
