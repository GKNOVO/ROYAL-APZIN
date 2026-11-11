'use strict';

/**
 * Partidas: criação, confirmação de regras, mediação, PIX, pagamento, sala,
 * GO dos jogadores e resultado.
 *
 * ┌──────────────┐   ┌────────────────────┐   ┌─────────────────────┐
 * │ confirmando  │ → │ aguardando_mediador│ → │ aguardando_pagamento│
 * └──────────────┘   └────────────────────┘   └─────────────────────┘
 *                                                      ↓
 *                          ┌───────────────┐   ┌──────────────┐
 *                          │ sala_liberada │ ← │     pago     │
 *                          └───────────────┘   └──────────────┘
 *                                 ↓ /go dos dois jogadores
 *                          ┌───────────────┐
 *                          │ em_andamento  │ → finalizada
 *                          └───────────────┘
 *
 * Toda mudança de estado passa por `aplicarTransicao`, que é um UPDATE
 * condicional no banco (status atual + estado de destino). Dois cliques
 * simultâneos nunca avançam a mesma partida duas vezes.
 */

const crypto = require('crypto');
const usuarios = require('./usuarios');
const { limpar, idSala, senhaSala } = require('../util/validacao');

const agora = () => Date.now();

const STATUS = {
  CONFIRMANDO: 'confirmando',
  AGUARDANDO_MEDIADOR: 'aguardando_mediador',
  AGUARDANDO_PAGAMENTO: 'aguardando_pagamento',
  PAGO: 'pago',
  SALA_LIBERADA: 'sala_liberada',
  EM_ANDAMENTO: 'em_andamento',
  FINALIZADA: 'finalizada',
  CANCELADA: 'cancelada',
};

const ATIVOS = new Set([
  STATUS.CONFIRMANDO,
  STATUS.AGUARDANDO_MEDIADOR,
  STATUS.AGUARDANDO_PAGAMENTO,
  STATUS.PAGO,
  STATUS.SALA_LIBERADA,
  STATUS.EM_ANDAMENTO,
]);

/**
 * Para onde cada estado pode ir.
 * FINALIZADA aparece nos estados iniciais porque o W.O. encerra a partida
 * quando um time não aparece — mas `finalizar` só aceita essas origens quando
 * o motivo é 'wo'; resultado normal exige sala liberada/em andamento.
 */
const TRANSICOES = {
  [STATUS.CONFIRMANDO]: [STATUS.AGUARDANDO_MEDIADOR, STATUS.FINALIZADA, STATUS.CANCELADA],
  [STATUS.AGUARDANDO_MEDIADOR]: [STATUS.AGUARDANDO_PAGAMENTO, STATUS.FINALIZADA, STATUS.CANCELADA],
  [STATUS.AGUARDANDO_PAGAMENTO]: [STATUS.PAGO, STATUS.FINALIZADA, STATUS.CANCELADA],
  [STATUS.PAGO]: [STATUS.SALA_LIBERADA, STATUS.FINALIZADA, STATUS.CANCELADA],
  [STATUS.SALA_LIBERADA]: [STATUS.EM_ANDAMENTO, STATUS.FINALIZADA, STATUS.CANCELADA],
  [STATUS.EM_ANDAMENTO]: [STATUS.FINALIZADA, STATUS.CANCELADA],
  [STATUS.FINALIZADA]: [],
  [STATUS.CANCELADA]: [],
};

/** Tempo máximo de uma trava de criação de sala (a API pode levar 15s). */
const TRAVA_SALA_MS = 90 * 1000;

const podeTransicionar = (de, para) => (TRANSICOES[de] || []).includes(para);

function novoId() {
  return crypto.randomBytes(6).toString('hex');
}

function exigirPartida(db, id) {
  const partida = buscar(db, id);
  if (!partida) throw new Error('Partida não encontrada.');
  return partida;
}

/**
 * Mudança de estado atômica: só aplica se a partida ainda estiver em um dos
 * estados de origem permitidos. Devolve true quando ESTA chamada mudou.
 */
function aplicarTransicao(db, id, para, origens = [], campos = {}) {
  const de = origens.filter((origem) => podeTransicionar(origem, para));
  if (de.length === 0) throw new Error(`Mudança de estado inválida (${para}).`);

  const colunas = Object.keys(campos);
  const sql =
    `UPDATE partidas SET status = ?${colunas.map((coluna) => `, ${coluna} = ?`).join('')}` +
    ` WHERE id = ? AND status IN (${de.map(() => '?').join(', ')})`;

  const resultado = db
    .prepare(sql)
    .run(para, ...colunas.map((coluna) => campos[coluna]), String(id), ...de);
  return resultado.changes === 1;
}

function criar(db, { guildId, modo, preco, gelo, canalId, jogadores }) {
  if (!Array.isArray(jogadores) || jogadores.length === 0) {
    throw new Error('Não dá para criar partida sem jogadores.');
  }
  const id = novoId();
  const executar = db.transaction(() => {
    db.prepare(
      `INSERT INTO partidas (id, guild_id, modo, preco, gelo, canal_id, status, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      String(guildId),
      String(modo),
      Math.trunc(preco),
      String(gelo),
      String(canalId),
      STATUS.CONFIRMANDO,
      agora(),
    );

    const inserirJogador = db.prepare(
      'INSERT INTO partida_jogadores (partida_id, user_id, time, confirmou) VALUES (?, ?, ?, 0)',
    );
    for (const jogador of jogadores) {
      inserirJogador.run(id, String(jogador.userId), Number(jogador.time));
    }
  });
  executar();
  return buscar(db, id);
}

function buscar(db, id) {
  return db.prepare('SELECT * FROM partidas WHERE id = ?').get(String(id)) || null;
}

function jogadores(db, id) {
  return db
    .prepare('SELECT * FROM partida_jogadores WHERE partida_id = ? ORDER BY time ASC, rowid ASC')
    .all(String(id));
}

function confirmados(db, id) {
  const linha = db
    .prepare('SELECT COUNT(*) AS total FROM partida_jogadores WHERE partida_id = ? AND confirmou = 1')
    .get(String(id));
  return linha ? linha.total : 0;
}

function definirMensagem(db, id, mensagemId) {
  db.prepare('UPDATE partidas SET mensagem_id = ? WHERE id = ?').run(String(mensagemId), String(id));
}

function porCanal(db, guildId, canalId) {
  return (
    db
      .prepare(
        `SELECT * FROM partidas
          WHERE guild_id = ? AND canal_id = ?
          ORDER BY (status IN ('finalizada', 'cancelada')) ASC, criado_em DESC LIMIT 1`,
      )
      .get(String(guildId), String(canalId)) || null
  );
}

function ativas(db, guildId) {
  return db
    .prepare(
      `SELECT * FROM partidas
        WHERE guild_id = ? AND status NOT IN ('finalizada', 'cancelada')
        ORDER BY criado_em ASC`,
    )
    .all(String(guildId));
}

function definirRegras(db, id, texto, autorId) {
  const partida = exigirPartida(db, id);
  if (!ATIVOS.has(partida.status)) throw new Error('Essa partida já foi encerrada.');
  const limpo = limpar(texto, 900);
  if (limpo.length < 5) throw new Error('Escreva a regra da partida (pelo menos 5 letras).');
  db.prepare('UPDATE partidas SET regras = ?, regras_por = ? WHERE id = ?').run(
    limpo,
    String(autorId),
    String(id),
  );
  return buscar(db, id);
}

/** A pessoa é jogadora desta partida? */
function participante(db, id, userId) {
  return Boolean(
    db
      .prepare('SELECT 1 AS ok FROM partida_jogadores WHERE partida_id = ? AND user_id = ?')
      .get(String(id), String(userId)),
  );
}

/**
 * O mediador RESPONSÁVEL pela partida? (ADM do servidor também pode.)
 * Não basta ter o cargo de mediador: quem assumiu a sala é que manda nela.
 */
function mediadorResponsavel(partida, userId) {
  return Boolean(partida?.mediador_id) && String(partida.mediador_id) === String(userId);
}

/** Um clique por jogador. Quando todos confirmam, vai para a fila de mediação. */
function confirmar(db, id, userId) {
  const executar = db.transaction(() => {
    const partida = exigirPartida(db, id);
    if (partida.status !== STATUS.CONFIRMANDO) {
      return {
        ok: false,
        motivo: 'status',
        partida,
        confirmados: confirmados(db, id),
        total: jogadores(db, id).length,
      };
    }
    const eu = db
      .prepare('SELECT * FROM partida_jogadores WHERE partida_id = ? AND user_id = ?')
      .get(String(id), String(userId));
    if (!eu) throw new Error('Você não está nessa partida.');

    const jaConfirmou = eu.confirmou === 1;
    if (!jaConfirmou) {
      db.prepare('UPDATE partida_jogadores SET confirmou = 1 WHERE partida_id = ? AND user_id = ?')
        .run(String(id), String(userId));
    }

    const total = jogadores(db, id).length;
    const quantos = confirmados(db, id);
    if (quantos >= total) {
      // Atômico: se outra confirmação já mudou o estado, não faz nada.
      aplicarTransicao(db, id, STATUS.AGUARDANDO_MEDIADOR, [STATUS.CONFIRMANDO]);
    }
    return {
      ok: true,
      jaConfirmou,
      confirmados: quantos,
      total,
      completo: quantos >= total,
      partida: buscar(db, id),
    };
  });
  return executar();
}

function assumir(db, id, mediadorId, comissao) {
  const partida = exigirPartida(db, id);
  const eu = String(mediadorId);

  if (partida.mediador_id && String(partida.mediador_id) !== eu) {
    throw new Error('Essa sala já tem um mediador responsável.');
  }
  if (partida.status === STATUS.AGUARDANDO_PAGAMENTO && partida.mediador_id === eu) {
    return partida; // clique repetido: idempotente
  }

  const valor = Number.isFinite(Number(comissao)) ? Number(comissao) : 0;
  const resultado = db
    .prepare(
      `UPDATE partidas
          SET mediador_id = ?, comissao = ?, status = ?
        WHERE id = ?
          AND (mediador_id IS NULL OR mediador_id = ?)
          AND status IN (?, ?, ?)`,
    )
    .run(
      eu,
      valor,
      STATUS.AGUARDANDO_PAGAMENTO,
      String(id),
      eu,
      STATUS.CONFIRMANDO,
      STATUS.AGUARDANDO_MEDIADOR,
      STATUS.AGUARDANDO_PAGAMENTO,
    );

  if (resultado.changes !== 1) {
    const atual = buscar(db, id);
    if (atual?.mediador_id && String(atual.mediador_id) !== eu) {
      throw new Error('Essa sala já tem um mediador responsável.');
    }
    throw new Error('Essa partida não está mais aberta para mediação.');
  }
  return buscar(db, id);
}

function salvarPix(db, id, { chave, titular }) {
  const partida = exigirPartida(db, id);
  if (!ATIVOS.has(partida.status)) throw new Error('Essa partida já foi encerrada.');
  const chaveLimpa = chave ? limpar(chave, 200) : null;
  if (chaveLimpa && chaveLimpa.length < 3) throw new Error('A chave PIX parece curta demais.');
  db.prepare('UPDATE partidas SET pix_chave = ?, pix_titular = ? WHERE id = ?').run(
    chaveLimpa,
    titular ? limpar(titular, 120) : null,
    String(id),
  );
  return buscar(db, id);
}

/** Pagamento confirmado pelo mediador. Repetir o clique não muda nada. */
function marcarPago(db, id) {
  const partida = exigirPartida(db, id);
  if (partida.status === STATUS.PAGO) return partida;
  if (partida.status !== STATUS.AGUARDANDO_PAGAMENTO) {
    throw new Error('Só dá para confirmar pagamento com o mediador já na sala.');
  }
  const mudou = aplicarTransicao(db, id, STATUS.PAGO, [STATUS.AGUARDANDO_PAGAMENTO], {
    pago_em: agora(),
  });
  if (!mudou) {
    const atual = buscar(db, id);
    if (atual?.status === STATUS.PAGO) return atual;
    throw new Error('Não foi possível confirmar o pagamento agora. Atualize o painel.');
  }
  return buscar(db, id);
}

/**
 * ID/senha da sala do jogo. Idempotente: liberar de novo com o mesmo ID só
 * devolve a partida, sem mudar estado nem zerar a trava.
 */
function liberarSala(db, id, { salaId, senha, sessao = null }) {
  const partida = exigirPartida(db, id);
  const identificador = idSala(salaId);
  const segredo = senhaSala(senha);

  if (partida.status === STATUS.SALA_LIBERADA && partida.sala_id === identificador) {
    return partida;
  }
  if (![STATUS.PAGO, STATUS.SALA_LIBERADA].includes(partida.status)) {
    throw new Error('Confirme o pagamento antes de liberar a criação da sala.');
  }

  const campos = {
    sala_id: identificador,
    sala_senha: segredo,
    liberada_em: agora(),
    nix_sessao: sessao ? limpar(sessao, 64) : partida.nix_sessao ?? null,
  };
  const mudou = aplicarTransicao(db, id, STATUS.SALA_LIBERADA, [STATUS.PAGO, STATUS.SALA_LIBERADA], campos);
  if (!mudou) {
    const atual = buscar(db, id);
    if (atual?.sala_id === identificador) return atual;
    throw new Error('Não foi possível liberar a sala agora. Atualize o painel e tente de novo.');
  }
  return buscar(db, id);
}

/**
 * Trava de criação de sala (idempotência / concorrência).
 * Só uma chamada pega a trava; as outras recebem `false` e não chamam a Nix.
 * A trava expira sozinha para nunca travar a partida para sempre.
 */
function travarSala(db, id) {
  const agoraMs = agora();
  const resultado = db
    .prepare(
      `UPDATE partidas SET sala_lock_em = ?
        WHERE id = ? AND status IN (?, ?)
          AND (sala_lock_em IS NULL OR sala_lock_em < ?)`,
    )
    .run(agoraMs, String(id), STATUS.PAGO, STATUS.SALA_LIBERADA, agoraMs - TRAVA_SALA_MS);
  return resultado.changes === 1;
}

function destravarSala(db, id) {
  try {
    db.prepare('UPDATE partidas SET sala_lock_em = NULL WHERE id = ?').run(String(id));
  } catch (erro) {
    console.error('[partidas] não consegui soltar a trava da sala:', erro.message);
  }
}

/**
 * /go: registra que o jogador já está na sala do Free Fire.
 * Quando todos deram GO, muda para EM_ANDAMENTO uma única vez.
 */
function darGo(db, { partidaId, userId }) {
  const executar = db.transaction(() => {
    const partida = exigirPartida(db, partidaId);
    if ([STATUS.FINALIZADA, STATUS.CANCELADA].includes(partida.status)) {
      throw new Error('Essa partida já foi encerrada.');
    }
    if (![STATUS.SALA_LIBERADA, STATUS.EM_ANDAMENTO].includes(partida.status)) {
      throw new Error(
        'A sala do jogo ainda não foi liberada. O `/go` só vale depois que o mediador publicar o ID e a senha.',
      );
    }
    const lista = jogadores(db, partidaId);
    if (!lista.some((linha) => String(linha.user_id) === String(userId))) {
      throw new Error('Você não está nessa partida.');
    }

    const inseriu =
      db
        .prepare('INSERT OR IGNORE INTO partida_go (partida_id, user_id, criado_em) VALUES (?, ?, ?)')
        .run(String(partidaId), String(userId), agora()).changes === 1;

    const deram = db
      .prepare('SELECT COUNT(*) AS total FROM partida_go WHERE partida_id = ?')
      .get(String(partidaId)).total;
    const total = lista.length;

    let iniciou = false;
    if (deram >= total && partida.status === STATUS.SALA_LIBERADA) {
      iniciou = aplicarTransicao(db, partidaId, STATUS.EM_ANDAMENTO, [STATUS.SALA_LIBERADA], {
        iniciada_em: agora(),
      });
    }

    return {
      ok: true,
      jaDeu: !inseriu,
      deram: Math.min(deram, total),
      total,
      prontos: deram >= total,
      iniciou,
      jaIniciada: partida.status === STATUS.EM_ANDAMENTO,
      partida: buscar(db, partidaId),
    };
  });
  return executar();
}

/**
 * Finaliza a partida, atualiza estatísticas, grava o extrato e devolve a lista.
 * motivo: 'resultado' ou 'wo'. Resultado exige partida em andamento (ou sala
 * liberada, para o mediador não ficar preso se o /go falhar).
 */
function finalizar(db, { partidaId, vencedorTime, autorId = null, motivo = 'resultado', canalId = null }) {
  const time = Number(vencedorTime);
  if (![1, 2].includes(time)) throw new Error('O time vencedor precisa ser 1 ou 2.');

  const executar = db.transaction(() => {
    const partida = exigirPartida(db, partidaId);
    if ([STATUS.FINALIZADA, STATUS.CANCELADA].includes(partida.status)) {
      throw new Error('Essa partida já foi encerrada.');
    }
    const origens =
      motivo === 'wo'
        ? [STATUS.CONFIRMANDO, STATUS.AGUARDANDO_MEDIADOR, STATUS.AGUARDANDO_PAGAMENTO, STATUS.PAGO, STATUS.SALA_LIBERADA, STATUS.EM_ANDAMENTO]
        : [STATUS.SALA_LIBERADA, STATUS.EM_ANDAMENTO];

    const mudou = aplicarTransicao(db, partidaId, STATUS.FINALIZADA, origens, {
      vencedor_time: time,
      finalizada_em: agora(),
      motivo_fim: motivo,
    });
    if (!mudou) {
      throw new Error('Essa partida não está pronta para receber resultado (confirme o pagamento e libere a sala).');
    }

    const lista = jogadores(db, partidaId);
    const valor = Math.trunc(Number(partida.preco) || 0);
    const extrato = db.prepare(
      `INSERT INTO transacoes (guild_id, user_id, tipo, valor, motivo, autor_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const jogador of lista) {
      if (jogador.time === time) {
        usuarios.registrarVitoria(db, {
          guildId: partida.guild_id,
          userId: jogador.user_id,
          apostado: valor,
          ganho: valor,
        });
        extrato.run(
          partida.guild_id,
          jogador.user_id,
          'premio',
          valor,
          `AP ${partidaId} · vitória${motivo === 'wo' ? ' por W.O.' : ''}`,
          autorId,
          agora(),
        );
      } else {
        usuarios.registrarDerrota(db, {
          guildId: partida.guild_id,
          userId: jogador.user_id,
          apostado: valor,
          wo: motivo === 'wo',
        });
        extrato.run(
          partida.guild_id,
          jogador.user_id,
          'aposta',
          valor,
          `AP ${partidaId} · derrota${motivo === 'wo' ? ' por W.O.' : ''}`,
          autorId,
          agora(),
        );
      }
    }

    db.prepare(
      `INSERT INTO auditoria (guild_id, autor_id, canal_id, acao, detalhe, motivo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      partida.guild_id,
      autorId,
      canalId ?? partida.canal_id,
      motivo === 'wo' ? 'WO aplicado' : 'Resultado registrado',
      `Partida ${partidaId} · time ${time} venceu · ${partida.modo} ${partida.preco}`,
      motivo === 'wo' ? 'Time ausente (W.O.)' : 'Resultado informado pelo mediador',
      agora(),
    );

    return { partida: buscar(db, partidaId), jogadores: lista };
  });
  return executar();
}

function aplicarWO(db, { partidaId, timeAusente, autorId = null, canalId = null }) {
  const ausente = Number(timeAusente);
  if (![1, 2].includes(ausente)) throw new Error('O time ausente precisa ser 1 ou 2.');
  return finalizar(db, {
    partidaId,
    vencedorTime: ausente === 1 ? 2 : 1,
    autorId,
    motivo: 'wo',
    canalId,
  });
}

/**
 * Cancela e, se o pagamento já tinha sido confirmado, registra o estorno de
 * cada jogador no extrato — tudo dentro da mesma transação do banco.
 */
function cancelar(db, { partidaId, autorId = null, motivo = 'cancelada pela staff', canalId = null }) {
  const texto = limpar(motivo, 200) || 'cancelada pela staff';

  const executar = db.transaction(() => {
    const partida = exigirPartida(db, partidaId);
    if ([STATUS.FINALIZADA, STATUS.CANCELADA].includes(partida.status)) {
      throw new Error('Essa partida já foi encerrada.');
    }

    const mudou = aplicarTransicao(db, partidaId, STATUS.CANCELADA, [...ATIVOS], {
      motivo_fim: texto,
      finalizada_em: agora(),
    });
    if (!mudou) {
      const atual = buscar(db, partidaId);
      if (atual?.status === STATUS.CANCELADA) return atual;
      throw new Error('Não foi possível cancelar essa partida agora. Atualize o painel.');
    }

    const pago = Boolean(partida.pago_em);
    if (pago) {
      const estorno = db.prepare(
        `INSERT INTO transacoes (guild_id, user_id, tipo, valor, motivo, autor_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const jogador of jogadores(db, partidaId)) {
        estorno.run(
          partida.guild_id,
          jogador.user_id,
          'estorno',
          Math.trunc(Number(partida.preco) || 0),
          `AP ${partidaId} cancelado · ${texto}`,
          autorId,
          agora(),
        );
      }
    }

    db.prepare(
      `INSERT INTO auditoria (guild_id, autor_id, canal_id, acao, detalhe, motivo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      partida.guild_id,
      autorId,
      canalId ?? partida.canal_id,
      'Partida cancelada',
      `${partidaId} · ${partida.modo} · ${reaisSeguro(partida.preco)}${pago ? ' · estorno registrado' : ''}`,
      texto,
      agora(),
    );

    return buscar(db, partidaId);
  });
  return executar();
}

/** Só para a mensagem de auditoria não depender de outro módulo. */
function reaisSeguro(centavos) {
  return `R$ ${((Number(centavos) || 0) / 100).toFixed(2).replace('.', ',')}`;
}

module.exports = {
  STATUS,
  ATIVOS,
  TRANSICOES,
  TRAVA_SALA_MS,
  podeTransicionar,
  aplicarTransicao,
  criar,
  buscar,
  jogadores,
  confirmados,
  definirMensagem,
  porCanal,
  ativas,
  definirRegras,
  participante,
  mediadorResponsavel,
  confirmar,
  assumir,
  salvarPix,
  marcarPago,
  liberarSala,
  travarSala,
  destravarSala,
  darGo,
  finalizar,
  aplicarWO,
  cancelar,
};
