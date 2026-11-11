'use strict';

/**
 * Telagem: sala de call exclusiva por canal/partida.
 *
 * ── LINK ────────────────────────────────────────────────────────────────────
 * O código é DETERMINÍSTICO (derivado do servidor + canal/partida): a mesma
 * sala sempre recebe o mesmo código; canais diferentes nunca compartilham.
 *
 * ── POOL DE LINKS REAIS DO GOOGLE MEET ──────────────────────────────────────
 * Como o Google não tem API pública para criar salas, o bot mantém um POOL de
 * links reais do Meet (TELAGEM_LINKS no .env + links cadastrados pelo
 * `/telagem_links`). Cada partida/canal RESERVA um link ainda não usado e o
 * link fica gravado no banco: a sala nunca se cruza com outra partida e, se a
 * partida terminou, o link volta a ficar disponível.
 *
 * Sem nenhum link no pool, o bot cai no provedor configurado (jitsi por
 * padrão) para nunca deixar a staff sem sala.
 */

const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed } = require('../util/embeds');

const ALFABETO = 'abcdefghijkmnopqrstuvwxyz';
const ATIVAS = new Set(['confirmando', 'aguardando_mediador', 'aguardando_pagamento', 'pago', 'sala_liberada']);

const PROVEDORES = {
  jitsi: { nome: 'Jitsi Meet', base: 'https://meet.jit.si', prefixo: 'royal-ap-' },
  google: { nome: 'Google Meet', base: 'https://meet.google.com', prefixo: '' },
};

const MENSAGEM_POOL = 'Todos os links do Google Meet do pool estão em uso. Peça a um ADM para adicionar mais com `/telagem_links adicionar`.';

function bloco(tamanho) {
  let texto = '';
  for (let i = 0; i < tamanho; i += 1) {
    texto += ALFABETO[crypto.randomInt(0, ALFABETO.length)];
  }
  return texto;
}

/** Código aleatório no formato 3-4-3 (usado só quando não há canal). */
function novoCodigo() {
  return `${bloco(3)}-${bloco(4)}-${bloco(3)}`;
}

/**
 * Código exclusivo e estável por canal/partida (3-4-3).
 * O mesmo canal devolve sempre o mesmo código; canais diferentes, códigos
 * diferentes — ninguém cai na call de outra partida.
 */
function codigoDoCanal(...partes) {
  const chave = partes.map(String).filter(Boolean).join(':');
  if (!chave) return novoCodigo();

  const hash = crypto.createHash('sha256').update(chave).digest();
  let indice = 0;
  const letra = () => ALFABETO[hash[indice++] % ALFABETO.length];
  const grupo = (tamanho) => Array.from({ length: tamanho }, letra).join('');
  return `${grupo(3)}-${grupo(4)}-${grupo(3)}`;
}

function provedor() {
  const escolhido = String(config.TELAGEM_PROVEDOR || 'jitsi').toLowerCase();
  return PROVEDORES[escolhido] ? escolhido : 'jitsi';
}

const nomeProvedor = () => PROVEDORES[provedor()].nome;

/** Link real do Meet configurado no ambiente (ou null). */
function linkFixo() {
  const fixo = String(config.TELAGEM_LINK || '').trim();
  return /^https:\/\/meet\.google\.com\/\S+$/i.test(fixo) ? fixo : null;
}

/** Confere se o link colado é um Meet válido e devolve ele limpo. */
function linkValido(valor) {
  const limpo = String(valor || '').trim();
  return /^https:\/\/meet\.google\.com\/[A-Za-z0-9\-_/?=&.]+$/i.test(limpo) ? limpo : null;
}

const ehMeet = (url) => /^https:\/\/meet\.google\.com\//i.test(String(url || ''));

/**
 * Link final da sala.
 * Prioridade: link informado → TELAGEM_LINK → provedor configurado.
 */
function link(codigo, { url = null, qual = null } = {}) {
  const colado = linkValido(url);
  if (colado) return colado;

  const fixo = linkFixo();
  if (fixo) return fixo;

  const escolhido = qual && PROVEDORES[qual] ? qual : provedor();
  if (escolhido === 'google') {
    // Formato oficial do Meet (o domínio é sempre meet.google.com).
    return `https://meet.google.com/${codigo}`;
  }

  // Jitsi: aceita um servidor próprio no .env, mas nunca a base do Google.
  const baseEnv = String(config.TELAGEM_URL_BASE || '').replace(/\/+$/, '');
  const base = /meet\.google\.com/i.test(baseEnv) || !baseEnv ? PROVEDORES.jitsi.base : baseEnv;
  return `${base}/${PROVEDORES.jitsi.prefixo}${codigo}`;
}

/* ─────────────────────── Pool de links reais do Meet ─────────────────────── */

/** Links válidos do .env (TELAGEM_LINKS, separados por vírgula/quebra). */
function linksDoAmbiente() {
  return String(config.TELAGEM_LINKS || '')
    .split(/[,\n;]+/)
    .map((url) => linkValido(url))
    .filter(Boolean);
}

/** Links cadastrados no painel (/telagem_links) para este servidor. */
function linksDoBanco(db, guildId) {
  if (!db?.prepare) return [];
  try {
    return db
      .prepare('SELECT url FROM telagem_links WHERE guild_id = ? ORDER BY criado_em ASC, url ASC')
      .all(String(guildId))
      .map((linha) => linha.url);
  } catch (erro) {
    console.error('[telagem] não consegui ler o pool do banco:', erro.message);
    return [];
  }
}

/** Pool completo (env + banco), sem repetição e só com links válidos. */
function pool(db, guildId) {
  return [...new Set([...linksDoAmbiente(), ...linksDoBanco(db, guildId)])];
}

function adicionarLink(db, guildId, url) {
  const limpo = linkValido(url);
  if (!limpo) {
    throw new Error('Link inválido. Use um link real do Meet, ex: `https://meet.google.com/abc-defg-hij`.');
  }
  db.prepare('INSERT OR IGNORE INTO telagem_links (guild_id, url, criado_em) VALUES (?, ?, ?)').run(
    String(guildId),
    limpo,
    Date.now(),
  );
  return limpo;
}

function removerLink(db, guildId, url) {
  const limpo = linkValido(url) || String(url || '').trim();
  return db.prepare('DELETE FROM telagem_links WHERE guild_id = ? AND url = ?').run(String(guildId), limpo).changes;
}

/** Limpa o pool do banco e devolve as salas reservadas. */
function limparLinks(db, guildId) {
  const removidos = db.prepare('DELETE FROM telagem_links WHERE guild_id = ?').run(String(guildId)).changes;
  const atribuicoesRemovidas = db.prepare('DELETE FROM telagens WHERE guild_id = ?').run(String(guildId)).changes;
  return { removidos, atribuicoes: atribuicoesRemovidas };
}

/** Salas com link reservado (mostra no /telagem_links listar). */
function atribuicoes(db, guildId) {
  if (!db?.prepare) return [];
  return db
    .prepare('SELECT chave, codigo, url, criado_em FROM telagens WHERE guild_id = ? ORDER BY criado_em ASC')
    .all(String(guildId));
}

function atribuicaoDoCanal(db, guildId, chave) {
  const linha = db
    .prepare('SELECT * FROM telagens WHERE guild_id = ? AND chave = ?')
    .get(String(guildId), String(chave));
  return linha || null;
}

/** A chave é uma partida ainda em andamento? (link não pode ser reaproveitado) */
function partidaAtiva(db, guildId, chave) {
  const texto = String(chave || '');
  if (!texto.startsWith('partida:')) return false;
  const id = texto.slice('partida:'.length);
  const linha = db.prepare('SELECT status FROM partidas WHERE guild_id = ? AND id = ?').get(String(guildId), id);
  return Boolean(linha && ATIVAS.has(String(linha.status)));
}

function guardarAtribuicao(db, guildId, chave, url, codigo) {
  db.prepare(
    `INSERT INTO telagens (guild_id, chave, codigo, url, criado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, chave)
     DO UPDATE SET codigo = excluded.codigo, url = excluded.url, criado_em = excluded.criado_em`,
  ).run(String(guildId), String(chave), codigo, url, Date.now());
}

/**
 * Reserva o link de uma partida/canal.
 * • Já reservado → devolve o mesmo link (a sala é fixa).
 * • Pool com link livre → reserva e grava.
 * • Pool cheio → libera o link de uma partida já encerrada; se todas estão
 *   ativas, lança erro amigável.
 * • Pool vazio → devolve null (o comando cai no provedor padrão).
 */
function reservar(db, guildId, chave) {
  const existente = atribuicaoDoCanal(db, guildId, chave);
  if (existente) {
    return { chave: existente.chave, url: existente.url, codigo: existente.codigo, origem: 'reservado' };
  }

  const links = pool(db, guildId);
  if (!links.length) return null;

  const usadas = atribuicoes(db, guildId);
  const ocupados = new Set(usadas.map((linha) => linha.url));
  let escolhido = links.find((url) => !ocupados.has(url));

  if (!escolhido) {
    // Todas em uso: só reaproveita o link de uma partida que já terminou.
    const liberavel = usadas.find((linha) => !partidaAtiva(db, guildId, linha.chave));
    if (liberavel) {
      db.prepare('DELETE FROM telagens WHERE guild_id = ? AND chave = ?').run(String(guildId), liberavel.chave);
      escolhido = liberavel.url;
    }
  }

  if (!escolhido) throw new Error(MENSAGEM_POOL);

  const codigo = codigoDoCanal(guildId, chave);
  guardarAtribuicao(db, guildId, chave, escolhido, codigo);
  return { chave: String(chave), url: escolhido, codigo, origem: 'pool' };
}

/** Fixa um link informado no comando (também fica gravado para a partida). */
function fixar(db, guildId, chave, url) {
  const limpo = linkValido(url);
  if (!limpo) {
    throw new Error('Link inválido. Use um link real do Meet, ex: `https://meet.google.com/abc-defg-hij`.');
  }
  const codigo = codigoDoCanal(guildId, chave);
  guardarAtribuicao(db, guildId, chave, limpo, codigo);
  return { chave: String(chave), url: limpo, codigo, origem: 'manual' };
}

/* ─────────────────────────────── Painel ──────────────────────────────────── */

/** Painel "Sala de Telagem Criada" com código, URL e botão de entrada. */
function painel(codigo = novoCodigo(), { usuarios = 0, url = null, origem = null } = {}) {
  const destino = link(codigo, { url });
  const usandoFixo = Boolean(linkFixo()) && !linkValido(url);

  let etiqueta;
  if (ehMeet(destino)) {
    if (linkValido(url) && origem === 'manual') etiqueta = 'Google Meet (link do comando)';
    else if (usandoFixo) etiqueta = 'Google Meet (link fixo do .env)';
    else etiqueta = 'Google Meet (pool oficial)';
  } else {
    etiqueta = nomeProvedor();
  }

  return {
    embeds: [
      embed(
        '✅ Sala de Telagem Criada',
        [
          'A sala para análise dos jogadores foi iniciada com sucesso.',
          '',
          `ℹ️ **Código da Sala:** \`${codigo}\``,
          `👤 **Usuários na Call:** \`${usuarios}\``,
          `📡 **Plataforma:** ${etiqueta}`,
          `🔗 **Link da sala:** ${destino}`,
          '',
          '➜ Clique no botão abaixo para entrar na call:',
        ].join('\n'),
        { cor: config.CORES.sucesso, rodape: 'ORG Royal AP · telagem' },
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setURL(destino).setLabel('Entrar na Call').setEmoji('🎙️').setStyle(ButtonStyle.Link),
      ),
    ],
  };
}

module.exports = {
  PROVEDORES,
  MENSAGEM_POOL,
  novoCodigo,
  codigoDoCanal,
  provedor,
  nomeProvedor,
  link,
  linkFixo,
  linkValido,
  ehMeet,
  linksDoAmbiente,
  pool,
  adicionarLink,
  removerLink,
  limparLinks,
  atribuicoes,
  atribuicaoDoCanal,
  reservar,
  fixar,
  painel,
};
