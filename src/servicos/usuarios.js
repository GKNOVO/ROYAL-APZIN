'use strict';

/** Histórico operacional de apostas; saldos e estatísticas de perfil vivem no Supabase. */
function historicoApostas(db, guildId, userId, limite = 10) {
  return db
    .prepare(
      `SELECT p.id, p.modo, p.preco, p.gelo, p.status, p.vencedor_time, p.finalizada_em,
              p.motivo_fim, pj.time AS meu_time
         FROM partidas p
         JOIN partida_jogadores pj ON pj.partida_id = p.id
        WHERE p.guild_id = ? AND pj.user_id = ? AND p.status IN ('finalizada', 'cancelada')
        ORDER BY COALESCE(p.finalizada_em, p.criado_em) DESC
        LIMIT ?`,
    )
    .all(String(guildId), String(userId), Math.max(1, Math.trunc(limite)));
}

module.exports = { historicoApostas };
