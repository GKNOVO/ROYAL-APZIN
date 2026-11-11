'use strict';

/** Conexão, esquema, migrações e leitura/escrita de configuração com cache. */

const { ESQUEMA } = require('./esquema');
const { abrirMotor } = require('./driver');
const cache = require('./cache');

/** Configuração muda pouco: 5s de cache já elimina a maior parte das leituras. */
const TTL_CONFIG = 5000;

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

function colunasDe(db, tabela) {
  try {
    return db
      .prepare(`PRAGMA table_info(${tabela})`)
      .all()
      .map((coluna) => coluna.name);
  } catch {
    return null;
  }
}

/** Acrescenta uma coluna nova sem quebrar banco que já existia. */
function adicionarColuna(db, tabela, coluna, tipo) {
  const colunas = colunasDe(db, tabela);
  if (!colunas) return false;
  if (colunas.includes(coluna)) return false;
  try {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
    return true;
  } catch (erro) {
    console.warn(`[db] não consegui adicionar ${tabela}.${coluna}:`, erro.message);
    return false;
  }
}

/**
 * Migrações leves: CREATE TABLE IF NOT EXISTS não altera tabela antiga, então
 * colunas novas entram por ALTER TABLE. Nomes são constantes do código.
 */
function migrar(db) {
  adicionarColuna(db, 'staff', 'pix_cidade', 'TEXT');

  // Máquina de estados + idempotência da criação de sala.
  adicionarColuna(db, 'partidas', 'iniciada_em', 'INTEGER');
  adicionarColuna(db, 'partidas', 'sala_lock_em', 'INTEGER');
  adicionarColuna(db, 'partidas', 'nix_sessao', 'TEXT');

  // Auditoria estruturada.
  adicionarColuna(db, 'auditoria', 'autor_tag', 'TEXT');
  adicionarColuna(db, 'auditoria', 'canal_id', 'TEXT');
  adicionarColuna(db, 'auditoria', 'motivo', 'TEXT');
}

/**
 * Lê configuração simples por servidor.
 * Só valor que existe no banco entra no cache: o padrão vem do .env e pode
 * mudar em tempo real (testes e hospedagem), então nunca é memorizado.
 */
function obterConfig(db, guildId, chave, padrao = null) {
  const chaveCache = `config:${guildId}:${chave}`;
  const guardado = cache.ler(chaveCache, TTL_CONFIG);
  if (guardado !== undefined) return guardado;

  const linha = db
    .prepare('SELECT valor FROM configuracoes WHERE guild_id = ? AND chave = ?')
    .get(String(guildId), String(chave));

  if (!linha) return padrao;
  cache.gravar(chaveCache, linha.valor, TTL_CONFIG);
  return linha.valor;
}

function definirConfig(db, guildId, chave, valor) {
  db.prepare(
    `INSERT INTO configuracoes (guild_id, chave, valor) VALUES (?, ?, ?)
     ON CONFLICT (guild_id, chave) DO UPDATE SET valor = excluded.valor`,
  ).run(String(guildId), String(chave), valor === null || valor === undefined ? null : String(valor));

  cache.invalidar(`config:${guildId}:${chave}`);
  // Cargos de mediador têm cache próprio (usado em todo clique de painel).
  if (String(chave) === 'cargos_mediadores') cache.invalidar(`cargos:${guildId}`);
}

module.exports = { abrirBanco, obterConfig, definirConfig, adicionarColuna, cache };
