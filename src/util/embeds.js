'use strict';

/** Helpers de embed, formatação de dinheiro e menções. */

const { EmbedBuilder } = require('discord.js');
const config = require('../config');

/** 50 -> "R$ 0,50" · 10000 -> "R$ 100,00" */
function reais(centavos) {
  const valor = Number(centavos) || 0;
  return `R$ ${(valor / 100).toFixed(2).replace('.', ',')}`;
}

/** 1500 -> "1.500" (contagem de moedas) */
function numeroBR(valor) {
  return (Number(valor) || 0).toLocaleString('pt-BR');
}

function dataBR(ms) {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function mencao(id) {
  return id ? `<@${id}>` : '`desconhecido`';
}

function mencaoCargo(id) {
  return id ? `<@&${id}>` : '`cargo não configurado`';
}

function listaUsuarios(ids, vazio = '—') {
  if (!ids || ids.length === 0) return vazio;
  return ids.map(mencao).join(', ');
}

/** 1x1 mobile -> 1v1 Mobile (nome curto usado nos cards). */
function tituloCurto(modo) {
  const nome = String(modo?.nome || modo?.id || '').replace(/x/gi, 'v');
  const plataforma = String(modo?.plataformaNome || '')
    .replace(/(^|\s)\S/g, (letra) => letra.toUpperCase())
    .trim();
  return `${nome} ${plataforma}`.trim();
}

function embed(titulo, descricao, opcoes = {}) {
  const montado = new EmbedBuilder()
    .setColor(opcoes.cor ?? config.CORES.principal)
    .setTimestamp();

  // Descrição é opcional: os cards minimalistas das filas usam só título + campos.
  if (descricao) montado.setDescription(descricao);
  if (titulo) montado.setTitle(titulo);
  if (Array.isArray(opcoes.campos) && opcoes.campos.length > 0) {
    montado.addFields(opcoes.campos.slice(0, 25));
  }
  if (opcoes.rodape) montado.setFooter({ text: opcoes.rodape });
  if (opcoes.thumbnail) montado.setThumbnail(opcoes.thumbnail);
  return montado;
}

const embedErro = (mensagem) => embed('❌ Não foi possível', mensagem, { cor: config.CORES.erro });
const embedSucesso = (mensagem) => embed('✅ Feito', mensagem, { cor: config.CORES.sucesso });
const embedAviso = (mensagem) => embed('⚠️ Atenção', mensagem, { cor: config.CORES.aviso });

function embedLog(acao, detalhe, autorId) {
  return embed(`📋 ${acao}`, detalhe, {
    cor: config.CORES.neutro,
    campos: autorId ? [{ name: 'Responsável', value: mencao(autorId), inline: true }] : [],
  });
}

module.exports = {
  reais,
  dataBR,
  numeroBR,
  mencao,
  mencaoCargo,
  listaUsuarios,
  tituloCurto,
  embed,
  embedErro,
  embedSucesso,
  embedAviso,
  embedLog,
};
