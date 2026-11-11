'use strict';

/**
 * Menus de seleção (texto, CARGO e CANAL).
 *
 * REGRA DE OURO: o Discord exige resposta em menos de 3 segundos. Por isso o
 * primeiro passo é SEMPRE confirmar o clique (deferUpdate); só depois o bot
 * grava no SQLite e redesenha o painel. Assim nenhum menu mostra
 * "O aplicativo não respondeu a tempo".
 */

const config = require('../config');
const filas = require('../servicos/filas');
const paineis = require('../servicos/paineis');
const mediadores = require('../servicos/mediadores');
const plantao = require('../servicos/plantao');
const { responderPrivado, responderErro, ehAdmin } = require('../util/seguranca');
const { embed, reais, listaUsuarios } = require('../util/embeds');

const ACOES = ['preco', 'medcargos', 'medfila', 'medpix'];

/** Confirma o clique na hora (vale para string, cargo, canal, usuário…). */
async function confirmarClique(interaction) {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferUpdate();
  } catch (erro) {
    console.error('[selects] não consegui confirmar o clique:', erro.message);
  }
}

/**
 * Publica (e fixa) o painel do tipo escolhido no canal que o ADM acabou de
 * selecionar. É o "publicou na hora" do menu de canal.
 */
async function publicarNoCanal(ctx, interaction, canalId, tipo) {
  const client = ctx?.client;
  if (!client?.channels || !canalId) return false;
  try {
    const canal =
      client.channels.cache?.get?.(canalId) || (await client.channels.fetch(canalId).catch(() => null));
    if (!canal?.send) return false;

    const payload = tipo === 'medpix' ? plantao.painelRegistroPix() : plantao.painel(ctx.db, interaction.guildId);
    const mensagem = await canal.send(payload);
    if (typeof mensagem?.pin === 'function') await mensagem.pin().catch(() => {});
    return true;
  } catch (erro) {
    console.error('[selects] não consegui publicar o painel no canal escolhido:', erro.message);
    return false;
  }
}

/** Redesenha o painel atual depois do deferUpdate. */
async function redesenhar(interaction, payload) {
  try {
    await interaction.editReply(payload);
    return true;
  } catch (erro) {
    console.error('[selects] não consegui redesenhar o painel:', erro.message);
    return false;
  }
}

async function handleSelect(interaction, ctx) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap') return false;

  const acao = partes[1];
  if (!ACOES.includes(acao)) return false;

  // 1) Confirma o clique ANTES de qualquer acesso ao banco (evita o timeout).
  await confirmarClique(interaction);

  // 2) Menus do /mediadores: cargos, canal do plantão e canal do PIX.
  if (acao.startsWith('med')) {
    if (!ehAdmin(interaction.member)) {
      await responderErro(interaction, 'Só ADM configura o módulo de mediadores.');
      return true;
    }

    // Pode vir mais de um cargo (ex.: Mediador + Administrador juntos).
    const valores = (interaction.values || []).map(String).filter(Boolean);
    try {
      if (acao === 'medcargos') mediadores.definirCargos(ctx.db, interaction.guildId, valores);
      if (acao === 'medfila') mediadores.definirCanalBatePonto(ctx.db, interaction.guildId, valores[0]);
      if (acao === 'medpix') mediadores.definirCanalConfigPix(ctx.db, interaction.guildId, valores[0]);
    } catch (erro) {
      console.error(`[selects] não consegui salvar ${acao}:`, erro.message);
      await responderErro(interaction, 'Não consegui salvar essa escolha. Tente de novo.').catch(() => {});
      return true;
    }

    // Canal escolhido → publica (e fixa) o painel lá na mesma hora.
    let aviso = null;
    if (acao === 'medfila' || acao === 'medpix') {
      const publicou = await publicarNoCanal(ctx, interaction, valores[0], acao);
      aviso = publicou
        ? '✅ Painel publicado e fixado no canal escolhido.'
        : '⚠️ Canal salvo, mas não consegui publicar o painel nele. Confira as permissões do bot.';
    }

    // Painel novo, já com a escolha gravada.
    await redesenhar(interaction, mediadores.painelConfig(ctx.db, interaction.guildId));
    if (aviso) await responderPrivado(interaction, { content: aviso }).catch(() => {});
    return true;
  }

  // 3) Menu de preço do painel de fila.
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

module.exports = { handleSelect, confirmarClique };
