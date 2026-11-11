'use strict';

/**
 * Telagem: sala de call (Google Meet) para a triagem dos jogadores.
 *
 * O Google NÃO libera criação de sala por API, então o bot trabalha assim:
 *   • TELAGEM_LINK definido → usa sempre aquele link real do Meet;
 *   • sem ele → monta `https://meet.google.com/<código>` no formato oficial
 *     (abc-defg-hij), que é o mesmo formato aceito no Android e iOS.
 * O `/criar_telagem` também aceita o argumento `link:` para colar um Meet real.
 */

const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed } = require('../util/embeds');

const ALFABETO = 'abcdefghijkmnopqrstuvwxyz';

function bloco(tamanho) {
  let texto = '';
  for (let i = 0; i < tamanho; i += 1) {
    texto += ALFABETO[crypto.randomInt(0, ALFABETO.length)];
  }
  return texto;
}

/** Código no formato do Meet: 3-4-3 letras minúsculas (abc-defg-hij). */
function novoCodigo() {
  return `${bloco(3)}-${bloco(4)}-${bloco(3)}`;
}

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

function link(codigo) {
  const fixo = linkFixo();
  if (fixo) return fixo;
  const base = String(config.TELAGEM_URL_BASE || 'https://meet.google.com').replace(/\/+$/, '');
  return `${base}/${codigo}`;
}

/** Painel "Sala de Telagem Criada" com o botão de link para a call. */
function painel(codigo = novoCodigo(), { usuarios = 0, url = null } = {}) {
  const destino = linkValido(url) || linkFixo() || link(codigo);

  return {
    embeds: [
      embed(
        '✅ Sala de Telagem Criada',
        [
          'A sala para análise dos jogadores foi iniciada com sucesso.',
          '',
          `ℹ️ **Código da Sala:** \`${codigo}\``,
          `👤 **Usuários na Call:** \`${usuarios}\``,
          '',
          `🔗 **Google Meet:** ${destino}`,
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

module.exports = { novoCodigo, link, linkFixo, linkValido, painel };
