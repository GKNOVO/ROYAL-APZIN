'use strict';

/**
 * Telagem: sala de call para a triagem/análise dos jogadores de uma partida.
 * Gera um código curto (ex: nrk-yqzn-amm) e o link da sala na hora, sem
 * depender de API externa nem de token.
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

/** Código no formato da referência: 3-4-3 letras minúsculas. */
function novoCodigo() {
  return `${bloco(3)}-${bloco(4)}-${bloco(3)}`;
}

function link(codigo) {
  const base = String(config.TELAGEM_URL_BASE || 'https://meet.jit.si').replace(/\/+$/, '');
  return `${base}/royal-ap-${codigo}`;
}

/** Painel "Sala de Telagem Criada" com o botão de link para a call. */
function painel(codigo = novoCodigo(), { usuarios = 0 } = {}) {
  const url = link(codigo);

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
          '➜ Clique no botão abaixo para entrar na call:',
        ].join('\n'),
        { cor: config.CORES.sucesso, rodape: 'ORG Royal AP · telagem' },
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setURL(url).setLabel('Entrar na Call').setEmoji('🎙️').setStyle(ButtonStyle.Link),
      ),
    ],
  };
}

module.exports = { novoCodigo, link, painel };
