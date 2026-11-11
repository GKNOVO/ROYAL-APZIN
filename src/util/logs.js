'use strict';

/**
 * Log de erros com arquivo em disco + tratadores globais do processo.
 *
 * Objetivo na hospedagem (Discloud/Render/VPS): um erro de uma interação ou uma
 * promise rejeitada NUNCA derruba o bot. O erro é registrado com contexto e o
 * processo continua atendendo. O arquivo é rotacionado em 5 MB.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARQUIVO = path.resolve(
  String(process.env.LOG_ERROS_PATH || '').trim() || path.join(__dirname, '..', '..', 'database', 'erros.log'),
);
const LIMITE_BYTES = 5 * 1024 * 1024;

/** Mesmo erro repetido em menos de 60s não enche o log. */
const repetidos = new Map();
let instalado = false;

function garantirPasta() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  } catch {
    /* sem permissão: cai só no console */
  }
}

function rotacionar() {
  try {
    const info = fs.statSync(ARQUIVO);
    if (info.size < LIMITE_BYTES) return;
    fs.renameSync(ARQUIVO, `${ARQUIVO}.1`);
  } catch {
    /* arquivo ainda não existe */
  }
}

function serializar(erro) {
  if (erro instanceof Error) {
    return { mensagem: erro.message, nome: erro.name, pilha: String(erro.stack || '').split('\n').slice(0, 12).join('\n') };
  }
  try {
    return { mensagem: typeof erro === 'string' ? erro : JSON.stringify(erro) };
  } catch {
    return { mensagem: String(erro) };
  }
}

/**
 * Registra um erro. `contexto` é uma etiqueta curta ("interacao:/go", "nix:...").
 * Devolve true quando gravou e false quando foi suprimido por repetição.
 */
function registrarErro(contexto, erro, extra = {}) {
  const dados = serializar(erro);
  const etiqueta = String(contexto || 'processo');
  const chave = crypto.createHash('sha1').update(`${etiqueta}|${dados.mensagem}`).digest('hex');
  const agora = Date.now();
  const anterior = repetidos.get(chave);

  if (anterior && agora - anterior < 60 * 1000) {
    repetidos.set(chave, agora);
    return false;
  }
  repetidos.set(chave, agora);
  if (repetidos.size > 200) {
    for (const [k, quando] of repetidos) {
      if (agora - quando > 5 * 60 * 1000) repetidos.delete(k);
    }
  }

  const linha = JSON.stringify({ quando: new Date(agora).toISOString(), contexto: etiqueta, ...extra, ...dados });
  console.error(`[${etiqueta}] ${dados.mensagem}`);
  if (dados.pilha) console.error(dados.pilha);

  garantirPasta();
  rotacionar();
  try {
    fs.appendFileSync(ARQUIVO, `${linha}\n`, 'utf8');
  } catch (falha) {
    console.error('[logs] não consegui escrever o arquivo de erros:', falha.message);
  }
  return true;
}

/**
 * Instala unhandledRejection/uncaughtException.
 * `db` pode ser uma função que devolve a conexão atual (fecha no desligamento).
 */
function instalarTratadoresGlobais({ db } = {}) {
  if (instalado) return false;
  instalado = true;

  process.on('unhandledRejection', (motivo) => {
    registrarErro('processo:promise', motivo);
  });

  process.on('uncaughtException', (erro, origem) => {
    // Não encerra: a hospedagem só reinicia se o processo cair, e um erro de
    // uma interação não pode derrubar as outras partidas em andamento.
    registrarErro(`processo:excecao${origem ? `:${origem}` : ''}`, erro);
  });

  process.on('warning', (aviso) => {
    if (aviso?.name === 'DeprecationWarning') return;
    registrarErro('processo:aviso', aviso);
  });

  process.on('SIGTERM', () => {
    try {
      const conexao = typeof db === 'function' ? db() : db;
      conexao?.close?.();
    } catch {
      /* já fechado */
    }
  });

  return true;
}

module.exports = {
  ARQUIVO,
  registrarErro,
  instalarTratadoresGlobais,
};
