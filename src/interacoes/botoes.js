'use strict';

/** Cliques em botões: fila, gelo, regras, mediação, PIX, resultado e tickets. */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const fluxo = require('../servicos/fluxo');
const partidas = require('../servicos/partidas');
const staff = require('../servicos/staff');
const filas = require('../servicos/filas');
const paineis = require('../servicos/paineis');
const tickets = require('../servicos/tickets');
const plantao = require('../servicos/plantao');
const salas = require('../servicos/salas');
const mediadores = require('../servicos/mediadores');
const auditoria = require('../servicos/auditoria');
const { embed, embedSucesso, embedErro, reais, mencao, mencaoCargo, dataBR } = require('../util/embeds');
const {
  responderPrivado,
  responderErro,
  ehMediador,
  ehAdmin,
  ehStaff,
  ehSuporte,
} = require('../util/seguranca');

const varianteNome = (modo, id) => config.varianteDoModo(modo, id)?.nome ?? String(id);

/**
 * Mensagem PÚBLICA na sala: quem confirmou, quem falta e a marcação da
 * @STAFF / @MEDIADOR — exatamente o texto combinado com a ORG.
 */
async function avisarConfirmacao(client, db, { partida, userId, completo, faltando = [] }) {
  try {
    const canal =
      client?.channels?.cache?.get?.(partida.canal_id) || (await client?.channels?.fetch?.(partida.canal_id));
    if (!canal?.send) return;

    // Só mediadores e ADM são marcados nas partidas (suporte fica nos tickets).
    const cargos = mediadores.mencoes(db, partida.guild_id);
    const marcaStaff = cargos.length ? `\n${cargos.map((id) => mencaoCargo(id)).join(' ')}` : '';
    const restantes =
      faltando.length > 1
        ? `Agora faltam ${faltando.length} jogadores: ${faltando.map((id) => mencao(id)).join(', ')}.`
        : `Agora falta apenas ${mencao(faltando[0])} para confirmar.`;

    await canal.send({
      content: completo
        ? `✅ ${mencao(userId)} confirmou a partida. Todos confirmaram! Partida iniciando...${marcaStaff}`
        : `✅ ${mencao(userId)} confirmou a partida. ${restantes}${marcaStaff}`,
      allowedMentions: { users: [String(userId)], roles: cargos.map(String) },
    });
  } catch (erro) {
    console.error('[botoes] não consegui avisar a confirmação na sala:', erro.message);
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
      // Só quem está nesta faixa recebe o "Sair" — ninguém mais vê este botão.
      components: [paineis.linhaSair(modo, Number(preco))],
    });
  } catch (erro) {
    if (/já está nessa fila/i.test(String(erro.message))) {
      return responderPrivado(interaction, {
        embeds: [embedErro(erro.message)],
        components: [paineis.linhaSair(modo, Number(preco))],
      });
    }
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
  await paineis.atualizar(client, db, { guildId: interaction.guildId, modo: modo.id, preco });
  return responderPrivado(interaction, {
    embeds: [embedSucesso(`Você saiu da fila de **${modo.titulo}**${preco ? ` (${reais(preco)})` : ''}.`)],
  });
}

async function confirmarRegras(interaction, { db, client }, partidaId) {
  try {
    const resultado = partidas.confirmar(db, partidaId, interaction.user.id);
    await fluxo.atualizarPartida(client, db, partidaId);

    const faltando = partidas
      .jogadores(db, partidaId)
      .filter((linha) => linha.confirmou !== 1)
      .map((linha) => linha.user_id);
    await avisarConfirmacao(client, db, {
      partida: resultado.partida,
      userId: interaction.user.id,
      completo: resultado.completo,
      faltando,
    });

    if (resultado.completo) {
      return responderPrivado(interaction, {
        embeds: [embedSucesso('Todos confirmaram! ✅\nPartida iniciando — a staff já foi marcada na sala.')],
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
      embeds: [
        embedSucesso(
          'Pagamento confirmado ✅\nAgora clique em **Criar sala (Nix)** — o ID e a senha vão direto para o canal da fila.',
        ),
      ],
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

/** Botão "Ignorar mensagem" que acompanha o aviso efêmero do ticket. */
function linhaIgnorar() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ap:ignorarticket')
      .setLabel('Ignorar mensagem')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Secondary),
  );
}

async function handleBotao(interaction, ctx) {
  const partes = String(interaction.customId || '').split(':');
  if (partes[0] !== 'ap') return false;

  const acao = partes[1];
  const args = partes.slice(2);
  const { db, client } = ctx;

  // "regras" e "liberar" abrem modal: showModal precisa ser a PRIMEIRA resposta,
  // por isso esses dois não podem ser adiados.
  const abreModal =
    acao === 'regras' || acao === 'liberar' || acao.startsWith('bot') || acao === 'pixregistrar';

  // Confirma o clique imediatamente (deferUpdate) em todos os outros casos:
  // o Discord nunca mostra "O aplicativo não respondeu". O painel continua
  // igual e o texto do resultado vai em mensagem privada (followUp).
  if (!abreModal && !interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferUpdate();
    } catch (erro) {
      console.error(`[botoes] não consegui confirmar o clique em ${interaction.customId}:`, erro.message);
    }
  }

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
        const resultado = await fluxo.encerrarPartida(client, db, {
          partidaId: args[0],
          vencedorTime: time,
          autorId: interaction.user.id,
        });
        await responderPrivado(interaction, {
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
        const resultado = await fluxo.aplicarWO(client, db, {
          partidaId: args[0],
          timeAusente: ausente,
          autorId: interaction.user.id,
        });
        await responderPrivado(interaction, {
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

      case 'botnome':
      case 'botavatar':
      case 'botdescricao':
      case 'botstatus': {
        if (!ehAdmin(interaction.member)) {
          await responderErro(interaction, 'Só ADMs podem mudar o perfil do bot.');
          return true;
        }
        const { abrirModalBotPerfil } = require('./modais');
        await abrirModalBotPerfil(interaction, acao.replace(/^bot/, ''));
        return true;
      }

      case 'plantaoentrar': {
        // Exige um dos CARGOS configurados (Mediador/ADM). Só cai na permissão
        // de Administrador quando nenhum cargo foi configurado ainda.
        const cargosMed = mediadores.cargos(db, interaction.guildId);
        const temCargo = mediadores.temCargoMediador(db, interaction.guildId, interaction.member);
        if (!temCargo && !(cargosMed.length === 0 && ehAdmin(interaction.member))) {
          await responderErro(
            interaction,
            'Você não tem nenhum dos cargos configurados para mediação (Mediador/ADM). Fale com a administração.',
          );
          return true;
        }
        plantao.entrar(db, { guildId: interaction.guildId, userId: interaction.user.id });
        await interaction.editReply(plantao.painel(db, interaction.guildId));
        const posicao = plantao.posicao(db, { guildId: interaction.guildId, userId: interaction.user.id });
        await responderPrivado(interaction, {
          embeds: [embedSucesso(`Você está no plantão${posicao ? ` (posição ${posicao})` : ''}. Boa! ⚡`)],
        });
        return true;
      }

      case 'plantaosair': {
        const saiu = plantao.sair(db, { guildId: interaction.guildId, userId: interaction.user.id });
        await interaction.editReply(plantao.painel(db, interaction.guildId));
        await responderPrivado(interaction, {
          embeds: [embedSucesso(saiu ? 'Você saiu do plantão.' : 'Você não estava no plantão.')],
        });
        return true;
      }

      case 'plantaostatus': {
        await interaction.editReply(plantao.painel(db, interaction.guildId));
        return true;
      }

      case 'pixregistrar': {
        if (!mediadores.ehMediador(db, interaction.guildId, interaction.member)) {
          await responderErro(interaction, 'Só mediadores/ADM registram PIX de recebimento.');
          return true;
        }
        const { abrirModalPix } = require('./modais');
        await abrirModalPix(interaction);
        return true;
      }

      case 'pixverificar': {
        const registro = staff.obter(db, interaction.guildId, interaction.user.id);
        const corpo = registro?.pix_chave
          ? `**Chave PIX:** \`${registro.pix_chave}\`\n**Titular:** ${registro.pix_titular || '—'}\n` +
            `**Cidade:** ${registro.pix_cidade || '—'}\n**Comissão:** ${(registro.comissao * 100).toFixed(1)}%`
          : 'Você ainda não cadastrou PIX. Clique em **Configurar Pix**.';
        await responderPrivado(interaction, { embeds: [embed('💠 Seu cadastro PIX', corpo)] });
        return true;
      }

      case 'criarsala': {
        const partida = partidas.buscar(db, args[0]);
        if (!partida) {
          await responderErro(interaction, 'Sala não encontrada.');
          return true;
        }
        if (!mediadores.ehMediador(db, interaction.guildId, interaction.member)) {
          await responderErro(interaction, 'Só o mediador desta sala pode criar a sala do jogo.');
          return true;
        }
        if (partida.mediador_id && partida.mediador_id !== interaction.user.id && !ehAdmin(interaction.member)) {
          await responderErro(interaction, 'Essa sala é de outro mediador.');
          return true;
        }
        try {
          const criada = await salas.criarSalaDaPartida(client, db, { partidaId: args[0] });
          await fluxo.atualizarPartida(client, db, args[0]);
          await auditoria.registrar(db, client, {
            guildId: interaction.guildId,
            autorId: interaction.user.id,
            acao: 'Sala do jogo criada',
            detalhe: `Sala ${args[0]} · room ${criada.dados.room_id}`,
          });
          await responderPrivado(interaction, {
            embeds: [
              embedSucesso(
                `Sala criada! 🎮\n**ID:** \`${criada.dados.room_id}\` · **Senha:** \`${criada.dados.password}\`` +
                  (criada.canalId ? `\nID e senha publicados em <#${criada.canalId}>.` : ''),
              ),
            ],
          });
        } catch (erro) {
          await responderErro(interaction, erro.message);
        }
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
        try {
          const aberto = await tickets.abrirTicket(interaction, { db, client, tipo: args[0] });
          // Resposta estritamente efêmera: nada é publicado no chat geral.
          await responderPrivado(interaction, {
            content: aberto.existente
              ? `🎫 Seu ticket já está aberto: ${aberto.link}\nContinue o atendimento por lá.`
              : `✅ Seu ticket foi criado com sucesso! Acesse: ${aberto.link}\n\n_A staff já foi avisada na sala. Ninguém mais vê esta mensagem._`,
            components: [linhaIgnorar()],
          });
        } catch (erro) {
          console.error('[botoes] ticket:', erro.message);
          await responderErro(
            interaction,
            '❌ Não consegui abrir o ticket. Chame um ADM (confira a categoria de tickets e a permissão **Gerenciar Canais**).',
          ).catch(() => {});
        }
        return true;
      }

      case 'ignorarticket': {
        // Some com o aviso temporário só na tela de quem clicou.
        try {
          await interaction.deleteReply();
        } catch (erro) {
          await interaction
            .editReply({ content: '✅ Aviso dispensado.', embeds: [], components: [] })
            .catch(() => console.warn('[botoes] não consegui apagar o aviso temporário:', erro.message));
        }
        return true;
      }

      case 'fecharticket': {
        if (!ehSuporte(interaction.member)) {
          await responderErro(interaction, 'Só o atendimento (Suporte/Auxiliar) pode fechar o ticket.');
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
    await responderErro(
      interaction,
      erro.message || 'Deu um erro aqui. Tente de novo ou chame um ADM.',
    ).catch(() => {});
    return true;
  }
}

module.exports = { handleBotao };
