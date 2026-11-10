'use strict';

/** Cliques em botões: fila, gelo, regras, mediação, PIX, resultado e tickets. */

const config = require('../config');
const fluxo = require('../servicos/fluxo');
const partidas = require('../servicos/partidas');
const staff = require('../servicos/staff');
const filas = require('../servicos/filas');
const paineis = require('../servicos/paineis');
const tickets = require('../servicos/tickets');
const auditoria = require('../servicos/auditoria');
const { embed, embedSucesso, embedErro, reais, mencao, mencaoCargo, dataBR } = require('../util/embeds');
const {
  responderPrivado,
  responderErro,
  ehMediador,
  ehAdmin,
  ehStaff,
} = require('../util/seguranca');

const varianteNome = (modo, id) => config.varianteDoModo(modo, id)?.nome ?? String(id);

async function avisarMediadores(client, partida) {
  if (!config.CARGO_MEDIADOR_ID) return;
  try {
    const canal = client.channels.cache.get(partida.canal_id) || (await client.channels.fetch(partida.canal_id));
    if (!canal) return;
    await canal.send({
      content: `${mencaoCargo(config.CARGO_MEDIADOR_ID)} — regras confirmadas. Quem assume esta sala?`,
      allowedMentions: { parse: [], roles: [config.CARGO_MEDIADOR_ID] },
    });
  } catch (erro) {
    console.error('[botoes] não consegui avisar os mediadores:', erro.message);
  }
}

async function entrarNaFilaBotao(interaction, { db, client }, modoId, preco, gelo) {
  if (!interaction.guild) return responderErro(interaction, 'Use os painéis dentro do servidor.');
  const modo = config.modoPorId(modoId);
  if (!modo) return responderErro(interaction, 'Painel antigo. Peça para a staff publicar o painel de novo.');

  try {
    const resultado = await fluxo.entrarNaFila(client, db, {
      guild: interaction.guild,
      userId: interaction.user.id,
      modo: modo.id,
      preco: Number(preco),
      gelo,
    });

    if (resultado.fechou) {
      return responderPrivado(interaction, {
        embeds: [
          embedSucesso(
            `Grupo fechado! 🎉\nSua sala privada foi criada: <#${resultado.canalId}>\n\n` +
              'Vão lá para enviar a regra, confirmar e chamar o mediador.',
          ),
        ],
      });
    }

    return responderPrivado(interaction, {
      embeds: [
        embedSucesso(
          `Você entrou na fila!\n**Modo:** ${modo.titulo}\n**Aposta:** ${reais(Number(preco))} · ${varianteNome(modo, gelo)}\n` +
            `**Posição:** ${resultado.posicao}\n**Faltam:** ${resultado.faltam} jogador(es) para fechar.`,
        ),
      ],
    });
  } catch (erro) {
    return responderErro(interaction, erro.message);
  }
}

async function sairDaFila(interaction, { db, client }, modoId, alvo) {
  const modo = config.modoPorId(modoId);
  if (!modo) return responderErro(interaction, 'Painel inválido.');
  const preco = alvo === 'todos' ? null : Number(alvo);

  const removidas = filas.sair(db, {
    guildId: interaction.guildId,
    modo: modo.id,
    userId: interaction.user.id,
    preco,
  });
  if (!removidas) return responderErro(interaction, 'Você não está nessa fila.');
  await paineis.atualizar(client, db, { guildId: interaction.guildId, modo: modo.id });
  return responderPrivado(interaction, {
    embeds: [embedSucesso(`Você saiu da fila de **${modo.titulo}**${preco ? ` (${reais(preco)})` : ''}.`)],
  });
}

async function confirmarRegras(interaction, { db, client }, partidaId) {
  try {
    const resultado = partidas.confirmar(db, partidaId, interaction.user.id);
    await fluxo.atualizarPartida(client, db, partidaId);

    if (resultado.completo) {
      await avisarMediadores(client, resultado.partida);
      return responderPrivado(interaction, {
        embeds: [embedSucesso('Regras confirmadas por todos! ✅\nAgora o mediador vai assumir a sala.')],
      });
    }

    return responderPrivado(interaction, {
      embeds: [
        embedSucesso(
          resultado.jaConfirmou
            ? 'Você já tinha confirmado. Falta o resto do pessoal.'
            : `Confirmação registrada: **${resultado.confirmados}/${resultado.total}**.\nAguardando os outros jogadores...`,
        ),
      ],
    });
  } catch (erro) {
    return responderErro(interaction, erro.message);
  }
}

async function assumirSala(interaction, { db, client }, partidaId) {
  if (!ehMediador(interaction.member)) {
    return responderErro(interaction, 'Só mediadores/ADM podem assumir salas.');
  }
  const registro = staff.obter(db, interaction.guildId, interaction.user.id);
  if (!registro?.pix_chave) {
    return responderErro(
      interaction,
      'Cadastre sua chave PIX antes de assumir uma sala: `/registrar_pix chave:SuaChave`.',
    );
  }

  try {
    const partida = partidas.assumir(db, partidaId, interaction.user.id, registro.comissao);
    await fluxo.atualizarPartida(client, db, partidaId);
    await auditoria.registrar(db, client, {
      guildId: interaction.guildId,
      autorId: interaction.user.id,
      acao: 'Sala assumida',
      detalhe: `Sala ${partidaId} · ${reais(partida.preco)}`,
    });
    return responderPrivado(interaction, {
      embeds: [embedSucesso('Você assumiu a sala. Agora envie seu PIX e confira o pagamento.')],
    });
  } catch (erro) {
    return responderErro(interaction, erro.message);
  }
}

async function enviarPix(interaction, { db, client }, partidaId) {
  if (!ehMediador(interaction.member)) return responderErro(interaction, 'Só o mediador da sala pode enviar o PIX.');
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return responderErro(interaction, 'Sala não encontrada.');

  const registro = staff.obter(db, interaction.guildId, interaction.user.id);
  if (!registro?.pix_chave) {
    return responderErro(interaction, 'Você ainda não cadastrou PIX. Use `/registrar_pix`.');
  }
  if (partida.mediador_id && partida.mediador_id !== interaction.user.id && !ehAdmin(interaction.member)) {
    return responderErro(interaction, 'Essa sala é de outro mediador.');
  }

  await fluxo.anunciarPix(client, db, {
    partidaId,
    mediadorId: interaction.user.id,
    chave: registro.pix_chave,
    titular: registro.pix_titular,
  });

  return responderPrivado(interaction, { embeds: [embedSucesso('PIX enviado na sala. Confira os comprovantes.')] });
}

async function pagamentoRecebido(interaction, { db, client }, partidaId) {
  if (!ehMediador(interaction.member)) return responderErro(interaction, 'Só o mediador pode confirmar o pagamento.');
  try {
    partidas.marcarPago(db, partidaId);
    await fluxo.atualizarPartida(client, db, partidaId);
    await auditoria.registrar(db, client, {
      guildId: interaction.guildId,
      autorId: interaction.user.id,
      acao: 'Pagamento confirmado',
      detalhe: `Sala ${partidaId}`,
    });
    return responderPrivado(interaction, {
      embeds: [embedSucesso('Pagamento confirmado ✅\nAgora libere o ID e a senha da sala.')],
    });
  } catch (erro) {
    return responderErro(interaction, erro.message);
  }
}

async function fecharSala(interaction, { db, client }, partidaId) {
  if (!ehMediador(interaction.member)) return responderErro(interaction, 'Só a staff pode fechar a sala.');
  const partida = partidas.buscar(db, partidaId);
  await responderPrivado(interaction, { content: '🔒 Fechando esta sala em 5 segundos...' });
  setTimeout(async () => {
    try {
      const canal =
        interaction.channel ??
        client.channels.cache.get(partida?.canal_id) ??
        (await client.channels.fetch(partida?.canal_id));
      await canal?.delete('Sala de AP encerrada');
    } catch (erro) {
      console.error('[botoes] não consegui fechar a sala:', erro.message);
    }
  }, 5000);
  return true;
}

async function handleBotao(interaction, ctx) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap') return false;

  const acao = partes[1];
  const args = partes.slice(2);
  const { db, client } = ctx;

  try {
    switch (acao) {
      case 'entrar':
      case 'gelo':
        await entrarNaFilaBotao(interaction, ctx, args[0], args[1], args[2]);
        return true;

      case 'sair':
        await sairDaFila(interaction, ctx, args[0], args[1]);
        return true;

      case 'confirmar':
        await confirmarRegras(interaction, ctx, args[0]);
        return true;

      case 'assumir':
        await assumirSala(interaction, ctx, args[0]);
        return true;

      case 'pix':
        await enviarPix(interaction, ctx, args[0]);
        return true;

      case 'pago':
        await pagamentoRecebido(interaction, ctx, args[0]);
        return true;

      case 'vencer': {
        if (!ehMediador(interaction.member)) {
          await responderErro(interaction, 'Só o mediador pode declarar o vencedor.');
          return true;
        }
        const time = Number(args[1]);
        await interaction.deferReply({ flags: 64 }).catch(() => {});
        const resultado = await fluxo.encerrarPartida(client, db, {
          partidaId: args[0],
          vencedorTime: time,
          autorId: interaction.user.id,
        });
        await interaction.editReply({
          content: `🏆 **${fluxo.nomeTime(time)}** venceu o AP de ${reais(resultado.partida.preco)}. Resultado salvo!`,
        });
        return true;
      }

      case 'wo': {
        if (!ehMediador(interaction.member)) {
          await responderErro(interaction, 'Só o mediador pode aplicar W.O.');
          return true;
        }
        const ausente = Number(args[1]);
        await interaction.deferReply({ flags: 64 }).catch(() => {});
        const resultado = await fluxo.aplicarWO(client, db, {
          partidaId: args[0],
          timeAusente: ausente,
          autorId: interaction.user.id,
        });
        await interaction.editReply({
          content:
            `⚠️ W.O. aplicado.\n**${fluxo.nomeTime(ausente)}** não apareceu — vitória de ` +
            `**${fluxo.nomeTime(resultado.partida.vencedor_time)}** (${reais(resultado.partida.preco)}).`,
        });
        return true;
      }

      case 'cancelar': {
        if (!ehMediador(interaction.member)) {
          await responderErro(interaction, 'Só a staff pode cancelar um AP.');
          return true;
        }
        await fluxo.cancelarPartida(client, db, {
          partidaId: args[0],
          autorId: interaction.user.id,
          motivo: `cancelada por ${interaction.user.tag}`,
        });
        await responderPrivado(interaction, { embeds: [embedSucesso('Sala cancelada e registrada na auditoria.')] });
        return true;
      }

      case 'fechar':
        return await fecharSala(interaction, { ...ctx, db }, args[0]);

      case 'regras':
      case 'liberar': {
        // abre modal (tratado em interacoes/modais.js)
        const { abrirModalRegras, abrirModalSala } = require('./modais');
        if (acao === 'regras') await abrirModalRegras(interaction, db, args[0]);
        else await abrirModalSala(interaction, db, args[0]);
        return true;
      }

      case 'ranking': {
        const usuarios = require('../servicos/usuarios');
        const lista = usuarios.top(db, interaction.guildId, 'vitorias', config.LIMITES.RANKING);
        const medalhas = ['🥇', '🥈', '🥉'];
        const corpo = lista.length
          ? lista
              .map(
                (linha, indice) =>
                  `${medalhas[indice] ?? `**${indice + 1}.**`} ${mencao(linha.user_id)} — ${linha.vitorias}V / ${linha.derrotas}D`,
              )
              .join('\n')
          : 'Ranking ainda vazio. Bora fechar AP!';
        await responderPrivado(interaction, { embeds: [embed('🏆 Ranking · vitórias', corpo)] });
        return true;
      }

      case 'como':
      case 'ajuda': {
        await responderPrivado(interaction, {
          embeds: [
            embed(
              '❓ Como funciona o AP',
              '1. Escolha a faixa no menu do painel.\n' +
                '2. Escolha **Gelo Infinito** ou **Gelo Normal**.\n' +
                '3. O grupo fecha → sala privada criada automaticamente.\n' +
                '4. Um jogador envia a regra e **todos** confirmam.\n' +
                '5. O mediador assume, manda o PIX e confere o pagamento.\n' +
                '6. Sala liberada → joguem → mediador declara o vencedor.\n\n' +
                'Dúvida? Use `/ticket` para falar com a staff.',
              { rodape: 'ORG Royal AP' },
            ),
          ],
        });
        return true;
      }

      case 'central':
      case 'aux': {
        await responderPrivado(interaction, {
          embeds: [tickets.embedCentral()],
          components: tickets.componentesCentral(),
        });
        return true;
      }

      case 'ticket': {
        await interaction.deferReply({ flags: 64 }).catch(() => {});
        try {
          const aberto = await tickets.abrirTicket(interaction, { db, client, tipo: args[0] });
          await interaction.editReply({
            content: aberto.existente
              ? `🎫 Você já tem um ticket aberto: ${aberto.canal}.`
              : `🎫 Ticket aberto: ${aberto.canal}. A staff já foi avisada.`,
          });
        } catch (erro) {
          console.error('[botoes] ticket:', erro.message);
          await interaction.editReply({ content: '❌ Não consegui abrir o ticket. Chame um ADM.' });
        }
        return true;
      }

      case 'fecharticket': {
        if (!ehStaff(interaction.member)) {
          await responderErro(interaction, 'Só a staff pode fechar o ticket.');
          return true;
        }
        await responderPrivado(interaction, { content: '🔒 Fechando o ticket em 5 segundos...' });
        setTimeout(() => interaction.channel?.delete('Ticket encerrado').catch(() => {}), 5000);
        return true;
      }

      case 'minhasalas': {
        if (!ehStaff(interaction.member)) {
          await responderErro(interaction, 'Só a staff vê as salas.');
          return true;
        }
        const ativas = partidas
          .ativas(db, interaction.guildId)
          .filter((partida) => partida.status !== 'confirmando');
        const corpo = ativas.length
          ? ativas
              .map(
                (partida) =>
                  `• <#${partida.canal_id}> — ${partida.modo} · ${reais(partida.preco)} · \`${partida.status}\`\n` +
                  `┄ mediador: ${partida.mediador_id ? mencao(partida.mediador_id) : 'livre'}`,
              )
              .join('\n')
          : 'Nenhuma sala precisando de mediador agora. 🙌';
        await responderPrivado(interaction, { embeds: [embed('📋 Salas em andamento', corpo)] });
        return true;
      }

      case 'pixinfo': {
        const registro = staff.obter(db, interaction.guildId, interaction.user.id);
        const corpo = registro?.pix_chave
          ? `**Chave:** \`${registro.pix_chave}\`\n**Titular:** ${registro.pix_titular || '—'}\n` +
            `**Comissão:** ${(registro.comissao * 100).toFixed(1)}%\n**Status:** ${registro.ativo ? 'ativo' : 'inativo'}`
          : 'Você ainda não cadastrou PIX. Use `/registrar_pix chave:SuaChave`.';
        await responderPrivado(interaction, { embeds: [embed('💸 Meu PIX', corpo)] });
        return true;
      }

      default:
        return false;
    }
  } catch (erro) {
    console.error(`[botoes] erro em ${interaction.customId}:`, erro);
    await responderErro(interaction, erro.message || 'Deu um erro aqui. Tente de novo ou chame um ADM.');
    return true;
  }
}

module.exports = { handleBotao };
