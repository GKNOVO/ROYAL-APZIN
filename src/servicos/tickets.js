'use strict';

/**
 * Central de Atendimento: painel com 5 setores, criação de canal privado e
 * boas-vindas personalizadas. Usado por /ticket, /ticketfixo e pelos botões.
 *
 * ONDE O TICKET NASCE: sempre DENTRO de uma CATEGORIA.
 *
 * Ordem de busca (a primeira que existir vence):
 *   CATEGORY_TICKETS_ID → TICKET_CATEGORIA_ID → categoria_tickets (banco) →
 *   TICKET_DESTINO_ID → destino_tickets (banco) → CATEGORIA_SUPORTE_ID →
 *   categoria_suporte (banco).
 *
 * Se a variável receber um CANAL (modo antigo), o bot usa a categoria onde ele
 * está — assim nenhum ticket nasce na raiz nem em categoria "aleatória".
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const { obterConfig } = require('../db');
const auditoria = require('./auditoria');
const mediadores = require('./mediadores');
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
    // A CATEGORIA do .env MANDA: todo ticket novo nasce dentro dela.
    config.CATEGORY_TICKETS_ID,
    config.TICKET_CATEGORIA_ID,
    doBanco('categoria_tickets'),
    config.TICKET_DESTINO_ID,
    doBanco('destino_tickets'),
    config.CATEGORIA_SUPORTE_ID,
    doBanco('categoria_suporte'),
  ]
    .filter((id) => id !== null && id !== undefined && String(id).trim() !== '')
    .map((id) => String(id).trim());
}

/**
 * Descobre a CATEGORIA onde criar os tickets.
 * Devolve { categoria, origem }; categoria null = raiz do servidor.
 */
async function resolverDestinoTickets(guild, db) {
  for (const id of candidatosTickets(guild, db)) {
    const canal = await buscarCanal(guild, id);

    if (!canal) {
      console.warn(`[tickets] não achei o ID "${id}" neste servidor. Confira CATEGORY_TICKETS_ID no .env.`);
      continue;
    }

    if (canal.type === ChannelType.GuildCategory) {
      return { categoria: canal, origem: id };
    }

    // Compatibilidade: veio um canal — usa a categoria onde ele está.
    if (ehCanalDeTexto(canal) && canal.parentId) {
      const pai = await buscarCanal(guild, canal.parentId);
      if (pai?.type === ChannelType.GuildCategory) return { categoria: pai, origem: id };
    }

    console.warn(
      `[tickets] o ID "${id}" não é uma categoria (${ChannelType[canal.type] || 'tipo desconhecido'}). ` +
        'Use o ID da CATEGORIA de atendimento.',
    );
  }

  return { categoria: null, origem: null };
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
  // Ticket é atendimento: só cargos de Suporte/Auxiliar (mediadores cuidam das filas).
  for (const cargo of mediadores.cargosSuporte()) {
    permissoes.push({ id: cargo, allow: [A.ViewChannel, A.SendMessages, A.ReadMessageHistory] });
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
      tipo: info.id,
      existente: true,
      link: `<#${existente.id}>`,
    };
  }

  const canal = await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    // O ticket nasce DENTRO da categoria configurada.
    ...(categoria ? { parent: categoria.id } : {}),
    topic: `Ticket ${info.nome} de ${usuario.tag || usuario.username} · ORG Royal AP`,
    permissionOverwrites: permissoesDoTicket(guild, client, usuario.id),
  });

  if (!categoria) {
    console.warn(
      '[tickets] nenhuma categoria de atendimento configurada: o ticket foi criado na raiz. ' +
        'Defina CATEGORY_TICKETS_ID no .env ou use /boombot setticket.',
    );
  }

  // Só o atendimento (Suporte/Auxiliar) é marcado no ticket.
  const cargos = mediadores.cargosSuporte();
  const chamada = [mencao(usuario.id), ...cargos.map((id) => mencaoCargo(id))].join(' ');
  const ondeNasceu = categoria ? ` em **${categoria.name}**` : '';

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
      detalhe: `${canal.name} · ${info.nome}${categoria ? ` · ${categoria.name}` : ''}`,
    })
    .catch(() => {});

  return {
    canal,
    categoria,
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
