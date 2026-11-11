'use strict';

/**
 * Auditoria: grava no banco e (se configurado) manda no canal de logs.
 *
 * Registro estruturado: autor (ID + tag), canal, ação, motivo e horário.
 * Qualquer PIX/e-mail/telefone no texto passa pela máscara antes de ir para o
 * banco ou para o canal — chave completa nunca fica registrada.
 */

const config = require('../config');
const { obterConfig } = require('../db');
const { embed, mencao, dataBR } = require('../util/embeds');
const { mascararTexto } = require('../util/mascara');

const LIMITE_DETALHE = 1800;

function preparar({ detalhe, motivo }) {
  return {
    detalhe: detalhe ? mascararTexto(String(detalhe)).slice(0, LIMITE_DETALHE) : null,
    motivo: motivo ? mascararTexto(String(motivo)).slice(0, 400) : null,
  };
}

function gravarNoBanco(db, { guildId, autorId, autorTag, canalId, acao, detalhe, motivo }) {
  const limpo = preparar({ detalhe, motivo });
  db.prepare(
    `INSERT INTO auditoria (guild_id, autor_id, autor_tag, canal_id, acao, detalhe, motivo, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    guildId ? String(guildId) : null,
    autorId ? String(autorId) : null,
    autorTag ? String(autorTag).slice(0, 80) : null,
    canalId ? String(canalId) : null,
    String(acao).slice(0, 120),
    limpo.detalhe,
    limpo.motivo,
    Date.now(),
  );
}

function embedAuditoria({ acao, detalhe, motivo, autorId, autorTag, canalId, quando }) {
  const campos = [
    { name: 'Responsável', value: autorId ? `${mencao(autorId)}${autorTag ? ` · \`${autorTag}\`` : ''}` : '`sistema`', inline: true },
    { name: 'Canal', value: canalId ? `<#${canalId}>` : '`—`', inline: true },
    { name: 'Horário', value: dataBR(quando), inline: true },
  ];
  if (motivo) campos.push({ name: 'Motivo', value: motivo, inline: false });
  if (detalhe) campos.push({ name: 'Detalhe', value: detalhe, inline: false });
  return embed(`📋 ${acao}`, null, { cor: config.CORES.neutro, campos, rodape: 'ORG Royal AP · auditoria' });
}

async function registrar(
  db,
  client,
  { guildId, autorId = null, autorTag = null, canalId = null, acao, detalhe = null, motivo = null },
) {
  const quando = Date.now();
  try {
    gravarNoBanco(db, { guildId, autorId, autorTag, canalId, acao, detalhe, motivo });
  } catch (erro) {
    console.error('[auditoria] falha ao gravar:', erro.message);
  }

  if (!client || !guildId) return;
  try {
    const destino = obterConfig(db, guildId, 'canal_logs', config.CANAL_LOGS_ID);
    if (!destino) return;
    const canal = client.channels?.cache?.get?.(destino) || (await client.channels.fetch(destino));
    if (!canal || !canal.isTextBased?.()) return;
    const limpo = preparar({ detalhe, motivo });
    await canal.send({
      embeds: [
        embedAuditoria({
          acao,
          detalhe: limpo.detalhe,
          motivo: limpo.motivo,
          autorId,
          autorTag,
          canalId,
          quando,
        }),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (erro) {
    console.error('[auditoria] não consegui avisar no canal de logs:', erro.message);
  }
}

function recentes(db, guildId, limite = 15) {
  return db
    .prepare('SELECT * FROM auditoria WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(String(guildId), Math.max(1, Math.trunc(limite)));
}

module.exports = { registrar, recentes, mascararTexto };
