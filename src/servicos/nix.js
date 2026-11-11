'use strict';

/**
 * Integração com a API de Salas da Nix FF (nixff.vip).
 *
 * Documentação: https://nixff.vip/docs
 * Base:        https://salas.nixbot.vip/
 *
 * A chave fica SÓ no .env (NIX_API_KEY) ou nas variáveis de ambiente da
 * hospedagem. Ela nunca é enviada para o Discord, nunca é impressa em log e
 * nunca aparece nas mensagens do bot.
 *
 * Tudo aqui devolve dados "crus" da API. Quem monta embed é o comando /nix.
 */

const config = require('../config');

const BASE_PADRAO = 'https://salas.nixbot.vip';
const TEMPO_LIMITE = 15000;

/** Modos aceitos por POST /rooms. */
const MODOS = [
  { id: 'ap_padrao', nome: 'AP padrão' },
  { id: 'gelo_inf', nome: 'Gelo infinito' },
  { id: 'tatico', nome: 'Tático' },
  { id: 'ap_fullcapa', nome: 'AP full capa' },
  { id: 'capa_3', nome: 'Capa 3' },
  { id: 'ap_uxd', nome: 'AP UXD' },
  { id: 'ap_7r', nome: 'AP 7R' },
  { id: 'br_padrao', nome: 'Battle Royale' },
];

const IDS_MODOS = new Set(MODOS.map((modo) => modo.id));
const MAPAS_AP = new Set(['Bermuda', 'Purgatory', 'Kalahari', 'Nextera']);
const MAPAS_BR = new Set(['Bermuda', 'Purgatory', 'Kalahari', 'Nova Terra', 'Nextera', 'Solara']);

/** Erro amigável: a mensagem já sai pronta para mostrar no Discord. */
class ErroNix extends Error {
  constructor(mensagem, { status = 0, detalhe = null } = {}) {
    super(mensagem);
    this.name = 'ErroNix';
    this.status = status;
    this.detalhe = detalhe;
  }
}

/** Lê a chave do ambiente (testes e hospedagem podem trocar em tempo real). */
function chave() {
  if (Object.prototype.hasOwnProperty.call(process.env, 'NIX_API_KEY')) {
    return String(process.env.NIX_API_KEY ?? '').trim();
  }
  return String(config.NIX_API_KEY || '').trim();
}

function base() {
  const bruta = String(process.env.NIX_API_URL || config.NIX_API_URL || BASE_PADRAO).trim();
  return (bruta || BASE_PADRAO).replace(/\/+$/, '');
}

/** Chave preenchida e que não é o texto de exemplo. */
function configurado() {
  const valor = chave();
  return Boolean(valor) && !/^COLE_/i.test(valor);
}

function exigirConfiguracao() {
  if (configurado()) return;
  throw new ErroNix(
    'A API da Nix não está configurada.\n' +
      'Coloque `NIX_API_KEY=sua_chave` no arquivo `.env` (ou nas variáveis de ambiente da hospedagem) e reinicie o bot.',
  );
}

/** Traduz o status HTTP da Nix para uma frase que o jogador entende. */
function mensagemErro(status, dados) {
  const detalhe = String(dados?.detail || dados?.message || '').trim();
  const rodape = detalhe ? `\nDetalhe da Nix: ${detalhe}` : '';
  switch (Number(status)) {
    case 401:
      return `A chave da Nix foi recusada (401). Confira o \`NIX_API_KEY\` no .env.${rodape}`;
    case 402:
      return `Saldo/assinatura da Nix insuficiente para criar a sala (402). Recarregue em nixff.vip.${rodape}`;
    case 403:
      return `A chave da Nix está válida, mas desabilitada ou sem permissão para essa rota (403).${rodape}`;
    case 404:
      return `A sessão não existe mais (404). A sala expirou, já deu start ou já foi liberada.${rodape}`;
    case 409:
      return `Ação inválida para o estado atual da sala (409) — por exemplo, iniciar uma sala que já começou.${rodape}`;
    case 422:
      return `A Nix recusou os dados enviados (422). Confira senha (1 a 16), tempo e modo.${rodape}`;
    case 429:
      return `Muitas requisições para a Nix agora (429). Espere ~1 minuto e tente de novo.${rodape}`;
    case 503:
      return `A Nix está fora do ar ou sem conta disponível para criar a sala (503). Tente de novo em instantes.${rodape}`;
    default:
      return `A API da Nix respondeu com erro ${status || 'desconhecido'}.${rodape}`;
  }
}

/**
 * Chamada crua na API. Sempre JSON, sempre com Bearer, sempre com timeout.
 * Lança ErroNix com mensagem pronta para o Discord.
 */
async function requisitar(rota, { metodo = 'GET', corpo = null, tempoLimite = TEMPO_LIMITE } = {}) {
  exigirConfiguracao();

  const caminho = rota.startsWith('/') ? rota : `/${rota}`;
  const url = `${base()}${caminho}`;
  const cabecalhos = { Authorization: `Bearer ${chave()}`, Accept: 'application/json' };
  if (corpo !== null) cabecalhos['Content-Type'] = 'application/json';

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), tempoLimite);
  if (typeof relogio.unref === 'function') relogio.unref();

  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === null ? undefined : JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (erro) {
    const abortado = erro?.name === 'AbortError';
    throw new ErroNix(
      abortado
        ? 'A API da Nix demorou demais para responder. Tente de novo em instantes.'
        : 'Não consegui falar com a API da Nix (sem internet ou serviço fora do ar). Tente de novo.',
      { detalhe: erro?.message || null },
    );
  } finally {
    clearTimeout(relogio);
  }

  const texto = await resposta.text().catch(() => '');
  let dados = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      dados = { raw: texto.slice(0, 300) };
    }
  }

  if (!resposta.ok) {
    throw new ErroNix(mensagemErro(resposta.status, dados), {
      status: resposta.status,
      detalhe: dados?.detail || dados?.raw || null,
    });
  }

  return dados ?? {};
}

// ───────────────────────────── rotas da API ─────────────────────────────

/** GET /balance — saldo, plano e assinatura. */
function saldo() {
  return requisitar('/balance');
}

/** GET /players/{uid}?region=BR — perfil público (não debita saldo). */
function jogador(uid, regiao = 'BR') {
  const limpo = String(uid ?? '').trim();
  if (!/^\d{3,20}$/.test(limpo)) {
    throw new ErroNix('UID inválido. Use só números, como `1234567890`.');
  }
  const sigla = String(regiao || 'BR').trim().toUpperCase().slice(0, 3) || 'BR';
  return requisitar(`/players/${limpo}?region=${encodeURIComponent(sigla)}`);
}

/**
 * POST /rooms — cria a sala no Free Fire com uma conta bot da Nix.
 * Em AP/custom o tempo vai de 1 a 10 min; em Battle Royale, de 1 a 20.
 */
async function criarSala({
  senha,
  delayMinutos = 10,
  modo = 'ap_padrao',
  nome = null,
  mapa = null,
  ouro1500 = false,
  carregamento = false,
  equipe = null,
  espectadores = null,
} = {}) {
  const segredo = String(senha ?? '').trim();
  if (segredo.length < 1 || segredo.length > 16) {
    throw new ErroNix('A senha da sala precisa ter de 1 a 16 caracteres.');
  }

  const tipo = String(modo || 'ap_padrao').trim().toLowerCase();
  if (!IDS_MODOS.has(tipo)) {
    throw new ErroNix(`Modo inválido. Use um destes: ${[...IDS_MODOS].join(', ')}.`);
  }

  const br = tipo === 'br_padrao';
  const atraso = Number.parseInt(delayMinutos, 10);
  const limite = br ? 20 : 10;
  if (!Number.isFinite(atraso) || atraso < 1 || atraso > limite) {
    throw new ErroNix(`O tempo da sala precisa ser de 1 a ${limite} minutos ${br ? '(Battle Royale)' : '(AP)'}.`);
  }

  const corpo = { password: segredo, start_delay_minutes: atraso, config_type: tipo };

  if (nome) corpo.room_name = String(nome).trim().slice(0, 60);

  if (mapa) {
    const mapaTexto = String(mapa).trim();
    const permitidos = br ? MAPAS_BR : MAPAS_AP;
    const achado = [...permitidos].find((item) => item.toLowerCase() === mapaTexto.toLowerCase());
    if (!achado) {
      throw new ErroNix(`Mapa inválido para esse modo. Use: ${[...permitidos].join(', ')}.`);
    }
    corpo.map_name = achado;
  }

  if (br) {
    if (equipe) corpo.equipe = String(equipe).trim().toLowerCase();
    if (espectadores) corpo.espectadores = Number(espectadores);
  } else {
    corpo['1500_ouro'] = Boolean(ouro1500);
    corpo.carregamento = Boolean(carregamento);
  }

  return requisitar('/rooms', { metodo: 'POST', corpo });
}

/** POST /rooms/{session_id}/start — inicia a partida. */
function iniciarSala(sessao) {
  return requisitar(`/rooms/${encodeURIComponent(sessaoId(sessao))}/start`, { metodo: 'POST' });
}

/** POST /rooms/{session_id}/release — encerra a sessão sem dar start. */
function liberarSala(sessao) {
  return requisitar(`/rooms/${encodeURIComponent(sessaoId(sessao))}/release`, { metodo: 'POST' });
}

/** POST /rooms/{session_id}/kick — expulsa um jogador. */
function chutarJogador(sessao, uid) {
  const alvo = String(uid ?? '').trim();
  if (!/^\d{3,20}$/.test(alvo)) throw new ErroNix('UID inválido para expulsar. Use só números.');
  return requisitar(`/rooms/${encodeURIComponent(sessaoId(sessao))}/kick`, {
    metodo: 'POST',
    corpo: { player_uid: alvo },
  });
}

/** POST /rooms/{session_id}/edit — troca o modo da sala (só antes do start). */
function editarSala(sessao, { modo, senha = null, ouro1500 = false, carregamento = false } = {}) {
  const tipo = String(modo || '').trim().toLowerCase();
  if (!IDS_MODOS.has(tipo) || tipo === 'br_padrao') {
    throw new ErroNix('Modo inválido para edição. Use ap_padrao, gelo_inf, tatico, ap_fullcapa, capa_3, ap_uxd ou ap_7r.');
  }
  const corpo = { config_type: tipo, '1500_ouro': Boolean(ouro1500), carregamento: Boolean(carregamento) };
  if (senha) corpo.password = String(senha).trim().slice(0, 16);
  return requisitar(`/rooms/${encodeURIComponent(sessaoId(sessao))}/edit`, { metodo: 'POST', corpo });
}

/** GET /rooms/{session_id} — estado atual da sessão. */
function sessao(sessao) {
  return requisitar(`/rooms/${encodeURIComponent(sessaoId(sessao))}`);
}

/** GET /rooms/{session_id}/members — jogadores dentro da sala. */
function membros(sessao, { loadout = false } = {}) {
  const sufixo = loadout ? '?include_loadout=true' : '';
  return requisitar(`/rooms/${encodeURIComponent(sessaoId(sessao))}/members${sufixo}`);
}

/** GET /rooms/{session_id}/result — resultado da partida. */
function resultado(sessao) {
  return requisitar(`/rooms/${encodeURIComponent(sessaoId(sessao))}/result`);
}

/** GET /stats/tc?ids=a,b,c — estatísticas competitivas de vários UIDs. */
function statsTC(uids) {
  const lista = (Array.isArray(uids) ? uids : String(uids ?? '').split(','))
    .map((uid) => String(uid).trim())
    .filter((uid) => /^\d{3,20}$/.test(uid));
  if (lista.length === 0) throw new ErroNix('Informe pelo menos um UID válido (só números).');
  return requisitar(`/stats/tc?ids=${encodeURIComponent(lista.join(','))}`);
}

function sessaoId(valor) {
  const limpo = String(valor ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(limpo)) {
    throw new ErroNix('ID de sessão inválido. Copie o `session_id` devolvido na criação da sala.');
  }
  return limpo;
}

module.exports = {
  MODOS,
  MAPAS_AP: [...MAPAS_AP],
  MAPAS_BR: [...MAPAS_BR],
  ErroNix,
  configurado,
  requisitar,
  mensagemErro,
  saldo,
  jogador,
  criarSala,
  iniciarSala,
  liberarSala,
  chutarJogador,
  editarSala,
  sessao,
  membros,
  resultado,
  statsTC,
};
