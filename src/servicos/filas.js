'use strict';

/** Regras puras da fila (entrar, sair, listar, reservar grupo que fechou). */

const agora = () => Date.now();

function entrar(db, { guildId, modo, preco, gelo, userId }) {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO filas (guild_id, modo, preco, gelo, user_id, entrou_em)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(String(guildId), String(modo), Math.trunc(preco), String(gelo), String(userId), agora());

  return {
    entrou: info.changes === 1,
    posicao: posicao(db, { guildId, modo, preco, gelo, userId }),
  };
}

function listar(db, { guildId, modo, preco = null, gelo = null }) {
  const filtros = ['guild_id = ?', 'modo = ?'];
  const valores = [String(guildId), String(modo)];
  if (preco !== null && preco !== undefined) {
    filtros.push('preco = ?');
    valores.push(Math.trunc(preco));
  }
  if (gelo) {
    filtros.push('gelo = ?');
    valores.push(String(gelo));
  }
  return db
    .prepare(`SELECT * FROM filas WHERE ${filtros.join(' AND ')} ORDER BY entrou_em ASC, id ASC`)
    .all(...valores);
}

function total(db, { guildId, modo }) {
  const linha = db
    .prepare('SELECT COUNT(*) AS total FROM filas WHERE guild_id = ? AND modo = ?')
    .get(String(guildId), String(modo));
  return linha ? linha.total : 0;
}

function posicao(db, { guildId, modo, preco, gelo, userId }) {
  const grupo = listar(db, { guildId, modo, preco, gelo });
  const indice = grupo.findIndex((linha) => linha.user_id === String(userId));
  return indice === -1 ? null : indice + 1;
}

function contar(db, { guildId, modo, preco, gelo }) {
  const linha = db
    .prepare(
      'SELECT COUNT(*) AS total FROM filas WHERE guild_id = ? AND modo = ? AND preco = ? AND gelo = ?',
    )
    .get(String(guildId), String(modo), Math.trunc(preco), String(gelo));
  return linha ? linha.total : 0;
}

function sair(db, { guildId, modo, userId, preco = null, gelo = null }) {
  const filtros = ['guild_id = ?', 'modo = ?', 'user_id = ?'];
  const valores = [String(guildId), String(modo), String(userId)];
  if (preco !== null && preco !== undefined) {
    filtros.push('preco = ?');
    valores.push(Math.trunc(preco));
  }
  if (gelo) {
    filtros.push('gelo = ?');
    valores.push(String(gelo));
  }
  const info = db.prepare(`DELETE FROM filas WHERE ${filtros.join(' AND ')}`).run(...valores);
  return info.changes;
}

function remover(db, { guildId, modo, preco, gelo, ids }) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const marcas = ids.map(() => '?').join(', ');
  const info = db
    .prepare(
      `DELETE FROM filas
        WHERE guild_id = ? AND modo = ? AND preco = ? AND gelo = ? AND user_id IN (${marcas})`,
    )
    .run(String(guildId), String(modo), Math.trunc(preco), String(gelo), ...ids.map(String));
  return info.changes;
}

function limpar(db, { guildId, modo = null }) {
  if (modo) {
    return db.prepare('DELETE FROM filas WHERE guild_id = ? AND modo = ?').run(String(guildId), String(modo)).changes;
  }
  return db.prepare('DELETE FROM filas WHERE guild_id = ?').run(String(guildId)).changes;
}

function modosComFila(db, guildId) {
  return db
    .prepare('SELECT modo, COUNT(*) AS total FROM filas WHERE guild_id = ? GROUP BY modo')
    .all(String(guildId));
}

/**
 * Reserva atomicamente os próximos N jogadores de um grupo.
 * Se não houver gente suficiente, devolve null e não mexe em nada.
 */
function reservar(db, { guildId, modo, preco, gelo, quantidade }) {
  const executar = db.transaction(() => {
    const grupo = listar(db, { guildId, modo, preco, gelo });
    if (grupo.length < quantidade) return null;
    const escolhidos = grupo.slice(0, quantidade);
    remover(db, { guildId, modo, preco, gelo, ids: escolhidos.map((linha) => linha.user_id) });
    return escolhidos.map((linha) => linha.user_id);
  });
  return executar();
}

module.exports = {
  entrar,
  listar,
  total,
  posicao,
  contar,
  sair,
  remover,
  limpar,
  modosComFila,
  reservar,
};
