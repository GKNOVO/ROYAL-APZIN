'use strict';

/** Partidas: criação, confirmação de regras, mediação, PIX, pagamento, sala e resultado. */

const crypto = require('crypto');
const usuarios = require('./usuarios');

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

function novoId() {
  return crypto.randomBytes(6).toString('hex');
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
    ).run(id, String(guildId), String(modo), Math.trunc(preco), String(gelo), String(canalId), STATUS.CONFIRMANDO, agora());

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
  const partida = buscar(db, id);
  if (!partida) throw new Error('Partida não encontrada.');
  if (!ATIVOS.has(partida.status)) throw new Error('Essa partida já foi encerrada.');
  const limpo = String(texto || '').trim().slice(0, 900);
  if (limpo.length < 5) throw new Error('Escreva a regra da partida (pelo menos 5 letras).');
  db.prepare('UPDATE partidas SET regras = ?, regras_por = ? WHERE id = ?').run(limpo, String(autorId), String(id));
  return buscar(db, id);
}

/** Um clique por jogador. Quando todos confirmam, vai para a fila de mediação. */
function confirmar(db, id, userId) {
  const partida = buscar(db, id);
  if (!partida) throw new Error('Partida não encontrada.');
  if (partida.status !== STATUS.CONFIRMANDO) {
    return { ok: false, motivo: 'status', partida, confirmados: confirmados(db, id), total: jogadores(db, id).length };
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
    db.prepare('UPDATE partidas SET status = ? WHERE id = ?').run(STATUS.AGUARDANDO_MEDIADOR, String(id));
  }
  return { ok: true, jaConfirmou, confirmados: quantos, total, completo: quantos >= total, partida: buscar(db, id) };
}

function assumir(db, id, mediadorId, comissao) {
  const partida = buscar(db, id);
  if (!partida) throw new Error('Partida não encontrada.');
  if (partida.mediador_id && partida.mediador_id !== String(mediadorId)) {
    throw new Error('Essa sala já tem um mediador responsável.');
  }
  const valor = Number.isFinite(Number(comissao)) ? Number(comissao) : 0;
  db.prepare(
    `UPDATE partidas SET mediador_id = ?, comissao = ?, status = ?
      WHERE id = ? AND status IN ('confirmando', 'aguardando_mediador', 'aguardando_pagamento')`,
  ).run(String(mediadorId), valor, STATUS.AGUARDANDO_PAGAMENTO, String(id));
  return buscar(db, id);
}

function salvarPix(db, id, { chave, titular }) {
  db.prepare('UPDATE partidas SET pix_chave = ?, pix_titular = ? WHERE id = ?')
    .run(chave ? String(chave) : null, titular ? String(titular) : null, String(id));
  return buscar(db, id);
}

function marcarPago(db, id) {
  const partida = buscar(db, id);
  if (!partida) throw new Error('Partida não encontrada.');
  if (![STATUS.AGUARDANDO_PAGAMENTO, STATUS.PAGO].includes(partida.status)) {
    throw new Error('Só dá para confirmar pagamento com o mediador já na sala.');
  }
  db.prepare('UPDATE partidas SET status = ?, pago_em = ? WHERE id = ?').run(STATUS.PAGO, agora(), String(id));
  return buscar(db, id);
}

function liberarSala(db, id, { salaId, senha }) {
  const partida = buscar(db, id);
  if (!partida) throw new Error('Partida não encontrada.');
  if (![STATUS.PAGO, STATUS.SALA_LIBERADA].includes(partida.status)) {
    throw new Error('Confirme o pagamento antes de liberar a criação da sala.');
  }
  const identificador = String(salaId || '').trim().slice(0, 40);
  if (identificador.length < 1) throw new Error('Informe o ID da sala.');
  db.prepare('UPDATE partidas SET sala_id = ?, sala_senha = ?, status = ?, liberada_em = ? WHERE id = ?')
    .run(identificador, senha ? String(senha).trim().slice(0, 40) : null, STATUS.SALA_LIBERADA, agora(), String(id));
  return buscar(db, id);
}

/**
 * /go: registra que o jogador já está dentro da sala do Free Fire.
 * Quando TODOS deram GO, a partida passa para EM_ANDAMENTO (uma única vez).
 */
function darGo(db, { partidaId, userId }) {
  const partida = buscar(db, partidaId);
  if (!partida) throw new Error('Partida não encontrada.');
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
    // Atômico: dois /go simultâneos nunca iniciam duas vezes.
    iniciou =
      db
        .prepare('UPDATE partidas SET status = ? WHERE id = ? AND status = ?')
        .run(STATUS.EM_ANDAMENTO, String(partidaId), STATUS.SALA_LIBERADA).changes === 1;
  }

  return {
    jaDeu: !inseriu,
    deram: Math.min(deram, total),
    total,
    iniciou,
    partida: buscar(db, partidaId),
  };
}

/**
 * Finaliza a partida, atualiza estatísticas e devolve a lista de jogadores.
 * motivo: 'resultado' ou 'wo'.
 */
function finalizar(db, { partidaId, vencedorTime, autorId = null, motivo = 'resultado' }) {
  const partida = buscar(db, partidaId);
  if (!partida) throw new Error('Partida não encontrada.');
  if ([STATUS.FINALIZADA, STATUS.CANCELADA].includes(partida.status)) {
    throw new Error('Essa partida já foi encerrada.');
  }
  const time = Number(vencedorTime);
  if (![1, 2].includes(time)) throw new Error('O time vencedor precisa ser 1 ou 2.');
  const lista = jogadores(db, partidaId);

  const executar = db.transaction(() => {
    db.prepare(
      `UPDATE partidas
          SET status = ?, vencedor_time = ?, finalizada_em = ?, motivo_fim = ?
        WHERE id = ?`,
    ).run(STATUS.FINALIZADA, time, agora(), motivo, String(partidaId));

    for (const jogador of lista) {
      if (jogador.time === time) {
        usuarios.registrarVitoria(db, {
          guildId: partida.guild_id,
          userId: jogador.user_id,
          apostado: partida.preco,
          ganho: partida.preco,
        });
      } else {
        usuarios.registrarDerrota(db, {
          guildId: partida.guild_id,
          userId: jogador.user_id,
          apostado: partida.preco,
          wo: motivo === 'wo',
        });
      }
    }

    db.prepare(
      `INSERT INTO auditoria (guild_id, autor_id, acao, detalhe, criado_em)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      partida.guild_id,
      autorId,
      motivo === 'wo' ? 'WO aplicado' : 'Resultado registrado',
      `Partida ${partidaId} · time ${time} venceu · ${partida.modo} ${partida.preco}`,
      agora(),
    );
  });
  executar();

  return { partida: buscar(db, partidaId), jogadores: lista };
}

function aplicarWO(db, { partidaId, timeAusente, autorId = null }) {
  const ausente = Number(timeAusente);
  if (![1, 2].includes(ausente)) throw new Error('O time ausente precisa ser 1 ou 2.');
  return finalizar(db, {
    partidaId,
    vencedorTime: ausente === 1 ? 2 : 1,
    autorId,
    motivo: 'wo',
  });
}

function cancelar(db, { partidaId, autorId = null, motivo = 'cancelada pela staff' }) {
  const partida = buscar(db, partidaId);
  if (!partida) throw new Error('Partida não encontrada.');
  if ([STATUS.FINALIZADA, STATUS.CANCELADA].includes(partida.status)) {
    throw new Error('Essa partida já foi encerrada.');
  }
  db.prepare('UPDATE partidas SET status = ?, motivo_fim = ?, finalizada_em = ? WHERE id = ?')
    .run(STATUS.CANCELADA, String(motivo).slice(0, 200), agora(), String(partidaId));
  db.prepare('INSERT INTO auditoria (guild_id, autor_id, acao, detalhe, criado_em) VALUES (?, ?, ?, ?, ?)')
    .run(partida.guild_id, autorId, 'Partida cancelada', `${partidaId} · ${motivo}`, agora());
  return buscar(db, partidaId);
}

module.exports = {
  STATUS,
  ATIVOS,
  criar,
  buscar,
  jogadores,
  confirmados,
  definirMensagem,
  porCanal,
  ativas,
  definirRegras,
  confirmar,
  assumir,
  salvarPix,
  marcarPago,
  liberarSala,
  darGo,
  finalizar,
  aplicarWO,
  cancelar,
};
