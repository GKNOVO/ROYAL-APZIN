'use strict';

/** Relatório operacional de receita de partidas ainda mantidas em SQLite. */
function receita(db, guildId, desdeMs = 0) {
  return db
    .prepare(
      `SELECT mediador_id,
              COUNT(*) AS partidas,
              SUM(preco * (SELECT COUNT(*) FROM partida_jogadores pj WHERE pj.partida_id = partidas.id)) AS movimentado,
              SUM(comissao * preco * (SELECT COUNT(*) FROM partida_jogadores pj WHERE pj.partida_id = partidas.id)) AS comissao
         FROM partidas
        WHERE guild_id = ? AND status = 'finalizada' AND mediador_id IS NOT NULL AND finalizada_em >= ?
        GROUP BY mediador_id
        ORDER BY comissao DESC`,
    )
    .all(String(guildId), Math.trunc(desdeMs));
}

module.exports = { receita };
