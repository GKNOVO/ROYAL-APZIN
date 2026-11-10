'use strict';

/**
 * Central de Atendimento: painel com 5 setores, criação de canal privado e
 * boas-vindas personalizadas. Usado por /ticket, /ticketfixo e pelos botões.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const fluxo = require('./fluxo');
const auditoria = require('./auditoria');
const { embed, mencao } = require('../util/embeds');

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
  return embed('🎫 CENTRAL DE ATENDIMENTO — ORG ROYAL AP', [
    'Escolha o setor pelo botão abaixo. O bot abre uma **sala privada** com você e a staff.',
    '',
    ...ORDEM.map((id) => `${TIPOS[id].emoji} **${TIPOS[id].nome}** — ${TIPOS[id].resumo}`),
    '',
    '_Aberto por engano? A staff fecha o ticket. Não abra vários para o mesmo assunto._',
  ].join('\n'), {
    cor: config.CORES.principal,
    rodape: 'ORG Royal AP · atendimento',
  });
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

/**
 * Abre (ou reaproveita) o canal do ticket.
 * Devolve { canal, tipo, existente }.
 */
async function abrirTicket(interaction, { db, client, tipo = 'suporte' }) {
  const info = TIPOS[String(tipo)] || TIPOS.suporte;
  const guild = interaction.guild;
  const categoria = await fluxo.resolverCategoria(guild, db, 'categoria_suporte', config.CATEGORIA_SUPORTE_ID);
  const nome = `${info.id}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);

  const existente = guild.channels.cache.find(
    (canal) => canal.name === nome && canal.type === ChannelType.GuildText,
  );
  if (existente) return { canal: existente, tipo: info.id, existente: true };

  const canal = await guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    ...(categoria ? { parent: categoria.id } : {}),
    topic: `Ticket ${info.nome} de ${interaction.user.tag || interaction.user.username} · ORG Royal AP`,
    permissionOverwrites: permissoesDoTicket(guild, client, interaction.user.id),
  });

  await canal.send({
    content: `${mencao(interaction.user.id)} — ticket de **${info.nome}** aberto. A staff da ORG Royal AP já foi avisada.`,
    embeds: [
      embed(`${info.emoji} ${info.nome} — Central de Atendimento`, info.boasVindas.join('\n'), {
        cor: config.CORES.principal,
        rodape: 'ORG Royal AP · atendimento',
      }),
    ],
    allowedMentions: { parse: ['users'] },
  });

  await canal.send({
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ap:fecharticket')
          .setLabel('Fechar ticket')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  });

  const cargos = [config.CARGO_STAFF_ID, config.CARGO_MEDIADOR_ID, config.CARGO_ADMIN_ID]
    .filter(Boolean)
    .map((id) => `<@&${id}>`)
    .join(' ');
  if (cargos) {
    await canal
      .send({ content: `${cargos} — novo ticket de ${info.nome}.`, allowedMentions: { parse: [], roles: [] } })
      .catch(() => {});
  }

  await auditoria
    .registrar(db, client, {
      guildId: guild.id,
      autorId: interaction.user.id,
      acao: 'Ticket aberto',
      detalhe: `${canal.name} · ${info.nome}`,
    })
    .catch(() => {});

  return { canal, tipo: info.id, existente: false };
}

module.exports = { TIPOS, ORDEM, embedCentral, componentesCentral, abrirTicket };
