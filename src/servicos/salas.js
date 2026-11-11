'use strict';

/**
 * Sala do jogo (Nix FF) amarrada à partida de apostado.
 *
 * Depois do pagamento o mediador cria a sala pelo botão/comando, a API da Nix
 * devolve ID e senha, e o bot publica tudo no canal da fila (onde as 15
 * mensagens foram publicadas) com um botão que abre o Free Fire.
 */

const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const { embed, reais, mencao } = require('../util/embeds');
const nix = require('./nix');
const paineis = require('./paineis');
const partidas = require('./partidas');

/** Tipo de entrada da fila → config_type da Nix. */
const MAPA_NIX = {
  infinito: 'gelo_inf',
  normal: 'ap_padrao',
  full_capa: 'ap_fullcapa',
  ump_xm8: 'tatico',
  emu1: 'tatico',
  emu2: 'tatico',
  emu3: 'tatico',
};

const modoNix = (partida) => MAPA_NIX[String(partida?.gelo || '')] || 'ap_padrao';
const senhaAleatoria = () => String(crypto.randomInt(1000, 10000));

/** Canal onde as 15 mensagens daquela fila foram publicadas (informativo). */
function canalDaFila(db, partida) {
  const painel = paineis.obter(db, { guildId: partida.guild_id, modo: partida.modo });
  return painel?.canal_id || null;
}

function embedSalaLiberada(partida, dados, lista) {
  const modo = config.modoPorId(partida.modo);
  const tempo = Number(dados?.start_delay_minutes) || 10;

  return embed(
    `🎮 Sala liberada · ${modo ? modo.titulo : partida.modo}`,
    [
      `**ID da sala:** \`${dados?.room_id ?? '—'}\``,
      `**Senha:** \`${dados?.password ?? '—'}\``,
      `**Aposta:** ${reais(partida.preco)} por jogador · **Jogadores:** ${lista.length}`,
      '',
      `➜ Entrem no Free Fire agora: a partida começa em ~${tempo} min.`,
      '➜ Qualquer problema, chamem o mediador aqui mesmo no canal.',
    ].join('\n'),
    {
      cor: config.CORES.sucesso,
      campos: lista.length
        ? [{ name: 'Jogadores', value: lista.map((linha) => `${linha.time}. ${mencao(linha.user_id)}`).join('\n') }]
        : [],
      rodape: `Sala ${dados?.session_id || ''} · ORG Royal AP`.trim(),
    },
  );
}

function componentesSala() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setURL(config.FREE_FIRE_LINK || 'https://ff.garena.com/')
        .setLabel('Abrir Free Fire')
        .setEmoji('🔫')
        .setStyle(ButtonStyle.Link),
    ),
  ];
}

/**
 * Publica o ID/senha APENAS no canal privado daquela partida.
 *
 * Era isso que faltava de segurança: o canal da partida é isolado (só os
 * jogadores daquela sala + mediador/ADM veem), então o ID/senha não vaza para
 * a fila pública nem para outra partida. O canal da fila NÃO recebe a senha.
 */
async function publicarSalaLiberada(client, db, partidaId, dados) {
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return null;
  const lista = partidas.jogadores(db, partidaId);

  const canalId = partida.canal_id;
  const canal = client?.channels?.cache?.get?.(canalId) || (await client?.channels?.fetch?.(canalId).catch?.(() => null));
  if (!canal?.send) return null;

  await canal.send({
    content: `${lista.map((linha) => mencao(linha.user_id)).join(' ')} — sala do AP pronta!`,
    embeds: [embedSalaLiberada(partida, dados, lista)],
    components: componentesSala(),
    allowedMentions: { users: lista.map((linha) => String(linha.user_id)) },
  });

  return canal.id;
}

/**
 * Cria a sala na Nix para uma partida já paga, grava ID/senha e avisa no canal
 * da fila. Lança Error amigável quando não pode.
 *
 * IDEMPOTÊNCIA: usa a trava `sala_lock_em` da própria partida. Dois cliques
 * simultâneos (ou um clique e um timeout que já estava no ar) nunca chamam a
 * API duas vezes — só quem pega a trava fala com a Nix. Se a sala já existe,
 * devolve a mesma sala sem gastar requisição.
 */
async function criarSalaDaPartida(client, db, { partidaId }) {
  const partida = partidas.buscar(db, partidaId);
  if (!partida) throw new Error('Sala não encontrada.');
  if (!['pago', 'sala_liberada'].includes(partida.status)) {
    throw new Error('Confirme o pagamento antes de criar a sala do jogo.');
  }

  // Já criada: devolve a sala que está gravada na partida (sem nova requisição).
  if (partida.status === 'sala_liberada' && partida.sala_id) {
    return {
      dados: {
        room_id: partida.sala_id,
        password: partida.sala_senha,
        session_id: partida.nix_sessao,
      },
      partida,
      canalId: null,
      reutilizada: true,
    };
  }

  if (!partidas.travarSala(db, partidaId)) {
    throw new Error(
      'A sala dessa partida já está sendo criada agora. Aguarde alguns segundos e atualize o painel.',
    );
  }

  try {
    // Confere de novo DENTRO da trava (a sala pode ter sido criada por outro clique).
    const atual = partidas.buscar(db, partidaId);
    if (atual.status === 'sala_liberada' && atual.sala_id) {
      return {
        dados: { room_id: atual.sala_id, password: atual.sala_senha, session_id: atual.nix_sessao },
        partida: atual,
        canalId: null,
        reutilizada: true,
      };
    }

    const dados = await nix.criarSala({
      senha: senhaAleatoria(),
      delayMinutos: 10,
      modo: modoNix(atual),
      nome: `Royal AP ${reais(atual.preco)}`,
    });

    partidas.liberarSala(db, partidaId, {
      salaId: dados.room_id,
      senha: dados.password,
      sessao: dados.session_id ?? null,
    });
    const canalId = await publicarSalaLiberada(client, db, partidaId, dados).catch((erro) => {
      console.error('[salas] não consegui avisar no canal da fila:', erro.message);
      return null;
    });

    return { dados, partida: partidas.buscar(db, partidaId), canalId };
  } finally {
    // Solta a trava SEMPRE (sucesso, erro da Nix ou falha no envio).
    partidas.destravarSala(db, partidaId);
  }
}

module.exports = {
  MAPA_NIX,
  modoNix,
  senhaAleatoria,
  canalDaFila,
  embedSalaLiberada,
  componentesSala,
  publicarSalaLiberada,
  criarSalaDaPartida,
};
