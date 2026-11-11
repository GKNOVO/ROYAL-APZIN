'use strict';

/**
 * Cache leve em memória (Map) para dados lidos com muita frequência:
 * configuração por servidor, cargos de mediador e canal de logs.
 *
 * Regras:
 *  • TTL curto por padrão (30s) — configuração muda pouco, mas nunca fica
 *    "presa" por muito tempo;
 *  • toda escrita (definirConfig/definirCargos) invalida a chave na hora;
 *  • o cache é por processo: em várias instâncias cada uma tem o seu, e o
 *    banco continua sendo a fonte da verdade.
 */

const TTL_PADRAO = 30 * 1000;
const LIMITE = 500;

const store = new Map();
let acertos = 0;
let erros = 0;

function podar() {
  if (store.size <= LIMITE) return;
  const agora = Date.now();
  for (const [chave, item] of store) {
    if (agora > item.expira) store.delete(chave);
  }
  // Ainda grande: remove os mais antigos (Map preserva ordem de inserção).
  while (store.size > LIMITE) {
    const primeira = store.keys().next().value;
    store.delete(primeira);
  }
}

/** Valor em cache, ou undefined quando não existe / expirou. */
function ler(chave, ttl = TTL_PADRAO) {
  const item = store.get(String(chave));
  if (!item) {
    erros += 1;
    return undefined;
  }
  if (Date.now() > item.expira) {
    store.delete(String(chave));
    erros += 1;
    return undefined;
  }
  acertos += 1;
  return item.valor;
}

function gravar(chave, valor, ttl = TTL_PADRAO) {
  store.set(String(chave), { valor, expira: Date.now() + Math.max(1, Number(ttl) || TTL_PADRAO) });
  podar();
  return valor;
}

/**
 * Devolve o valor do cache ou calcula e guarda.
 * `calcular` pode devolver null — null também é cacheado (configuração ausente).
 */
function lembrar(chave, ttl, calcular) {
  const guardado = ler(chave, ttl);
  if (guardado !== undefined) return guardado;
  const valor = calcular();
  gravar(chave, valor, ttl);
  return valor;
}

/** Apaga uma chave ou todas que começam com o prefixo. */
function invalidar(prefixo) {
  const alvo = String(prefixo);
  let removidas = 0;
  for (const chave of [...store.keys()]) {
    if (chave === alvo || chave.startsWith(alvo)) {
      store.delete(chave);
      removidas += 1;
    }
  }
  return removidas;
}

function limpar() {
  const total = store.size;
  store.clear();
  return total;
}

function estatisticas() {
  const total = acertos + erros;
  return {
    itens: store.size,
    acertos,
    erros,
    aproveitamento: total ? Math.round((acertos / total) * 100) : 0,
  };
}

module.exports = {
  TTL_PADRAO,
  LIMITE,
  ler,
  gravar,
  lembrar,
  invalidar,
  limpar,
  estatisticas,
};
