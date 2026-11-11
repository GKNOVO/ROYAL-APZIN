'use strict';

/**
 * Telagem: sala de call exclusiva por canal/partida.
 *
 * O código é DETERMINÍSTICO (derivado do servidor + canal): a mesma sala/partida
 * sempre recebe o mesmo link, e canais diferentes recebem links diferentes.
 *
 * Provedores (TELAGEM_PROVEDOR):
 *   • jitsi  → `https://meet.jit.si/royal-ap-<código>` (padrão): a sala é criada
 *              na hora em que alguém abre o link, então NUNCA dá "sala
 *              inexistente" e abre no navegador do Android/iOS.
 *   • google → `https://meet.google.com/<código>` (formato oficial): o Google
 *              não permite criar sala por API, então use TELAGEM_LINK com um
 *              link real para garantir que a reunião exista.
 *
 * TELAGEM_LINK (link real do Meet) tem prioridade sobre tudo.
 */

const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed } = require('../util/embeds');

const ALFABETO = 'abcdefghijkmnopqrstuvwxyz';

const PROVEDORES = {
  jitsi: { nome: 'Jitsi Meet', base: 'https://meet.jit.si', prefixo: 'royal-ap-' },
  google: { nome: 'Google Meet', base: 'https://meet.google.com', prefixo: '' },
};

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

/**
 * Link final da sala.
 * Prioridade: link colado no comando → TELAGEM_LINK → provedor configurado.
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

/** Painel "Sala de Telagem Criada" com código, URL e botão de entrada. */
function painel(codigo = novoCodigo(), { usuarios = 0, url = null, qual = null } = {}) {
  const destino = link(codigo, { url, qual });
  const usandoFixo = Boolean(linkFixo()) && !linkValido(url);
  const etiqueta = linkValido(url)
    ? 'Google Meet (link do comando)'
    : usandoFixo
      ? 'Google Meet (link fixo do .env)'
      : nomeProvedor();

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
  novoCodigo,
  codigoDoCanal,
  provedor,
  nomeProvedor,
  link,
  linkFixo,
  linkValido,
  painel,
};
