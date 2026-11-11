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
function migrar(db) {
  let colunas = [];
  try {
    colunas = db.prepare('PRAGMA table_info(staff)').all().map((coluna) => coluna.name);
  } catch {
    return; // banco novo: o ESQUEMA já criou tudo
  }
  if (!colunas.includes('pix_cidade')) {
    try {
      db.exec('ALTER TABLE staff ADD COLUMN pix_cidade TEXT');
    } catch (erro) {
      console.warn('[db] não consegui adicionar staff.pix_cidade:', erro.message);
    }
  }
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
