'use strict';

/** Base local para seed; sorteios e histórico persistente ficam no Supabase. */

const fs = require('fs');
const path = require('path');
const supabase = require('./supabase');

const CAMINHO_DADOS = path.join(__dirname, '..', '..', 'versiculos.json');
let cacheVersiculos = null;

function listarVersiculos() {
  if (cacheVersiculos) return cacheVersiculos;

  const dados = JSON.parse(fs.readFileSync(CAMINHO_DADOS, 'utf8'));
  if (!Array.isArray(dados) || dados.length < 1000) {
    throw new Error('versiculos.json precisa conter pelo menos 1.000 versículos.');
  }
  const ids = new Set();
  for (const item of dados) {
    if (!item?.id || !item?.texto || !item?.referencia || ids.has(item.id)) {
      throw new Error('versiculos.json contém um registro incompleto ou um ID duplicado.');
    }
    ids.add(item.id);
  }

  cacheVersiculos = dados;
  return cacheVersiculos;
}

async function sortear(opcoes = {}) {
  return supabase.sortearVersiculo(opcoes.guildId, opcoes.userId, opcoes.cliente);
}

module.exports = { CAMINHO_DADOS, listarVersiculos, sortear };
