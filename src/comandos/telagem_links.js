'use strict';

/**
 * /telagem_links — gerencia o pool de links REAIS do Google Meet (só ADM).
 *
 * adicionar link:  → cadastra um Meet real no pool do servidor
 * remover link:    → tira um link do pool
 * listar           → mostra o pool, quem está usando e o que vem do .env
 * limpar           → limpa o pool e as reservas (as partidas podem receber novo link)
 *
 * Os links do .env (TELAGEM_LINKS) também entram no pool e não podem ser
 * removidos pelo comando — só editando a variável de ambiente.
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../config');
const telagem = require('../servicos/telagem');
const { exigirAdmin, responderPrivado, responderErro } = require('../util/seguranca');
const { embed, embedSucesso } = require('../util/embeds');

function listaEmBlocos(linhas, limite = 1024) {
  const blocos = [];
  let atual = '';
  for (const linha of linhas) {
    if ((atual + linha).length > limite) {
      blocos.push(atual);
      atual = '';
    }
    atual += (atual ? '\n' : '') + linha;
  }
  if (atual) blocos.push(atual);
  return blocos.length ? blocos : ['`nenhum link`'];
}

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('telagem_links')
      .setDescription('Gerencia o pool de links reais do Google Meet (só ADM)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand((sub) =>
        sub
          .setName('adicionar')
          .setDescription('Adiciona um link real do Meet ao pool')
          .addStringOption((opcao) =>
            opcao
              .setName('link')
              .setDescription('Ex: https://meet.google.com/abc-defg-hij')
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remover')
          .setDescription('Remove um link cadastrado pelo bot')
          .addStringOption((opcao) =>
            opcao.setName('link').setDescription('Link que será removido do pool').setRequired(true),
          ),
      )
      .addSubcommand((sub) => sub.setName('listar').setDescription('Mostra o pool e as salas em uso'))
      .addSubcommand((sub) => sub.setName('limpar').setDescription('Limpa o pool e as reservas do servidor')),

    async executar(interaction, { db }) {
      if (!(await exigirAdmin(interaction, 'Só ADM gerencia os links da telagem.'))) return;

      const sub = interaction.options.getSubcommand();

      if (sub === 'adicionar') {
        try {
          const url = telagem.adicionarLink(db, interaction.guildId, interaction.options.getString('link'));
          const total = telagem.pool(db, interaction.guildId).length;
          return responderPrivado(interaction, {
            embeds: [embedSucesso(`Link do Meet adicionado ao pool:\n${url}\n\n**Total no pool:** ${total}`)],
          });
        } catch (erro) {
          return responderErro(interaction, erro.message);
        }
      }

      if (sub === 'remover') {
        const removidos = telagem.removerLink(db, interaction.guildId, interaction.options.getString('link'));
        if (!removidos) {
          return responderErro(
            interaction,
            'Esse link não está cadastrado pelo bot. Links do `.env` (`TELAGEM_LINKS`) são removidos por lá.',
          );
        }
        return responderPrivado(interaction, { embeds: [embedSucesso('Link removido do pool.')] });
      }

      if (sub === 'limpar') {
        const resultado = telagem.limparLinks(db, interaction.guildId);
        return responderPrivado(interaction, {
          embeds: [
            embedSucesso(
              `Pool limpo.\n**Links do bot removidos:** ${resultado.removidos}\n**Reservas liberadas:** ${resultado.atribuicoes}` +
                (telagem.linksDoAmbiente().length
                  ? `\n_Os ${telagem.linksDoAmbiente().length} link(s) do \`TELAGEM_LINKS\` continuam valendo._`
                  : ''),
            ),
          ],
        });
      }

      // listar
      const doEnv = telagem.linksDoAmbiente();
      const pool = telagem.pool(db, interaction.guildId);
      const reservas = telagem.atribuicoes(db, interaction.guildId);
      const livres = pool.filter((url) => !reservas.some((linha) => linha.url === url));

      const campos = [
        {
          name: `Pool (${pool.length})`,
          value: listaEmBlocos(pool.map((url) => `• ${url}`)).join('\n'),
        },
        {
          name: `Em uso (${reservas.length})`,
          value: reservas.length
            ? reservas
                .slice(0, 15)
                .map((linha) => `• ${linha.chave} → ${linha.url}`)
                .join('\n')
            : '`nenhuma sala usando link agora`',
        },
        { name: 'Livres', value: String(livres.length), inline: true },
        { name: 'Do .env', value: String(doEnv.length), inline: true },
        { name: 'Provedor padrão', value: telagem.nomeProvedor(), inline: true },
      ];

      return responderPrivado(interaction, {
        embeds: [
          embed('🔗 Links da telagem · Google Meet', 'Gerencie os links reais usados pelo `/criar_telagem`.', {
            cor: config.CORES.principal,
            campos,
            rodape: 'ORG Royal AP · telagem',
          }),
        ],
      });
    },
  },
];

module.exports = { comandos };
