'use strict';

/** Perfis, moedas da loja, giros, vitórias e histórico. */

const agora = () => Date.now();

function garantir(db, guildId, userId) {
  db.prepare(
    `INSERT OR IGNORE INTO usuarios (guild_id, user_id, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?)`,
  ).run(String(guildId), String(userId), agora(), agora());
}

function obter(db, guildId, userId) {
  garantir(db, guildId, userId);
  return db
    .prepare('SELECT * FROM usuarios WHERE guild_id = ? AND user_id = ?')
    .get(String(guildId), String(userId));
}

function registrarTransacao(db, { guildId, userId, tipo, valor, motivo = null, autorId = null }) {
  db.prepare(
    `INSERT INTO transacoes (guild_id, user_id, tipo, valor, motivo, autor_id, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(String(guildId), String(userId), tipo, Math.trunc(valor), motivo, autorId, agora());
}

/**
 * Soma (ou tira) moedas com extrato. Valor negativo nunca deixa saldo abaixo de zero.
 * Devolve o saldo novo.
 */
function adicionarCoins(db, { guildId, userId, valor, motivo = null, autorId = null, tipo = 'ajuste' }) {
  const quantidade = Math.trunc(Number(valor));
  if (!Number.isFinite(quantidade) || quantidade === 0) {
    throw new Error('O valor precisa ser um número diferente de zero.');
  }

  const executar = db.transaction(() => {
    const perfil = obter(db, guildId, userId);
    const novo = perfil.coins + quantidade;
    if (novo < 0) {
      throw new Error(`Saldo insuficiente: o jogador tem ${perfil.coins} moedas.`);
    }
    db.prepare(
      'UPDATE usuarios SET coins = ?, atualizado_em = ? WHERE guild_id = ? AND user_id = ?',
    ).run(novo, agora(), String(guildId), String(userId));
    registrarTransacao(db, { guildId, userId, tipo, valor: quantidade, motivo, autorId });
    return novo;
  });

  return executar();
}

/** Passa moedas de um jogador para outro (loja). */
function transferirCoins(db, { guildId, deId, paraId, valor, motivo = 'transferência', autorId = null }) {
  const quantidade = Math.trunc(Number(valor));
  if (!Number.isFinite(quantidade) || quantidade <= 0) throw new Error('Informe um valor maior que zero.');
  if (String(deId) === String(paraId)) throw new Error('Você não pode enviar para você mesmo.');

  const executar = db.transaction(() => {
    adicionarCoins(db, { guildId, userId: deId, valor: -quantidade, motivo, autorId, tipo: 'loja_envio' });
    adicionarCoins(db, { guildId, userId: paraId, valor: quantidade, motivo, autorId, tipo: 'loja_recebido' });
  });
  executar();
}

function adicionarGiros(db, { guildId, userId, quantidade, autorId = null }) {
  const valor = Math.trunc(Number(quantidade));
  if (!Number.isFinite(valor) || valor === 0) throw new Error('Informe uma quantidade de giros diferente de zero.');
  const executar = db.transaction(() => {
    const perfil = obter(db, guildId, userId);
    const novo = perfil.giros + valor;
    if (novo < 0) throw new Error(`O jogador tem apenas ${perfil.giros} giros.`);
    db.prepare('UPDATE usuarios SET giros = ?, atualizado_em = ? WHERE guild_id = ? AND user_id = ?')
      .run(novo, agora(), String(guildId), String(userId));
    registrarTransacao(db, { guildId, userId, tipo: 'giros', valor, motivo: 'giros', autorId });
    return novo;
  });
  return executar();
}

/** Vitória de AP: soma vitória, valor apostado e prêmio. */
function registrarVitoria(db, { guildId, userId, apostado = 0, ganho = 0 }) {
  obter(db, guildId, userId);
  db.prepare(
    `UPDATE usuarios
        SET vitorias = vitorias + 1, apostado = apostado + ?, ganho = ganho + ?, atualizado_em = ?
      WHERE guild_id = ? AND user_id = ?`,
  ).run(Math.trunc(apostado), Math.trunc(ganho), agora(), String(guildId), String(userId));
}

function registrarDerrota(db, { guildId, userId, apostado = 0, wo = false }) {
  obter(db, guildId, userId);
  db.prepare(
    `UPDATE usuarios
        SET derrotas = derrotas + 1, apostado = apostado + ?, wos = wos + ?, atualizado_em = ?
      WHERE guild_id = ? AND user_id = ?`,
  ).run(Math.trunc(apostado), wo ? 1 : 0, agora(), String(guildId), String(userId));
}

function resumo(db, guildId, userId) {
  const perfil = obter(db, guildId, userId);
  const total = perfil.vitorias + perfil.derrotas;
  return {
    ...perfil,
    total,
    aproveitamento: total > 0 ? Math.round((perfil.vitorias / total) * 100) : 0,
  };
}

const ORDEM_RANKING = {
  coins: 'coins DESC, vitorias DESC',
  vitorias: 'vitorias DESC, derrotas ASC',
  giros: 'giros DESC',
};

function top(db, guildId, tipo = 'vitorias', limite = 10) {
  const ordem = ORDEM_RANKING[tipo] || ORDEM_RANKING.vitorias;
  return db
    .prepare(
      `SELECT * FROM usuarios
        WHERE guild_id = ? AND (vitorias > 0 OR derrotas > 0 OR coins > 0)
        ORDER BY ${ordem} LIMIT ?`,
    )
    .all(String(guildId), Math.max(1, Math.trunc(limite)));
}

function posicaoNoRanking(db, guildId, userId, tipo = 'vitorias') {
  const lista = top(db, guildId, tipo, 500);
  const indice = lista.findIndex((linha) => linha.user_id === String(userId));
  return indice === -1 ? null : indice + 1;
}

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

module.exports = {
  garantir,
  obter,
  registrarTransacao,
  adicionarCoins,
  transferirCoins,
  adicionarGiros,
  registrarVitoria,
  registrarDerrota,
  resumo,
  top,
  posicaoNoRanking,
  historicoApostas,
};
