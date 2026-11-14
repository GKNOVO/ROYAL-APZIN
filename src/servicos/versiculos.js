'use strict';

/** Sorteio persistente de versículos, sem repetição até esgotar a lista. */

const fs = require('fs');
const path = require('path');

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

/**
 * Seleciona e marca um versículo dentro da mesma transação SQLite. A chave é
 * global para o bot: o mesmo versículo não reaparece em outros servidores
 * antes de todos os demais terem sido usados.
 */
function sortear(db, opcoes = {}) {
  const versiculos = opcoes.versiculos || listarVersiculos();
  const aleatorio = opcoes.aleatorio || Math.random;
  const guildId = opcoes.guildId == null ? null : String(opcoes.guildId);
  const userId = opcoes.userId == null ? null : String(opcoes.userId);

  return db
    .transaction(() => {
      const usados = new Set(
        db.prepare('SELECT versiculo_id FROM versiculos_usados').all().map((linha) => linha.versiculo_id),
      );
      let disponiveis = versiculos.filter((versiculo) => !usados.has(versiculo.id));
      let cicloReiniciado = false;

      if (disponiveis.length === 0) {
        db.prepare('DELETE FROM versiculos_usados').run();
        disponiveis = versiculos;
        cicloReiniciado = true;
      }

      const numeroAleatorio = Number(aleatorio());
      const fracao = Number.isFinite(numeroAleatorio) ? Math.min(0.999999999999, Math.max(0, numeroAleatorio)) : 0;
      const escolhido = disponiveis[Math.floor(fracao * disponiveis.length)];

      db.prepare(
        'INSERT INTO versiculos_usados (versiculo_id, usado_em, guild_id, user_id) VALUES (?, ?, ?, ?)',
      ).run(escolhido.id, Date.now(), guildId, userId);

      return { versiculo: escolhido, cicloReiniciado };
    })();
}

module.exports = { CAMINHO_DADOS, listarVersiculos, sortear };
