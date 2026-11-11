'use strict';

/**
 * Central de Atendimento: painel com 5 setores, criação de canal privado e
 * boas-vindas personalizadas. Usado por /ticket, /ticketfixo e pelos botões.
 *
 * ONDE O TICKET NASCE (flexível de propósito — não trava se você errar o tipo):
 * a variável de destino aceita ID de CANAL DE TEXTO (recomendado) **ou** de
 * CATEGORIA (compatibilidade).
 *
 *   ID de canal     → o canal do ticket é criado FORA de categoria, posicionado
 *                     logo ABAIXO desse canal de referência. Nada é enviado no
 *                     chat: o jogador só vê a resposta efêmera dele.
 *   ID de categoria → (compatibilidade) o canal do ticket é criado dentro dela.
 *
 * Ordem de busca (a primeira que existir vence):
 *   TICKET_CANAL_ID → canal_ticket/destino_tickets (banco) → TICKET_DESTINO_ID →
 *   CATEGORY_TICKETS_ID → TICKET_CATEGORIA_ID → categoria_tickets (banco) →
 *   CATEGORIA_SUPORTE_ID → categoria_suporte (banco).
 *
 * Sem nada configurado o ticket nasce na raiz do servidor (sem categoria) —
 * nunca em categoria "aleatória".
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { obterConfig } = require('../db');
const auditoria = require('./auditoria');
const { embed, mencao, mencaoCargo } = require('../util/embeds');

const TIPOS = {
  suporte: {
    id: 'suporte',
    emoji: '🚩',
    nome: 'Suporte',
    resumo: 'Problemas com AP, mediador, sala ou jogador.',
    boasVindas: [
      '**Seu ticket de SUPORTE foi aberto.**',
      '',
      'Mande aqui, de preferência de uma vez:',
      '• Seu **nick** e **ID** do Free Fire',
      '• Print ou link da **sala do AP**',
      '• O que aconteceu e o horário aproximado',
      '',
      'A staff da ORG Royal AP responde assim que possível. Não abra outro ticket para o mesmo assunto.',
    ],
  },
  reembolso: {
    id: 'reembolso',
    emoji: '💰',
    nome: 'Reembolso',
    resumo: 'Pagou e a partida não aconteceu.',
    boasVindas: [
      '**Seu ticket de REEMBOLSO foi aberto.**',
      '',
      'Envie:',
      '• **Comprovante do PIX** (print com valor, data e chave)',
      '• **Nick** e **ID** do Free Fire',
      '• **ID da sala** do AP ou link da mensagem',
      '• Quem era o mediador',
      '',
      'Só analisamos reembolso com comprovante. A decisão final é da administração da ORG.',
    ],
  },
  evento: {
    id: 'evento',
    emoji: '🎁',
    nome: 'Resgatar Evento',
    resumo: 'Prêmios, giros e eventos da ORG.',
    boasVindas: [
      '**Seu ticket de RESGATE DE EVENTO foi aberto.**',
      '',
      'Envie:',
      '• **Nick** e **ID** do Free Fire',
      '• **Print do resultado** do evento (sorteio, giro, premiação)',
      '• O nome do evento e a data',
      '',
      'A staff confere o print e libera o prêmio pelo próprio bot.',
    ],
  },
  vagas: {
    id: 'vagas',
    emoji: '💼',
    nome: 'Vagas',
    resumo: 'Recrutamento para a equipe da ORG.',
    boasVindas: [
      '**Recrutamento — ORG Royal AP**',
      '',
      'Responda nesta conversa com:',
      '• **Nick** no Free Fire',
      '• **ID** do Free Fire',
      '• **Idade**',
      '• **Taxa de atividade** (quantas horas por dia você joga)',
      '• Se já foi staff/mediador em outra ORG (opcional)',
      '',
      '**Regras do recrutamento:**',
      '• Ser ativo todos os dias e responder a staff.',
      '• Nunca passar PIX fora da sala do AP.',
      '• Tratar jogador com respeito, mesmo em discussão.',
      '',
      'A staff vai analisar e chamar aqui mesmo. Não mande DM para os ADMs.',
    ],
  },
  divulgacao: {
    id: 'divulgacao',
    emoji: '📣',
    nome: 'Divulgação',
    resumo: 'Parcerias e divulgação de servidores.',
    boasVindas: [
      '**Seu ticket de DIVULGAÇÃO / PARCERIA foi aberto.**',
      '',
      'Envie:',
      '• Nome e link do seu servidor ou projeto',
      '• Quantidade de membros',
      '• O que você propõe para a ORG Royal AP (parceria, permuta, divulgação paga)',
      '',
      'Divulgação sem autorização da staff é proibida nos canais da ORG.',
    ],
  },
};

const ORDEM = ['suporte', 'reembolso', 'evento', 'vagas', 'divulgacao'];

function embedCentral() {
  return embed(
    '🎫 CENTRAL DE ATENDIMENTO — ORG ROYAL AP',
    [
      'Escolha o setor pelo botão abaixo. O bot abre uma **sala privada** com você e a staff.',
      '',
      ...ORDEM.map((id) => `${TIPOS[id].emoji} **${TIPOS[id].nome}** — ${TIPOS[id].resumo}`),
      '',
      '_Aberto por engano? A staff fecha o ticket. Não abra vários para o mesmo assunto._',
    ].join('\n'),
    {
      cor: config.CORES.principal,
      rodape: 'ORG Royal AP · atendimento',
    },
  );
}

function componentesCentral() {
  const linha = new ActionRowBuilder().addComponents(
    ...ORDEM.map((id) =>
      new ButtonBuilder()
        .setCustomId(`ap:ticket:${id}`)
        .setLabel(TIPOS[id].nome)
        .setEmoji(TIPOS[id].emoji)
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return [linha];
}

/** Canais de texto que podem receber a Central fixa. */
function ehCanalDeTexto(canal) {
  return Boolean(
    canal && (canal.type === ChannelType.GuildText || canal.type === ChannelType.GuildAnnouncement),
  );
}

async function buscarCanal(guild, id) {
  const limpo = String(id || '').trim();
  if (!limpo) return null;
  const doCache = guild?.channels?.cache?.get?.(limpo);
  if (doCache) return doCache;
  if (typeof guild?.channels?.fetch !== 'function') return null;
  return (await guild.channels.fetch(limpo).catch(() => null)) || null;
}

/** IDs candidatos, na ordem de prioridade. */
function candidatosTickets(guild, db) {
  const doBanco = (chave) => (db ? obterConfig(db, guild.id, chave, null) : null);
  return [
    // O canal de referência do .env MANDA: o ticket nasce sempre abaixo dele.
    config.TICKET_CANAL_ID,
    doBanco('canal_ticket'),
    doBanco('destino_tickets'),
    config.TICKET_DESTINO_ID,
    config.CATEGORY_TICKETS_ID,
    config.TICKET_CATEGORIA_ID,
    doBanco('categoria_tickets'),
    config.CATEGORIA_SUPORTE_ID,
    doBanco('categoria_suporte'),
  ]
    .filter((id) => id !== null && id !== undefined && String(id).trim() !== '')
    .map((id) => String(id).trim());
}

/**
 * Descobre onde criar os tickets.
 * Devolve { categoria, canal, origem }:
 *   • canal     → CANAL DE REFERÊNCIA: o ticket nasce logo ABAIXO dele
 *   • categoria → (compatibilidade) o ticket nasce dentro da categoria
 */
async function resolverDestinoTickets(guild, db) {
  for (const id of candidatosTickets(guild, db)) {
    const canal = await buscarCanal(guild, id);

    if (!canal) {
      console.warn(
        `[tickets] não achei o ID "${id}" neste servidor. Confira TICKET_DESTINO_ID/CATEGORY_TICKETS_ID no .env.`,
      );
      continue;
    }

    if (canal.type === ChannelType.GuildCategory) {
      return { categoria: canal, canal: null, origem: id };
    }

    if (ehCanalDeTexto(canal)) {
      // Canal de referência: o ticket nasce fora de categoria, logo abaixo dele.
      return { categoria: null, canal, origem: id };
    }

    console.warn(
      `[tickets] o ID "${id}" é um ${ChannelType[canal.type] || 'tipo de canal'} inválido. ` +
        'Use o ID de uma CATEGORIA ou de um CANAL DE TEXTO.',
    );
  }

  // Sem ID configurado o ticket não vai para categoria nenhuma: nasce na raiz
  // (o aviso abaixo pede para configurar TICKET_CANAL_ID).
  return { categoria: null, canal: null, origem: null };
}

/** Compatibilidade: quem só quer a categoria continua funcionando. */
async function resolverCategoriaTickets(guild, db) {
  return (await resolverDestinoTickets(guild, db)).categoria;
}

function permissoesDoTicket(guild, client, userId) {
  const A = PermissionFlagsBits;
  const permissoes = [
    { id: guild.roles.everyone.id, deny: [A.ViewChannel] },
    {
      id: client.user.id,
      allow: [A.ViewChannel, A.SendMessages, A.EmbedLinks, A.ReadMessageHistory, A.ManageChannels],
    },
    {
      id: String(userId),
      allow: [A.ViewChannel, A.SendMessages, A.ReadMessageHistory, A.AttachFiles, A.EmbedLinks],
    },
  ];
  for (const cargo of [config.CARGO_STAFF_ID, config.CARGO_MEDIADOR_ID, config.CARGO_ADMIN_ID]) {
    if (cargo) permissoes.push({ id: cargo, allow: [A.ViewChannel, A.SendMessages, A.ReadMessageHistory] });
  }
  return permissoes;
}

function linhaFechar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ap:fecharticket')
      .setLabel('Fechar ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Posiciona o canal do ticket logo ABAIXO do canal de referência.
 * Sem categoria e sem parentId: só a ordem no servidor muda.
 */
async function posicionarAbaixo(canal, referencia) {
  if (!canal || !referencia || typeof canal.setPosition !== 'function') return false;

  let base = Number(referencia.position);
  if (!Number.isFinite(base)) {
    const atual = await referencia.guild?.channels?.fetch?.(referencia.id, { force: true }).catch(() => null);
    base = Number(atual?.position);
  }
  if (!Number.isFinite(base)) base = 0;

  try {
    await canal.setPosition(base + 1);
    return true;
  } catch (erro) {
    console.warn(`[tickets] não consegui posicionar o ticket abaixo de ${referencia.name}:`, erro.message);
    return false;
  }
}

/**
 * Abre (ou reaproveita) o canal do ticket.
 * Devolve { canal, categoria, canalDestino, tipo, existente, link }.
 */
async function abrirTicket(interaction, { db, client, tipo = 'suporte' }) {
  const info = TIPOS[String(tipo)] || TIPOS.suporte;
  const guild = interaction.guild;
  const usuario = interaction.user;
  const destino = await resolverDestinoTickets(guild, db);
  const categoria = destino.categoria;

  const nome = `${info.id}-${String(usuario.username || usuario.id)}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 90);

  const existente = guild.channels.cache.find(
    (canal) => canal.name === nome && canal.type === ChannelType.GuildText,
  );
  if (existente) {
    return {
      canal: existente,
      categoria,
      canalDestino: destino.canal,
      tipo: info.id,
      existente: true,
      link: `<#${existente.id}>`,
    };
  }

  const referencia = destino.canal;
  const canal = await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    // Com canal de referência o ticket nasce fora de categoria (raiz do servidor).
    ...(categoria && !referencia ? { parent: categoria.id } : {}),
    topic: `Ticket ${info.nome} de ${usuario.tag || usuario.username} · ORG Royal AP`,
    permissionOverwrites: permissoesDoTicket(guild, client, usuario.id),
  });

  if (referencia) {
    // Nasce logo ABAIXO do canal de referência (os de baixo descem uma posição).
    await posicionarAbaixo(canal, referencia);
  } else if (categoria) {
    // Compatibilidade: mantém o ticket no fim da categoria.
    try {
      const irmaos = guild.channels.cache.filter(
        (outro) =>
          outro.id !== canal.id && outro.parentId === categoria.id && outro.type === ChannelType.GuildText,
      );
      if (typeof canal.setPosition === 'function') await canal.setPosition(irmaos.size);
    } catch (erro) {
      console.warn('[tickets] não consegui posicionar o canal:', erro.message);
    }
  } else {
    console.warn(
      '[tickets] nenhum canal/categoria de atendimento encontrado. Configure TICKET_CANAL_ID (canal de referência) no .env ou use /boombot setticket.',
    );
  }

  const cargos = [config.CARGO_ADMIN_ID, config.CARGO_STAFF_ID, config.CARGO_MEDIADOR_ID].filter(Boolean);
  const chamada = [mencao(usuario.id), ...cargos.map((id) => mencaoCargo(id))].join(' ');
  const ondeNasceu = categoria
    ? ` em **${categoria.name}**`
    : referencia
      ? ` logo abaixo de <#${referencia.id}>`
      : '';

  await canal.send({
    content: `${chamada}\n**Ticket de ${info.nome}** aberto${ondeNasceu}. A staff já foi chamada — explique o caso aqui.`,
    embeds: [
      embed(`${info.emoji} ${info.nome} — Central de Atendimento`, info.boasVindas.join('\n'), {
        cor: config.CORES.principal,
        rodape: 'ORG Royal AP · atendimento',
      }),
    ],
    components: [linhaFechar()],
    allowedMentions: { users: [String(usuario.id)], roles: cargos.map(String) },
  });

  await auditoria
    .registrar(db, client, {
      guildId: guild.id,
      autorId: usuario.id,
      acao: 'Ticket aberto',
      detalhe:
        `${canal.name} · ${info.nome}` +
        `${categoria ? ` · ${categoria.name}` : ''}` +
        `${referencia ? ` · abaixo de #${referencia.name}` : ''}`,
    })
    .catch(() => {});

  return {
    canal,
    categoria,
    canalDestino: destino.canal,
    tipo: info.id,
    existente: false,
    link: `<#${canal.id}>`,
  };
}

module.exports = {
  TIPOS,
  ORDEM,
  embedCentral,
  componentesCentral,
  ehCanalDeTexto,
  candidatosTickets,
  resolverDestinoTickets,
  resolverCategoriaTickets,
  abrirTicket,
};
