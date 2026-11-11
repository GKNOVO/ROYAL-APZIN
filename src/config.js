'use strict';

/**
 * Configuração central do bot.
 * Tudo que muda de servidor para servidor vive aqui (lido do .env).
 */

const path = require('path');

// O .env é lido sempre da pasta do projeto (funciona mesmo se a hospedagem
// iniciar o processo de outro diretório).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/** Texto que fica no .env de exemplo — usado para avisar o dono do bot. */
const PLACEHOLDER = 'COLE_SEU_TOKEN_AQUI';

/**
 * Faixas de aposta em centavos: 15 valores, de R$ 0,50 a R$ 100,00.
 *
 * Cada valor vira UMA mensagem no canal da fila. As mensagens são enviadas do
 * maior para o menor, então a faixa de R$ 0,50 fica na última mensagem
 * (embaixo) e os valores sobem conforme você rola para cima.
 */
const PRECOS = [50, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000, 5000, 7000, 10000];

const PLATAFORMAS = {
  mobile: 'mobile',
  fullcapa: 'full capa',
  emu: 'emu',
  misto: 'misto',
};

/** 15 modos de AP, na ordem dos canais. */
const MODOS_BRUTOS = [
  ['x1mobile', '1x1', 'mobile', 1],
  ['x2mobile', '2x2', 'mobile', 2],
  ['x3mobile', '3x3', 'mobile', 3],
  ['x4mobile', '4x4', 'mobile', 4],
  ['x1fullcapa', '1x1', 'fullcapa', 1],
  ['x2fullcapa', '2x2', 'fullcapa', 2],
  ['x3fullcapa', '3x3', 'fullcapa', 3],
  ['x4fullcapa', '4x4', 'fullcapa', 4],
  ['x1emu', '1x1', 'emu', 1],
  ['x2emu', '2x2', 'emu', 2],
  ['x3emu', '3x3', 'emu', 3],
  ['x4emu', '4x4', 'emu', 4],
  ['x2misto', '2x2', 'misto', 2],
  ['x3misto', '3x3', 'misto', 3],
  ['x4misto', '4x4', 'misto', 4],
];

const MODOS = MODOS_BRUTOS.map(([id, nome, plataforma, time]) => ({
  id,
  nome,
  plataforma,
  plataformaNome: PLATAFORMAS[plataforma],
  time,
  jogadores: time * 2,
  comando: `filas${id}`,
  titulo: `${nome} | ${PLATAFORMAS[plataforma]}`,
}));

const POR_ID = new Map(MODOS.map((modo) => [modo.id, modo]));

/**
 * Botões de entrada de cada categoria. O "id" é o que fica gravado na fila
 * (coluna gelo), então não mude depois de já ter fila rodando.
 */
const VARIANTES = {
  mobile: [
    { id: 'infinito', nome: 'Gelo Infinito', emoji: '🧊' },
    { id: 'normal', nome: 'Gelo Normal', emoji: '🧊' },
  ],
  emu: [
    { id: 'normal', nome: 'Normal', emoji: '✔️' },
    { id: 'ump_xm8', nome: 'Full UMP e XM8', emoji: '🔫' },
  ],
  fullcapa: [{ id: 'full_capa', nome: 'Full Capa', emoji: '🎯' }],
  misto: [
    { id: 'emu1', nome: '1 Emu', emoji: '🎮' },
    { id: 'emu2', nome: '2 Emu', emoji: '🎮' },
    { id: 'emu3', nome: '3 Emu', emoji: '🎮' },
  ],
};

/** Misto varia com o tamanho do time: 2x2 tem 1 Emu, 3x3 tem 1 e 2, 4x4 tem 1, 2 e 3. */
function variantesDoModo(modo) {
  if (!modo) return [];
  if (modo.plataforma === 'misto') return VARIANTES.misto.slice(0, Math.max(1, modo.time - 1));
  return VARIANTES[modo.plataforma] || [];
}

function varianteDoModo(modo, id) {
  return variantesDoModo(modo).find((variante) => variante.id === String(id)) || null;
}

/** No misto não existe botão "Como funciona" (regra do layout). */
const mostrarComoFunciona = (modo) => Boolean(modo) && modo.plataforma !== 'misto';

function texto(valor, padrao = '') {
  const limpo = String(valor ?? '').trim();
  return limpo === '' ? padrao : limpo;
}

/**
 * Token colado do celular costuma vir com aspas ou quebras de linha.
 * Aqui ele é limpo para o Discord aceitar sem erro de "invalid token".
 */
function tokenLimpo(valor) {
  return texto(valor)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/^Bot\s+/i, '')
    .replace(/\s+/g, '');
}

function booleano(valor, padrao = true) {
  const limpo = texto(valor).toLowerCase();
  if (limpo === '') return padrao;
  return !['0', 'false', 'nao', 'não', 'off', 'no'].includes(limpo);
}

function numero(valor, padrao, minimo = -Infinity, maximo = Infinity) {
  const convertido = Number(valor);
  if (!Number.isFinite(convertido)) return padrao;
  return Math.min(maximo, Math.max(minimo, convertido));
}

const config = {
  PLACEHOLDER,
  PRECOS,
  MODOS,
  VARIANTES,
  PLATAFORMAS,
  variantesDoModo,
  varianteDoModo,
  mostrarComoFunciona,

  TOKEN: tokenLimpo(process.env.DISCORD_TOKEN),
  /** De onde o token veio — só para o log de inicialização. */
  TOKEN_ORIGEM: process.env.DISCORD_TOKEN ? 'process.env.DISCORD_TOKEN' : 'vazio',
  CLIENT_ID: texto(process.env.CLIENT_ID),
  GUILD_ID: texto(process.env.GUILD_ID),
  CAMINHO_BANCO: path.resolve(texto(process.env.DATABASE_PATH, 'database/royal.db')),

  /**
   * CATEGORIA onde nascem as salas privadas de partida (quando a fila fecha,
   * o canal é criado DENTRO dela). Dá para definir com `/boombot setcategoria`.
   */
  CATEGORIA_FILAS_ID: texto(process.env.CATEGORIA_FILAS_ID) || texto(process.env.CATEGORY_FILAS_ID),

  /**
   * ONDE OS TICKETS NASCEM — sempre uma CATEGORIA.
   * A ordem de prioridade está em src/servicos/tickets.js.
   */
  CATEGORY_TICKETS_ID: texto(process.env.CATEGORY_TICKETS_ID),
  TICKET_CATEGORIA_ID: texto(process.env.TICKET_CATEGORIA_ID),
  /** Nome alternativo da mesma configuração (compatibilidade). */
  TICKET_DESTINO_ID: texto(process.env.TICKET_DESTINO_ID),
  /** Nome antigo da mesma variável — continua aceito para não quebrar .env já existente. */
  CATEGORIA_SUPORTE_ID: texto(process.env.CATEGORIA_SUPORTE_ID) || texto(process.env.CATEGORY_TICKETS_ID),

  /** Nix FF · API de salas automáticas (a chave NUNCA vai para o Discord). */
  NIX_API_KEY: texto(process.env.NIX_API_KEY) || texto(process.env.NIX_TOKEN),
  NIX_API_URL: texto(process.env.NIX_API_URL, 'https://salas.nixbot.vip'),

  CARGO_ADMIN_ID: texto(process.env.CARGO_ADMIN_ID),
  CARGO_STAFF_ID: texto(process.env.CARGO_STAFF_ID),
  CARGO_MEDIADOR_ID: texto(process.env.CARGO_MEDIADOR_ID),
  /** Cargos do atendimento (tickets) — não atuam nas filas de aposta. */
  CARGO_SUPORTE_ID: texto(process.env.CARGO_SUPORTE_ID),
  CARGO_AUX_ID: texto(process.env.CARGO_AUX_ID),
  CANAL_LOGS_ID: texto(process.env.CANAL_LOGS_ID),

  /** Telagem: base do link da call de triagem (ex: https://meet.jit.si). */
  TELAGEM_URL_BASE: texto(process.env.TELAGEM_URL_BASE, 'https://meet.jit.si'),
  /** Botão "Abrir Free Fire" que acompanha o ID/senha da sala. */
  FREE_FIRE_LINK: texto(process.env.FREE_FIRE_LINK, 'https://ff.garena.com/'),

  COMISSAO_PADRAO: numero(process.env.COMISSAO_PADRAO, 0.05, 0, 0.5),
  MOEDA: texto(process.env.MOEDA, 'Royal Coin'),

  LIMITES: {
    FILA_POR_GRUPO: 40,
    MENSAGENS_LIMPAR: 100,
    DM_MASSA: 500,
    HISTORICO: 10,
    RANKING: 10,
    REGRAS: 900,
  },

  CORES: {
    principal: 0x9b5cff,
    sucesso: 0x2ecc71,
    erro: 0xe74c3c,
    aviso: 0xf1c40f,
    neutro: 0x2b2d31,
    ouro: 0xf5b942,
    gelo: 0x5bc8f5,
  },

  /** Nome do arquivo de banco, para mensagens de erro. */
  NOME_BANCO: path.basename(texto(process.env.DATABASE_PATH, 'database/royal.db')),

  modoPorId(id) {
    return POR_ID.get(String(id || '').toLowerCase()) || null;
  },

  modoPorComando(nome) {
    return MODOS.find((modo) => modo.comando === nome) || null;
  },
};

/**
 * Confere o token antes de tentar conectar.
 * Devolve a mensagem de erro, ou null quando está tudo certo.
 */
config.validarToken = function validarToken() {
  if (!config.TOKEN) {
    return 'O token não foi preenchido. Abra o arquivo .env e coloque o token na linha DISCORD_TOKEN=.';
  }
  if (config.TOKEN === config.PLACEHOLDER) {
    return 'Você esqueceu de trocar o texto COLE_SEU_TOKEN_AQUI pelo token de verdade no .env.';
  }
  if (config.TOKEN.split('.').length < 3) {
    return 'O token parece incompleto. Copie de novo em Developer Portal → Bot → Reset Token (é uma linha só).';
  }
  if (/^COLE_/i.test(config.TOKEN)) {
    return 'O DISCORD_TOKEN ainda está com o texto de exemplo. Cole o token de verdade.';
  }
  return null;
};

module.exports = config;
