'use strict';

/** Convites: descobre quem convidou quem comparando os usos dos convites. */

const agora = () => Date.now();
const cache = new Map();

async function atualizarCache(guild) {
  const convites = await guild.invites.fetch();
  const mapa = new Map();
  for (const convite of convites.values()) {
    mapa.set(convite.code, convite.uses ?? 0);
  }
  cache.set(guild.id, mapa);
  return mapa;
}

function registrar(db, { guildId, convidadorId, convidadoId, codigo = null }) {
  db.prepare(
    `INSERT OR IGNORE INTO convites (guild_id, convidador_id, convidado_id, codigo, criado_em)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(String(guildId), String(convidadoId), String(convidadorId), codigo, agora());
}

/** Chamado quando alguém entra: devolve o código usado (ou null). */
async function detectar(db, member) {
  const guild = member.guild;
  try {
    const antes = cache.get(guild.id);
    if (!antes) {
      await atualizarCache(guild);
      return null;
    }
    const depois = await atualizarCache(guild);
    for (const [codigo, usos] of depois.entries()) {
      if ((antes.get(codigo) ?? 0) < usos) {
        return codigo;
      }
    }
    return null;
  } catch (erro) {
    console.error('[convites] não consegui ler os convites:', erro.message);
    return null;
  }
}

function contar(db, guildId, userId) {
  const linha = db
    .prepare('SELECT COUNT(*) AS total FROM convites WHERE guild_id = ? AND convidador_id = ?')
    .get(String(guildId), String(userId));
  return linha ? linha.total : 0;
}

function top(db, guildId, limite = 10) {
  return db
    .prepare(
      `SELECT convidador_id, COUNT(*) AS total FROM convites
        WHERE guild_id = ? GROUP BY convidador_id ORDER BY total DESC LIMIT ?`,
    )
    .all(String(guildId), Math.max(1, Math.trunc(limite)));
}

function doConvidado(db, guildId, userId) {
  return (
    db
      .prepare('SELECT * FROM convites WHERE guild_id = ? AND convidado_id = ?')
      .get(String(guildId), String(userId)) || null
  );
}

module.exports = { atualizarCache, detectar, registrar, contar, top, doConvidado };
