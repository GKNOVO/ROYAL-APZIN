'use strict';

/**
 * Comandos da integração Nix FF (salas automáticas de Free Fire).
 *
 * /nix status                 → saldo, plano e assinatura da chave
 * /nix jogador uid:           → perfil público de um UID (não gasta crédito)
 * /nix criarsala senha: ...   → cria a sala no jogo (staff/mediador)
 * /nix iniciar sessao:        → dá start na sala
 * /nix statussala sessao:     → estado da sessão + jogadores
 * /nix chutar sessao: uid:    → expulsa um jogador
 * /nix liberar sessao:        → encerra a sessão sem start
 * /nix resultado sessao:      → resultado/vencedor da partida
 */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const nix = require('../servicos/nix');
const mediadores = require('../servicos/mediadores');
const { exigirStaff, responderPrivado, responderErro } = require('../util/seguranca');
const { embed, embedSucesso, dataBR } = require('../util/embeds');

const COR = config.CORES.gelo;

/**
 * Automação de salas exige um dos CARGOS configurados no painel de mediadores
 * (Mediador/ADM) — sem cargo, resposta efêmera de bloqueio.
 */
async function exigirCargoMediador(interaction, db) {
  if (mediadores.podeUsarSalas(db, interaction.guildId, interaction.member)) return true;
  await responderErro(interaction, mediadores.AVISO_CARGO);
  return false;
}

function textoErro(erro) {
  if (erro instanceof nix.ErroNix) return erro.message;
  return String(erro?.message || 'Deu um erro aqui ao falar com a API da Nix.').slice(0, 900);
}

function nomePlano(tipo) {
  const mapa = { credit: 'crédito avulso', subscription: 'assinatura', hybrid: 'assinatura + crédito' };
  return mapa[String(tipo || '').toLowerCase()] || tipo || 'não informado';
}

function dinheiro(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2).replace('.', ',') : '0,00';
}

/** Embed com o resumo de uma sala criada. */
function embedSala(dados, extra = []) {
  const campos = [
    { name: 'ID da sala', value: dados.room_id ? `\`${dados.room_id}\`` : '`—`', inline: true },
    { name: 'Senha', value: dados.password ? `\`${dados.password}\`` : '`—`', inline: true },
    { name: 'Região', value: dados.region || 'BR', inline: true },
    { name: 'Sessão (use nos outros comandos)', value: dados.session_id ? `\`${dados.session_id}\`` : '`—`' },
  ];
  if (dados.status) campos.push({ name: 'Status', value: String(dados.status), inline: true });
  if (dados.expires_at) campos.push({ name: 'Expira em', value: dataBR(Date.parse(dados.expires_at)), inline: true });
  campos.push(...extra);

  const descricao = dados.invite_link
    ? `**Link de convite:** [entrar na sala](${dados.invite_link})\nMande esse link para os jogadores entrarem.`
    : 'Sala criada. Use `/nix statussala` para ver quem entrou.';

  return embed('🎮 Sala Nix criada', descricao, { cor: COR, campos, rodape: 'Nix FF · salas automáticas' });
}

async function executarStatus(interaction) {
  if (!(await exigirStaff(interaction, 'Só a staff pode ver o saldo da API da Nix.'))) return;

  const dados = await nix.saldo();
  const assinatura = dados.subscription || {};
  const credito = dados.credit || {};
  const validade = assinatura.expires_at ? dataBR(Date.parse(assinatura.expires_at)) : null;

  return responderPrivado(interaction, {
    embeds: [
      embed('💳 Nix FF · saldo da API', 'Chave carregada do `.env` e funcionando.', {
        cor: COR,
        campos: [
          { name: 'Plano', value: nomePlano(dados.plan_type), inline: true },
          { name: 'Assinatura', value: assinatura.active ? `ativa${validade ? ` até ${validade}` : ''}` : 'inativa', inline: true },
          { name: 'Crédito', value: dinheiro(credito.balance), inline: true },
          { name: 'Já gasto', value: dinheiro(credito.total_spent), inline: true },
          { name: 'Já comprado', value: dinheiro(credito.total_purchased), inline: true },
        ],
        rodape: 'nixff.vip',
      }),
    ],
  });
}

async function executarJogador(interaction) {
  const uid = interaction.options.getString('uid');
  const regiao = interaction.options.getString('regiao') || 'BR';

  const dados = await nix.jogador(uid, regiao);
  const pet = dados.pet || {};
  const habilidades = Array.isArray(dados.skills) ? dados.skills.length : 0;

  return responderPrivado(interaction, {
    embeds: [
      embed(`🔎 Perfil Free Fire · ${dados.nickname || uid}`, `**UID:** \`${dados.uid || uid}\` · **Região:** ${dados.region || regiao}`, {
        cor: COR,
        campos: [
          { name: 'Nick', value: dados.nickname || '—', inline: true },
          { name: 'Nível', value: String(dados.level ?? '—'), inline: true },
          { name: 'Likes', value: String(dados.likes ?? '—'), inline: true },
          { name: 'Poder de habilidade', value: `${habilidades} skill(s)`, inline: true },
          { name: 'Pet', value: pet?.id ? `ID \`${pet.id}\` · nível ${pet.level ?? '—'}` : 'sem pet', inline: true },
          { name: 'Personagem', value: dados.character ? `\`${dados.character}\`` : '—', inline: true },
        ],
        rodape: 'Nix FF · consulta pública (não gasta crédito)',
      }),
    ],
  });
}

async function executarCriarSala(interaction, db) {
  if (!(await exigirCargoMediador(interaction, db))) return;

  const dados = await nix.criarSala({
    senha: interaction.options.getString('senha'),
    delayMinutos: interaction.options.getInteger('tempo') ?? 10,
    modo: interaction.options.getString('modo') || 'ap_padrao',
    nome: interaction.options.getString('nome'),
    mapa: interaction.options.getString('mapa'),
    ouro1500: Boolean(interaction.options.getBoolean('ouro1500')),
    carregamento: Boolean(interaction.options.getBoolean('carregamento')),
  });

  const extra = [];
  const aviso = interaction.options.getString('avisar');
  if (aviso === 'canal' && interaction.channel?.isTextBased?.()) {
    await interaction.channel
      .send({
        content:
          `🎮 **Sala criada automaticamente**\n` +
          `**ID:** \`${dados.room_id}\` · **Senha:** \`${dados.password}\`\n` +
          (dados.invite_link ? `**Link:** ${dados.invite_link}\n` : '') +
          `_Entrem e aguardem o mediador dar start._`,
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    extra.push({ name: 'Aviso', value: `Sala divulgada em <#${interaction.channel.id}>.` });
  }

  return responderPrivado(interaction, { embeds: [embedSala(dados, extra)] });
}

async function executarIniciar(interaction, db) {
  if (!(await exigirCargoMediador(interaction, db))) return;

  const sessao = interaction.options.getString('sessao');
  const dados = await nix.iniciarSala(sessao);
  return responderPrivado(interaction, {
    embeds: [
      embedSucesso(
        `Start enviado! 🎮\n**Sala:** \`${dados.room_id}\` · **Status:** ${dados.status || 'started'}\n` +
          '_A sessão continua consultável por cerca de 1 minuto. Para o resultado, use `/nix resultado`._',
      ),
    ],
  });
}

async function executarStatusSala(interaction, db) {
  if (!(await exigirCargoMediador(interaction, db))) return;

  const sessao = interaction.options.getString('sessao');
  const dados = await nix.sessao(sessao);
  const membros = await nix.membros(sessao).catch(() => null);
  const lista = Array.isArray(membros?.members) ? membros.members : [];

  const linhas = lista.length
    ? lista
        .slice(0, 15)
        .map(
          (membro) =>
            `• \`${membro.player_uid}\` **${membro.nickname}** · time ${membro.team ?? '—'} · ${membro.platform || '—'}`,
        )
        .join('\n')
    : '`ninguém entrou ainda`';

  return responderPrivado(interaction, {
    embeds: [
      embed(
        `🎮 Sala ${dados.room_id || ''} · ${dados.status || 'sem status'}`,
        [
          `**Senha:** \`${dados.password || '—'}\` · **Região:** ${dados.region || 'BR'}`,
          dados.expires_at ? `**Expira em:** ${dataBR(Date.parse(dados.expires_at))}` : null,
          '',
          `**Jogadores (${membros?.member_count ?? lista.length}):**`,
          linhas,
        ]
          .filter((linha) => linha !== null)
          .join('\n'),
        { cor: COR, rodape: `Sessão ${dados.session_id || sessao}` },
      ),
    ],
  });
}

async function executarChutar(interaction, db) {
  if (!(await exigirCargoMediador(interaction, db))) return;

  const dados = await nix.chutarJogador(interaction.options.getString('sessao'), interaction.options.getString('uid'));
  return responderPrivado(interaction, {
    embeds: [embedSucesso(dados.detail || `Jogador \`${dados.player_uid}\` expulso da sala.`)],
  });
}

async function executarLiberar(interaction, db) {
  if (!(await exigirCargoMediador(interaction, db))) return;

  const dados = await nix.liberarSala(interaction.options.getString('sessao'));
  return responderPrivado(interaction, {
    embeds: [embedSucesso(`Sessão encerrada (${dados.reason || 'manual_release'}). A sala não recebeu start.`)],
  });
}

async function executarResultado(interaction, db) {
  if (!(await exigirCargoMediador(interaction, db))) return;

  const dados = await nix.resultado(interaction.options.getString('sessao'));
  const times = Array.isArray(dados.teams) ? dados.teams : [];
  const linhas = times.length
    ? times
        .map((time) => {
          const jogadores = (time.players || [])
            .map((jogador) => `${jogador.nickname || jogador.account_id}: ${jogador.kills ?? '—'} kill(s)`)
            .join(' · ');
          return `**Time ${time.team}${time.is_winner ? ' 🏆' : ''}**\n${jogadores || '`vazio`'}`;
        })
        .join('\n\n')
    : '`sem roster ainda`';

  const mvp = dados.match_mvp
    ? `${dados.match_mvp.nickname || dados.match_mvp.account_id} (${dados.match_mvp.kills ?? 0} kills)`
    : '—';

  return responderPrivado(interaction, {
    embeds: [
      embed(`📊 Resultado · ${dados.status || 'jogando'}`, linhas, {
        cor: COR,
        campos: [
          { name: 'Vencedor', value: dados.winner_team ? `Time ${dados.winner_team}` : 'em andamento', inline: true },
          { name: 'MVP', value: mvp, inline: true },
          {
            name: 'Próxima consulta',
            value: dados.poll_after_seconds ? `em ${dados.poll_after_seconds}s` : 'pode parar de consultar',
            inline: true,
          },
        ],
        rodape: `Sessão ${dados.session_id || ''}`,
      }),
    ],
  });
}

const ACOES = {
  status: executarStatus,
  jogador: executarJogador,
  criarsala: executarCriarSala,
  iniciar: executarIniciar,
  statussala: executarStatusSala,
  chutar: executarChutar,
  liberar: executarLiberar,
  resultado: executarResultado,
};

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('nix')
      .setDescription('Salas automáticas de Free Fire pela API da Nix FF (nixff.vip)')
      .addSubcommand((sub) => sub.setName('status').setDescription('Mostra saldo, plano e assinatura da API'))
      .addSubcommand((sub) =>
        sub
          .setName('jogador')
          .setDescription('Consulta o perfil público de um UID do Free Fire (não gasta crédito)')
          .addStringOption((o) => o.setName('uid').setDescription('UID do jogador (só números)').setRequired(true))
          .addStringOption((o) =>
            o
              .setName('regiao')
              .setDescription('Região do servidor (padrão BR)')
              .addChoices({ name: 'Brasil (BR)', value: 'BR' }, { name: 'Índia (IND)', value: 'IND' }),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('criarsala')
          .setDescription('Cria a sala no jogo automaticamente (staff/mediador)')
          .addStringOption((o) => o.setName('senha').setDescription('Senha da sala (1 a 16 caracteres)').setRequired(true))
          .addIntegerOption((o) =>
            o
              .setName('tempo')
              .setDescription('Minutos até o start automático (AP: 1-10 · BR: 1-20)')
              .setMinValue(1)
              .setMaxValue(20),
          )
          .addStringOption((o) =>
            o
              .setName('modo')
              .setDescription('Tipo de sala')
              .addChoices(...nix.MODOS.map((modo) => ({ name: modo.nome, value: modo.id }))),
          )
          .addStringOption((o) => o.setName('nome').setDescription('Nome da sala (opcional)'))
          .addStringOption((o) =>
            o
              .setName('mapa')
              .setDescription('Mapa (AP: Bermuda, Purgatory, Kalahari, Nextera · BR: + Nova Terra, Solara)'),
          )
          .addBooleanOption((o) => o.setName('ouro1500').setDescription('Começar o 1º round com 1500 de ouro (AP)'))
          .addBooleanOption((o) => o.setName('carregamento').setDescription('Sala nasce com carregamento ligado (AP)'))
          .addStringOption((o) =>
            o
              .setName('avisar')
              .setDescription('Divulgar ID, senha e link no canal atual?')
              .addChoices({ name: 'Sim, avisar no canal', value: 'canal' }, { name: 'Não avisar', value: 'nao' }),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('iniciar')
          .setDescription('Dá start na sala (staff/mediador)')
          .addStringOption((o) => o.setName('sessao').setDescription('session_id da sala').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('statussala')
          .setDescription('Mostra o estado da sessão e quem já entrou')
          .addStringOption((o) => o.setName('sessao').setDescription('session_id da sala').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('chutar')
          .setDescription('Expulsa um jogador da sala')
          .addStringOption((o) => o.setName('sessao').setDescription('session_id da sala').setRequired(true))
          .addStringOption((o) => o.setName('uid').setDescription('UID do jogador a expulsar').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('liberar')
          .setDescription('Encerra a sessão sem dar start')
          .addStringOption((o) => o.setName('sessao').setDescription('session_id da sala').setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('resultado')
          .setDescription('Mostra vencedor, kills e MVP da partida')
          .addStringOption((o) => o.setName('sessao').setDescription('session_id da sala').setRequired(true)),
      ),

    async executar(interaction, ctx = {}) {
      const sub = interaction.options.getSubcommand();
      const acao = ACOES[sub];
      if (!acao) return responderErro(interaction, 'Subcomando desconhecido. Use `/nix status`.');

      try {
        return await acao(interaction, ctx.db);
      } catch (erro) {
        console.error(`[nix] erro em /nix ${sub}:`, erro?.message || erro);
        return responderErro(interaction, textoErro(erro));
      }
    },
  },
];

module.exports = { comandos, embedSala, nomePlano };
