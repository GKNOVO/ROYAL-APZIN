'use strict';

/**
 * Esquema do banco (SQLite).
 * Tudo em português para quem for dar manutenção entender rápido.
 */

const ESQUEMA = [
  // Perfil de cada jogador dentro de cada servidor
  `CREATE TABLE IF NOT EXISTS usuarios (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0,
    giros INTEGER NOT NULL DEFAULT 0,
    vitorias INTEGER NOT NULL DEFAULT 0,
    derrotas INTEGER NOT NULL DEFAULT 0,
    wos INTEGER NOT NULL DEFAULT 0,
    apostado INTEGER NOT NULL DEFAULT 0,
    ganho INTEGER NOT NULL DEFAULT 0,
    criado_em INTEGER NOT NULL,
    atualizado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`,

  // Staff/mediador + chave PIX
  `CREATE TABLE IF NOT EXISTS staff (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pix_chave TEXT,
    pix_titular TEXT,
    comissao REAL NOT NULL DEFAULT 0.05,
    ativo INTEGER NOT NULL DEFAULT 1,
    registrado_em INTEGER,
    atualizado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`,

  // Painel publicado em cada canal (1 painel por modo)
  `CREATE TABLE IF NOT EXISTS paineis (
    guild_id TEXT NOT NULL,
    modo TEXT NOT NULL,
    canal_id TEXT NOT NULL,
    mensagem_id TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, modo)
  )`,

  // Mensagens de cada fila publicada (uma por faixa de preço)
  `CREATE TABLE IF NOT EXISTS mensagens_painel (
    guild_id TEXT NOT NULL,
    modo TEXT NOT NULL,
    preco INTEGER NOT NULL,
    canal_id TEXT NOT NULL,
    mensagem_id TEXT NOT NULL,
    atualizado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, modo, preco)
  )`,

  // Fila: uma linha por jogador esperando em (modo, preço, gelo)
  `CREATE TABLE IF NOT EXISTS filas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    modo TEXT NOT NULL,
    preco INTEGER NOT NULL,
    gelo TEXT NOT NULL,
    user_id TEXT NOT NULL,
    entrou_em INTEGER NOT NULL,
    UNIQUE (guild_id, modo, preco, gelo, user_id)
  )`,

  // Partidas (cada AP fechado)
  `CREATE TABLE IF NOT EXISTS partidas (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    modo TEXT NOT NULL,
    preco INTEGER NOT NULL,
    gelo TEXT NOT NULL,
    canal_id TEXT NOT NULL,
    mensagem_id TEXT,
    status TEXT NOT NULL,
    regras TEXT,
    regras_por TEXT,
    mediador_id TEXT,
    pix_chave TEXT,
    pix_titular TEXT,
    sala_id TEXT,
    sala_senha TEXT,
    vencedor_time INTEGER,
    motivo_fim TEXT,
    comissao REAL NOT NULL DEFAULT 0,
    criado_em INTEGER NOT NULL,
    pago_em INTEGER,
    liberada_em INTEGER,
    finalizada_em INTEGER
  )`,

  // Jogadores de cada partida (time 1 ou 2)
  `CREATE TABLE IF NOT EXISTS partida_jogadores (
    partida_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    time INTEGER NOT NULL,
    confirmou INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (partida_id, user_id),
    FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE
  )`,

  // Extrato de moedas da loja
  `CREATE TABLE IF NOT EXISTS transacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    valor INTEGER NOT NULL,
    motivo TEXT,
    autor_id TEXT,
    criado_em INTEGER NOT NULL
  )`,

  // Lista negra
  `CREATE TABLE IF NOT EXISTS blacklist (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    motivo TEXT NOT NULL,
    autor_id TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`,

  // Auditoria de tudo que a staff faz
  `CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT,
    autor_id TEXT,
    acao TEXT NOT NULL,
    detalhe TEXT,
    criado_em INTEGER NOT NULL
  )`,

  // Configurações por servidor (canal de log, categoria etc.)
  `CREATE TABLE IF NOT EXISTS configuracoes (
    guild_id TEXT NOT NULL,
    chave TEXT NOT NULL,
    valor TEXT,
    PRIMARY KEY (guild_id, chave)
  )`,

  // Controle de convites
  `CREATE TABLE IF NOT EXISTS convites (
    guild_id TEXT NOT NULL,
    convidador_id TEXT NOT NULL,
    convidado_id TEXT NOT NULL,
    codigo TEXT,
    criado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, convidado_id)
  )`,

  // Bate-ponto dos mediadores (quem está online para pegar partida)
  `CREATE TABLE IF NOT EXISTS plantao (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    entrou_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  )`,

  // Cópia das DMs enviadas pelo bot (auditoria)
  `CREATE TABLE IF NOT EXISTS logs_dm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    autor_id TEXT NOT NULL,
    mensagem TEXT NOT NULL,
    criado_em INTEGER NOT NULL
  )`,

  // Pool de links REAIS do Google Meet (cadastrados por /telagem_links)
  `CREATE TABLE IF NOT EXISTS telagem_links (
    guild_id TEXT NOT NULL,
    url TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, url)
  )`,

  // Reserva do link de cada partida/canal (nunca repete entre salas ativas)
  `CREATE TABLE IF NOT EXISTS telagens (
    guild_id TEXT NOT NULL,
    chave TEXT NOT NULL,
    codigo TEXT,
    url TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    PRIMARY KEY (guild_id, chave)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_filas_grupo ON filas (guild_id, modo, preco, gelo, entrou_em)`,
  `CREATE INDEX IF NOT EXISTS idx_telagens_url ON telagens (guild_id, url)`,
  `CREATE INDEX IF NOT EXISTS idx_partidas_canal ON partidas (guild_id, canal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_partidas_status ON partidas (guild_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_transacoes_user ON transacoes (guild_id, user_id, criado_em)`,
];

module.exports = { ESQUEMA };
