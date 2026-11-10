'use strict';

/** Auditoria: grava no banco e (se configurado) manda no canal de logs. */

const config = require('../config');
const { obterConfig } = require('../db');
const { embedLog } = require('../util/embeds');

function gravarNoBanco(db, { guildId, autorId, acao, detalhe }) {
  db.prepare(
    'INSERT INTO auditoria (guild_id, autor_id, acao, detalhe, criado_em) VALUES (?, ?, ?, ?, ?)',
  ).run(guildId ? String(guildId) : null, autorId ? String(autorId) : null, String(acao), detalhe ? String(detalhe).slice(0, 1800) : null, Date.now());
}

async function registrar(db, client, { guildId, autorId = null, acao, detalhe = null }) {
  try {
    gravarNoBanco(db, { guildId, autorId, acao, detalhe });
  } catch (erro) {
    console.error('[auditoria] falha ao gravar:', erro.message);
  }

  if (!client || !guildId) return;
  try {
    const canalId = obterConfig(db, guildId, 'canal_logs', config.CANAL_LOGS_ID);
    if (!canalId) return;
    const canal = client.channels.cache.get(canalId) || (await client.channels.fetch(canalId));
    if (!canal || !canal.isTextBased?.()) return;
    await canal.send({ embeds: [embedLog(acao, detalhe || '—', autorId)] });
  } catch (erro) {
    console.error('[auditoria] não consegui avisar no canal de logs:', erro.message);
  }
}

function recentes(db, guildId, limite = 15) {
  return db
    .prepare('SELECT * FROM auditoria WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(String(guildId), Math.max(1, Math.trunc(limite)));
}

module.exports = { registrar, recentes };
