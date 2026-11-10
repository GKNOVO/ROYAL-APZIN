'use strict';

/** Staff/mediadores: chave PIX, comissão e relatório de receita. */

const config = require('../config');

const agora = () => Date.now();

function garantir(db, guildId, userId, comissao = config.COMISSAO_PADRAO) {
  db.prepare(
    `INSERT OR IGNORE INTO staff (guild_id, user_id, comissao, ativo, atualizado_em)
     VALUES (?, ?, ?, 1, ?)`,
  ).run(String(guildId), String(userId), Number(comissao), agora());
}

function obter(db, guildId, userId) {
  return (
    db
      .prepare('SELECT * FROM staff WHERE guild_id = ? AND user_id = ?')
      .get(String(guildId), String(userId)) || null
  );
}

function registrarPix(db, { guildId, userId, chave, titular = null, comissao = null }) {
  const limpa = String(chave || '').trim();
  if (limpa.length < 3) throw new Error('A chave PIX parece curta demais.');
  if (limpa.length > 200) throw new Error('A chave PIX é longa demais.');

  garantir(db, guildId, userId, comissao ?? config.COMISSAO_PADRAO);
  const atual = obter(db, guildId, userId);
  const valorComissao = comissao === null || comissao === undefined ? atual.comissao : Number(comissao);
  if (!Number.isFinite(valorComissao) || valorComissao < 0 || valorComissao > 0.5) {
    throw new Error('A comissão precisa estar entre 0 e 0,50 (0% a 50%).');
  }

  db.prepare(
    `UPDATE staff
        SET pix_chave = ?, pix_titular = ?, comissao = ?, ativo = 1, registrado_em = ?, atualizado_em = ?
      WHERE guild_id = ? AND user_id = ?`,
  ).run(limpa, titular ? String(titular).trim().slice(0, 120) : atual.pix_titular, valorComissao, agora(), agora(), String(guildId), String(userId));

  return obter(db, guildId, userId);
}

function definirComissao(db, { guildId, userId, comissao }) {
  const valor = Number(comissao);
  if (!Number.isFinite(valor) || valor < 0 || valor > 0.5) {
    throw new Error('A comissão precisa estar entre 0 e 0,50 (0% a 50%).');
  }
  garantir(db, guildId, userId);
  db.prepare('UPDATE staff SET comissao = ?, atualizado_em = ? WHERE guild_id = ? AND user_id = ?')
    .run(valor, agora(), String(guildId), String(userId));
  return obter(db, guildId, userId);
}

function definirAtivo(db, { guildId, userId, ativo }) {
  garantir(db, guildId, userId);
  db.prepare('UPDATE staff SET ativo = ?, atualizado_em = ? WHERE guild_id = ? AND user_id = ?')
    .run(ativo ? 1 : 0, agora(), String(guildId), String(userId));
}

function listar(db, guildId) {
  return db
    .prepare('SELECT * FROM staff WHERE guild_id = ? ORDER BY ativo DESC, registrado_em ASC')
    .all(String(guildId));
}

/** Só mediadores com PIX cadastrado podem assumir sala. */
function podeAssumir(db, guildId, userId) {
  const registro = obter(db, guildId, userId);
  return Boolean(registro && registro.ativo && registro.pix_chave);
}

/**
 * Receita por mediador: soma das partidas finalizadas em que ele foi o mediador.
 * comissão = valor da aposta (preço) × 2 jogadores... na prática preço × jogadores.
 */
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

module.exports = {
  garantir,
  obter,
  registrarPix,
  definirComissao,
  definirAtivo,
  listar,
  podeAssumir,
  receita,
};
