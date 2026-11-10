'use strict';

/** Lista negra: bloqueia entrada na fila e mantém histórico do motivo. */

const agora = () => Date.now();

function adicionar(db, { guildId, userId, motivo, autorId }) {
  const texto = String(motivo || '').trim();
  if (texto.length < 3) throw new Error('Escreva o motivo (pelo menos 3 letras).');
  db.prepare(
    `INSERT INTO blacklist (guild_id, user_id, motivo, autor_id, criado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id) DO UPDATE
       SET motivo = excluded.motivo, autor_id = excluded.autor_id, criado_em = excluded.criado_em`,
  ).run(String(guildId), String(userId), texto.slice(0, 300), String(autorId), agora());
  return obter(db, guildId, userId);
}

function obter(db, guildId, userId) {
  return (
    db
      .prepare('SELECT * FROM blacklist WHERE guild_id = ? AND user_id = ?')
      .get(String(guildId), String(userId)) || null
  );
}

function estaBloqueado(db, guildId, userId) {
  return Boolean(obter(db, guildId, userId));
}

function remover(db, { guildId, userId }) {
  return db.prepare('DELETE FROM blacklist WHERE guild_id = ? AND user_id = ?').run(String(guildId), String(userId)).changes;
}

function listar(db, guildId, limite = 50) {
  return db
    .prepare('SELECT * FROM blacklist WHERE guild_id = ? ORDER BY criado_em DESC LIMIT ?')
    .all(String(guildId), Math.max(1, Math.trunc(limite)));
}

module.exports = { adicionar, obter, estaBloqueado, remover, listar };
