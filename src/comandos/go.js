'use strict';

/**
 * /go — cada jogador confirma, no canal privado da partida, que já está
 * DENTRO da sala do Free Fire. No segundo GO o bot avisa os 3 segundos e a
 * partida passa para EM_ANDAMENTO.
 */

const { SlashCommandBuilder } = require('discord.js');
const config = require('../config');
const partidas = require('../servicos/partidas');
const fluxo = require('../servicos/fluxo');
const nix = require('../servicos/nix');
const auditoria = require('../servicos/auditoria');
const { responder, responderErro } = require('../util/seguranca');
const { embed, embedSucesso, mencao } = require('../util/embeds');

/** Mensagem pública no canal da partida (nunca quebra o comando se falhar). */
async function anunciar(canal, conteudo, mencoes = []) {
  if (!canal?.send) return null;
  try {
    return await canal.send({ content: conteudo, allowedMentions: { users: mencoes.map(String) } });
  } catch (erro) {
    console.error('[go] não consegui anunciar na sala:', erro.message);
    return null;
  }
}

const comandos = [
  {
    data: new SlashCommandBuilder()
      .setName('go')
      .setDescription('Confirma no canal da partida que você já está na sala do Free Fire'),

    async executar(interaction, { db, client }) {
      if (!interaction.guild) {
        return responderErro(interaction, 'Use o /go dentro do servidor da ORG.');
      }

      // 1) canal privado da partida; 2) senão, procura a partida ativa do
      // próprio jogador — assim o /go também funciona no canal da fila.
      let partida = partidas.porCanal(db, interaction.guildId, interaction.channelId);
      if (!partida || String(partida.canal_id) !== String(interaction.channelId)) {
        const minhas = partidas.ativasDoJogador(db, interaction.guildId, interaction.user.id);
        if (minhas.length === 1) {
          [partida] = minhas;
        } else if (minhas.length > 1) {
          return responderErro(
            interaction,
            'Você está em mais de uma partida ativa. Use `/go` no canal da partida desejada:\n' +
              minhas.map((linha) => `• <#${linha.canal_id}>`).join('\n'),
          );
        } else {
          return responderErro(
            interaction,
            'Você não tem partida ativa esperando GO. Entre na fila e aguarde a sala ser liberada pelo mediador.',
          );
        }
      }

      let resultado;
      try {
        resultado = partidas.darGo(db, { partidaId: partida.id, userId: interaction.user.id });
      } catch (erro) {
        return responderErro(interaction, erro.message);
      }

      // O anúncio vai SEMPRE para o canal privado da partida — mesmo que o
      // jogador tenha digitado /go no canal público da fila.
      const canal =
        String(partida.canal_id) === String(interaction.channelId)
          ? interaction.channel
          : client?.channels?.cache?.get?.(partida.canal_id) ||
            (await client?.channels?.fetch?.(partida.canal_id).catch?.(() => null));

      await anunciar(
        canal,
        `🎮 O jogador ${mencao(interaction.user.id)} deu GO na sala!  \`${resultado.deram}/${resultado.total}\``,
        [interaction.user.id],
      );

      if (resultado.iniciou) {
        await anunciar(canal, 'Os dois jogadores estão prontos! A partida irá iniciar em 3 segundos.');
        const contagem = await anunciar(canal, '⏳ **3...**');

        // Inicia a sala do Free Fire NA HORA (sem esperar o delay de 10 min).
        // Best-effort: se a Nix não responder, o anúncio e a partida continuam.
        const sessao = resultado.partida?.nix_sessao || partida.nix_sessao;
        if (sessao && nix.configurado()) {
          try {
            await nix.iniciarSala(sessao);
            console.log(`[go] sala ${partida.id} iniciada na Nix (sessão ${sessao}).`);
          } catch (erro) {
            console.error(`[go] a Nix não iniciou a sala ${partida.id}:`, erro.message);
          }
        }

        const relogio = setTimeout(async () => {
          try {
            await contagem?.edit?.('🏁 **Partida iniciada!** Boa sorte aos dois times.');
            await fluxo.atualizarPartida(client, db, partida.id);
          } catch (erro) {
            console.error('[go] contagem:', erro.message);
          }
        }, 3000);
        if (typeof relogio.unref === 'function') relogio.unref();

        await auditoria.registrar(db, client, {
          guildId: interaction.guildId,
          autorId: interaction.user.id,
          acao: 'Partida iniciada (GO)',
          detalhe: `Sala ${partida.id} · ${resultado.total} jogadores`,
        });

        return responder(interaction, {
          embeds: [embedSucesso('Os dois jogadores estão prontos! A partida irá iniciar em 3 segundos. ⏳')],
        });
      }

      const faltam = Math.max(0, resultado.total - resultado.deram);
      return responder(interaction, {
        embeds: [
          embed(
            resultado.jaDeu ? '👍 GO já registrado' : '✅ GO registrado',
            resultado.jaDeu
              ? 'Seu GO já estava confirmado. Aguardando o resto dos jogadores.'
              : `Agora falta${faltam === 1 ? '' : 'm'} **${faltam}** jogador${faltam === 1 ? '' : 'es'} dar \`/go\`.\n` +
                'Entrem na sala do Free Fire e aguardem o aviso dos 3 segundos.',
            { cor: config.CORES.sucesso, rodape: `Sala ${partida.id} · ORG Royal AP` },
          ),
        ],
      });
    },
  },
];

module.exports = { comandos };
