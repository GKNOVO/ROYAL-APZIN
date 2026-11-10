'use strict';

/** Utilidades: ajuda, painel geral, suporte, status, integrações e regras de plataforma. */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const config = require('../config');
const { obterConfig, definirConfig } = require('../db');
const filas = require('../servicos/filas');
const partidas = require('../servicos/partidas');
const paineis = require('../servicos/paineis');
const fluxo = require('../servicos/fluxo');
const tickets = require('../servicos/tickets');
const auditoria = require('../servicos/auditoria');
const { exigirStaff, exigirAdmin, responderPrivado, responderErro } = require('../util/seguranca');
const { embed, embedSucesso, mencao, dataBR } = require('../util/embeds');

async function abrirTicket(interaction, { db, client, motivo = 'suporte' }) {
  const guild = interaction.guild;
  const categoria = await fluxo.resolverCategoria(guild, db, 'categoria_suporte', config.CATEGORIA_SUPORTE_ID);
  const A = PermissionFlagsBits;

  const permissoes = [
    { id: guild.roles.everyone.id, deny: [A.ViewChannel] },
    {
      id: client.user.id,
      allow: [A.ViewChannel, A.SendMessages, A.EmbedLinks, A.ReadMessageHistory, A.ManageChannels],
    },
    {
      id: interaction.user.id,
      allow: [A.ViewChannel, A.SendMessages, A.ReadMessageHistory, A.AttachFiles],
    },
  ];
  for (const cargo of [config.CARGO_STAFF_ID, config.CARGO_MEDIADOR_ID, config.CARGO_ADMIN_ID]) {
    if (cargo) permissoes.push({ id: cargo, allow: [A.ViewChannel, A.SendMessages, A.ReadMessageHistory] });
  }

  const canal = await guild.channels.create({
    name: `suporte-${interaction.user.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    ...(categoria ? { parent: categoria.id } : {}),
    topic: `Ticket de ${interaction.user.tag} · ${motivo}`,
    permissionOverwrites: permissoes,
  });

  await canal.send({
    content: `${mencao(interaction.user.id)} — ticket aberto (${motivo}). A staff da ORG Royal AP já foi avisada.`,
    embeds: [
      embed(
        '🎫 Ticket aberto',
        'Explique o que aconteceu com o máximo de detalhe possível:\n' +
          '• ID da sala / print do AP\n• Nick no Free Fire\n• Horário do ocorrido\n\n' +
          'Assim que resolver, a staff fecha o ticket.',
        { rodape: 'ORG Royal AP' },
      ),
    ],
    allowedMentions: { parse: ['users'] },
  });

  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ap:fecharticket').setLabel('Fechar ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  await canal.send({ components: [botoes] });

  await auditoria.registrar(db, client, {
    guildId: guild.id,
    autorId: interaction.user.id,
    acao: 'Ticket aberto',
    detalhe: `${canal.name} · ${motivo}`,
  });

  return canal;
}

const comandos = [
  {
    data: new SlashCommandBuilder().setName('ajuda').setDescription('Explica como o bot funciona e todos os comandos'),

    async executar(interaction) {
      const paineisDisponiveis = config.MODOS.map((modo) => `\`/${modo.comando}\``).join(' · ');
      const corpo = [
        '**Como funciona um AP:**',
        '1. A staff publica o painel do modo no canal (ex: `/filasx1mobile`).',
        '2. Você escolhe a **faixa de aposta** no menu e o **tipo de gelo**.',
        '3. Quando o grupo fecha, o bot cria uma **sala privada** só com os jogadores.',
        '4. Um jogador envia a regra; todos confirmam.',
        '5. O **mediador** assume, manda o PIX, confere o pagamento e libera a sala.',
        '6. No fim, o mediador declara o vencedor (ou aplica W.O.).',
        '',
        '**Painéis de AP:**',
        paineisDisponiveis,
        '',
        '**Jogador:** `/perfil` · `/ranking` · `/apostas` · `/convites` · `/ticket`',
        '**Staff:** `/painel_mediador` · `/registrar_pix` · `/pix` · `/vencedor` · `/wo` · `/receita_mediadores` · `/analista`',
        '**Atendimento:** `/ticket` (painel temporário, 15s) · `/ticketfixo` (painel fixo, só ADM)',
        '**ADM:** `/painel` · `/anunciar` · `/logs` · `/limpar` · `/blacklist` · `/loja` · `/envio_massa` · `/boombot`',
      ].join('\n');

      return responderPrivado(interaction, {
        embeds: [embed('❓ Central de ajuda · ORG Royal AP', corpo, { cor: config.CORES.principal, rodape: 'ORG Royal AP' })],
      });
    },
  },

  {
    data: new SlashCommandBuilder().setName('painel').setDescription('Painel geral de controle da ORG'),

    async executar(interaction, { db }) {
      if (!(await exigirStaff(interaction))) return;
      const guildId = interaction.guildId;
      const emAndamento = partidas.ativas(db, guildId).length;
      const paineisPublicados = paineis.todos(db, guildId).length;
      const naFila = db.prepare('SELECT COUNT(*) AS total FROM filas WHERE guild_id = ?').get(String(guildId)).total;

      const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ap:minhasalas').setLabel('Salas ativas').setEmoji('📋').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ap:ranking').setLabel('Ranking').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ap:ajuda').setLabel('Ajuda').setEmoji('❓').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ap:central').setLabel('Central de atendimento').setEmoji('🎫').setStyle(ButtonStyle.Secondary),
      );

      return responderPrivado(interaction, {
        embeds: [
          embed('🎛️ Painel geral · ORG Royal AP', 'Controle rápido do servidor. Use os botões abaixo.', {
            cor: config.CORES.principal,
            campos: [
              { name: 'Salas em andamento', value: String(emAndamento), inline: true },
              { name: 'Jogadores na fila', value: String(naFila), inline: true },
              { name: 'Painéis publicados', value: `${paineisPublicados}/15`, inline: true },
            ],
            rodape: 'ORG Royal AP',
          }),
        ],
        components: [botoes],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('aux')
      .setDescription('Atalho reservado — o atendimento agora é pelo /ticket'),

    async executar(interaction) {
      // A abertura direta foi desativada de propósito. A função continua guardada
      // em servicos/tickets.js (abrirTicket) para quando precisar de novo.
      return responderPrivado(interaction, {
        content: 'Use o comando `/ticket` para abrir a Central de Atendimento.',
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Abre a Central de Atendimento (painel temporário, só você vê)'),

    async executar(interaction) {
      await responderPrivado(interaction, {
        embeds: [tickets.embedCentral()],
        components: tickets.componentesCentral(),
      });

      // O painel se apaga sozinho em 15 segundos para não poluir o canal.
      const expira = setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, 15000);
      if (typeof expira.unref === 'function') expira.unref();
      interaction.__expiraTicket = expira;
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('ticketfixo')
      .setDescription('Publica a Central de Atendimento permanente no canal (só ADM)'),

    async executar(interaction) {
      if (!(await exigirAdmin(interaction, 'Só ADM/Gerente pode publicar a Central de Atendimento fixa.'))) return;

      const canal = interaction.channel;
      if (!canal?.isTextBased?.()) {
        return responderErro(interaction, 'Use esse comando em um canal de texto.');
      }

      const mensagem = await canal.send({
        embeds: [tickets.embedCentral()],
        components: tickets.componentesCentral(),
      });
      if (typeof mensagem.pin === 'function') await mensagem.pin().catch(() => {});

      return responderPrivado(interaction, {
        embeds: [embedSucesso('Central de Atendimento publicada e fixada neste canal.')],
      });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('boombot')
      .setDescription('Status e configurações do bot')
      .addSubcommand((sub) => sub.setName('status').setDescription('Mostra a saúde do bot'))
      .addSubcommand((sub) =>
        sub
          .setName('setlog')
          .setDescription('Define o canal de auditoria')
          .addChannelOption((o) => o.setName('canal').setDescription('Canal de logs').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('setcategoria')
          .setDescription('Define a categoria das salas de AP')
          .addChannelOption((o) =>
            o
              .setName('categoria')
              .setDescription('Categoria onde as salas serão criadas')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildCategory),
          ),
      ),

    async executar(interaction, { db, client }) {
      const sub = interaction.options.getSubcommand();

      if (sub === 'status') {
        const guildId = interaction.guildId;
        const contar = (tabela) =>
          db.prepare(`SELECT COUNT(*) AS total FROM ${tabela} WHERE guild_id = ?`).get(String(guildId)).total;
        const memoria = Math.round(process.memoryUsage().rss / 1024 / 1024);
        const horas = (process.uptime() / 3600).toFixed(1);

        return responderPrivado(interaction, {
          embeds: [
            embed('🤖 Status do bot', 'Tudo certo por aqui.', {
              cor: config.CORES.sucesso,
              campos: [
                { name: 'Latência', value: `${Math.round(client.ws.ping)} ms`, inline: true },
                { name: 'Online há', value: `${horas}h`, inline: true },
                { name: 'Memória', value: `${memoria} MB`, inline: true },
                { name: 'Usuários', value: String(contar('usuarios')), inline: true },
                { name: 'Partidas', value: String(contar('partidas')), inline: true },
                { name: 'Painéis', value: `${contar('paineis')}/15`, inline: true },
                { name: 'Banco', value: `\`${config.NOME_BANCO}\``, inline: true },
                { name: 'Node.js', value: process.version, inline: true },
                { name: 'Servidores', value: String(client.guilds.cache.size), inline: true },
              ],
              rodape: 'ORG Royal AP',
            }),
          ],
        });
      }

      if (!(await exigirAdmin(interaction))) return;

      if (sub === 'setlog') {
        const canal = interaction.options.getChannel('canal');
        definirConfig(db, interaction.guildId, 'canal_logs', canal.id);
        return responderPrivado(interaction, { content: `✅ Canal de logs: ${canal}.` });
      }

      const categoria = interaction.options.getChannel('categoria');
      definirConfig(db, interaction.guildId, 'categoria_filas', categoria.id);
      return responderPrivado(interaction, { content: `✅ Salas de AP serão criadas em **${categoria.name}**.` });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('conectar')
      .setDescription('Gerencia conexões/APIs externas usadas pela ORG')
      .addStringOption((opcao) => opcao.setName('nome').setDescription('Nome da integração (ex: webhook_vendas)'))
      .addStringOption((opcao) => opcao.setName('url').setDescription('URL ou token da integração')),

    async executar(interaction, { db }) {
      if (!(await exigirAdmin(interaction))) return;
      const nome = interaction.options.getString('nome');
      const url = interaction.options.getString('url');

      if (!nome) {
        const linhas = db
          .prepare("SELECT chave, valor FROM configuracoes WHERE guild_id = ? AND chave LIKE 'integracao:%'")
          .all(interaction.guildId);
        const corpo = linhas.length
          ? linhas
              .map((linha) => `• **${linha.chave.replace('integracao:', '')}** → \`${linha.valor ? 'configurada' : 'vazia'}\``)
              .join('\n')
          : 'Nenhuma integração cadastrada.\nUse `/conectar nome:webhook_vendas url:https://...`.';
        return responderPrivado(interaction, { embeds: [embed('🔌 Integrações', corpo)] });
      }

      if (!url) {
        return responderPrivado(interaction, {
          content: `**${nome}**: \`${obterConfig(db, interaction.guildId, `integracao:${nome}`, 'não configurada')}\``,
        });
      }

      definirConfig(db, interaction.guildId, `integracao:${nome}`, url);
      return responderPrivado(interaction, { embeds: [embedSucesso(`Integração **${nome}** salva.`)] });
    },
  },

  {
    data: new SlashCommandBuilder()
      .setName('desconectar')
      .setDescription('Remove uma integração/API cadastrada')
      .addStringOption((opcao) => opcao.setName('nome').setDescription('Nome da integração').setRequired(true)),

    async executar(interaction, { db }) {
      if (!(await exigirAdmin(interaction))) return;
      const nome = interaction.options.getString('nome');
      const info = db
        .prepare('DELETE FROM configuracoes WHERE guild_id = ? AND chave = ?')
        .run(interaction.guildId, `integracao:${nome}`);
      return responderPrivado(interaction, {
        content: info.changes ? `🔌 Integração **${nome}** removida.` : `Não achei a integração **${nome}**.`,
      });
    },
  },

  {
    data: new SlashCommandBuilder().setName('ssmob').setDescription('Regras e checklist de mobile (anti-trapaça)'),

    async executar(interaction) {
      return responderPrivado(interaction, {
        embeds: [
          embed(
            '📱 Verificação · Mobile',
            [
              '**Obrigatório no AP mobile:**',
              '• Jogar no celular, sem emulador ou controle externo.',
              '• Gravar a tela do AP inteiro quando o mediador pedir.',
              '• Print do placar final enviado na sala do AP.',
              '• Estar no mesmo servidor/região combinada (Brasil).',
              '',
              '_Suspeita de emulador = W.O. imediato, com print anexado no ticket._',
            ].join('\n'),
            { cor: config.CORES.gelo, rodape: 'ORG Royal AP' },
          ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder().setName('ssemu').setDescription('Regras e checklist de emulador'),

    async executar(interaction) {
      return responderPrivado(interaction, {
        embeds: [
          embed(
            '🖥️ Verificação · Emulador',
            [
              '**Obrigatório no AP emu:**',
              '• Emulador permitido: apenas os liberados pela ORG (BlueStacks 5 / LDPlayer 9).',
              '• Print da configuração do emulador (CPU, RAM, resolução) antes da sala.',
              '• Gravação de tela do AP inteiro, sem cortes.',
              '• Teclas mapeadas devem aparecer na gravação.',
              '',
              '_Macro, script ou tecla automática = banimento da ORG._',
            ].join('\n'),
            { cor: config.CORES.principal, rodape: 'ORG Royal AP' },
          ),
        ],
      });
    },
  },

  {
    data: new SlashCommandBuilder().setName('temu').setDescription('Ferramentas rápidas para jogadores de emulador'),

    async executar(interaction) {
      const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ap:aux').setLabel('Falar com a staff').setEmoji('🎫').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ap:como').setLabel('Como funciona o AP').setEmoji('❓').setStyle(ButtonStyle.Secondary),
      );
      return responderPrivado(interaction, {
        embeds: [
          embed(
            '🧰 Ferramentas · Emulador',
            [
              '**Antes de entrar na fila emu:**',
              '1. Teste o ping: `Configurações → Rede → Ping` no emulador.',
              '2. Resolução recomendada: 1280x720 (60 FPS).',
              '3. Feche macros/scripts e reinicie o emulador.',
              '4. Deixe a gravação pronta antes do AP começar.',
              '',
              '**Travou no meio do AP?** Abra um ticket imediatamente com print — sem print, vale W.O.',
            ].join('\n'),
            { cor: config.CORES.neutro, rodape: 'ORG Royal AP' },
          ),
        ],
        components: [botoes],
      });
    },
  },
];

module.exports = { comandos, abrirTicket };
