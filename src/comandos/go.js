'use strict';

/**
 * /go — os dois jogadores confirmam que já estão DENTRO da sala do Free Fire.
 *
 * Só funciona no canal privado da partida (aquele criado na hora em que a fila
 * fechou), e só depois que o mediador liberou o ID e a senha da sala.
 * Quando o segundo jogador dá /go, o bot anuncia os 3 segundos e coloca a
 * partida em EM_ANDAMENTO — o estado que libera o resultado no painel.
 */

const { SlashCommandBuilder } = require('discord.js');
const partidas = require('../servicos/partidas');
const fluxo = require('../servicos/fluxo');
const auditoria = require('../servicos/auditoria');
const { responder, responderErro } = require('../util/seguranca');
const { embed, mencao, embedSucesso } = require('../util/embeds');
const config = require('../config');
const logs = require('../util/logs');

/** Avisa no canal da partida (público). */
async function anunciar(canal, conteudo, mencoes = []) {
  if (!canal?.send) return null;
  try {
    return await canal.send({
      content: conteudo,
      allowedMentions: { users: mencoes.map(String) },
    });
  } catch (erro) {
    logs.registrarErro('go:anuncio', erro, { canalId: canal?.id ?? null });
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

      const partida = partidas.porCanal(db, interaction.guildId, interaction.channelId);
      if (!partida) {
        return responderErro(
          interaction,
          'Use `/go` **no canal privado da sua partida** (o canal criado quando a fila fechou).',
        );
      }
      if (String(partida.canal_id) !== String(interaction.channelId)) {
        return responderErro(interaction, 'Esse não é o canal desta partida.');
      }

      let resultado;
      try {
        resultado = partidas.darGo(db, { partidaId: partida.id, userId: interaction.user.id });
      } catch (erro) {
        return responderErro(interaction, erro.message);
      }

      const canal =
        interaction.channel ||
        client?.channels?.cache?.get?.(partida.canal_id) ||
        (await client?.channels?.fetch?.(partida.canal_id).catch?.(() => null));

      // 1) Mensagem pública exigida pela ORG: quem deu GO.
      await anunciar(
        canal,
        `🎮 O jogador ${mencao(interaction.user.id)} deu GO na sala!  \`${resultado.deram}/${resultado.total}\``,
        [interaction.user.id],
      );

      // 2) Segundo GO: aviso dos 3 segundos e início da partida.
      if (resultado.iniciou) {
        await anunciar(canal, 'Os dois jogadores estão prontos! A partida irá iniciar em 3 segundos.');
        const contagem = await anunciar(canal, '⏳ **3...**');

        const relogio = setTimeout(async () => {
          try {
            await contagem?.edit?.('🏁 **Partida iniciada!** Boa sorte aos dois times.');
            await fluxo.atualizarPartida(client, db, partida.id);
          } catch (erro) {
            logs.registrarErro('go:contagem', erro, { partidaId: partida.id });
          }
        }, 3000);
        if (typeof relogio.unref === 'function') relogio.unref();

        await auditoria.registrar(db, client, {
          guildId: interaction.guildId,
          autorId: interaction.user.id,
          autorTag: interaction.user.tag,
          canalId: interaction.channelId,
          acao: 'Partida iniciada (GO)',
          detalhe: `Sala ${partida.id} · ${partida.modo} · ${resultado.total} jogadores`,
          motivo: 'Os dois jogadores confirmaram o GO',
        });

        return responder(interaction, {
          embeds: [
            embedSucesso(
              'Os dois jogadores estão prontos! A partida irá iniciar em 3 segundos. ⏳',
            ),
          ],
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
