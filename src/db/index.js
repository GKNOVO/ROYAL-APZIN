'use strict';

/** Conexão e criação do banco SQLite. */

const { ESQUEMA } = require('./esquema');
const { abrirMotor } = require('./driver');

function abrirBanco(caminho) {
  const { db, motor } = abrirMotor(caminho);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const criar = db.transaction(() => {
    for (const sql of ESQUEMA) db.exec(sql);
  });
  criar();
  migrar(db);

  try {
    db.motor = motor;
  } catch {
    /* se não der para anotar, seguimos sem */
  }
  return db;
}

/**
 * Migrações leves: acrescenta colunas novas em bancos que já existiam
 * (CREATE TABLE IF NOT EXISTS não altera tabela antiga).
 */
function adicionarColuna(db, tabela, coluna, tipo) {
  try {
    const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map((linha) => linha.name);
    if (colunas.includes(coluna)) return;
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
  } catch (erro) {
    // Banco novo já nasce com a coluna; se a tabela não existir, o ESQUEMA cria.
    if (!/duplicate column/i.test(erro.message)) {
      console.warn(`[db] não consegui adicionar ${tabela}.${coluna}:`, erro.message);
    }
  }
}

function migrar(db) {
  adicionarColuna(db, 'staff', 'pix_cidade', 'TEXT');
  // Guarda o session_id da Nix para o /go iniciar a sala de verdade.
  adicionarColuna(db, 'partidas', 'nix_sessao', 'TEXT');
  // PIX é fonte de verdade no Supabase. Apaga snapshots locais antigos e
  // higieniza o detalhe gravado por versões anteriores do comando /pix.
  db.prepare('UPDATE partidas SET pix_chave = NULL, pix_titular = NULL WHERE pix_chave IS NOT NULL OR pix_titular IS NOT NULL').run();
  const chavesLegadas = db.prepare('SELECT pix_chave FROM staff WHERE pix_chave IS NOT NULL').all();
  const removerChaveDeAuditoria = db.prepare(
    "UPDATE auditoria SET detalhe = replace(detalhe, ?, '[chave PIX omitida]') WHERE instr(detalhe, ?) > 0",
  );
  for (const { pix_chave: chave } of chavesLegadas) removerChaveDeAuditoria.run(String(chave), String(chave));
  db.prepare(
    `UPDATE auditoria
        SET detalhe = substr(detalhe, 1, instr(detalhe, ' · ') + 2) || '[chave PIX omitida]'
      WHERE acao = 'PIX enviado na sala' AND instr(detalhe, ' · ') > 0`,
  ).run();
}

/** Lê/escreve configuração simples por servidor. */
function obterConfig(db, guildId, chave, padrao = null) {
  const linha = db
    .prepare('SELECT valor FROM configuracoes WHERE guild_id = ? AND chave = ?')
    .get(String(guildId), String(chave));
  return linha ? linha.valor : padrao;
}

function definirConfig(db, guildId, chave, valor) {
  db.prepare(
    `INSERT INTO configuracoes (guild_id, chave, valor) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, chave) DO UPDATE SET valor = excluded.valor`,
  ).run(String(guildId), String(chave), valor === null || valor === undefined ? null : String(valor));
}

module.exports = { abrirBanco, obterConfig, definirConfig };
