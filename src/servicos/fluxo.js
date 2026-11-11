'use strict';

/**
 * Fluxo do AP: fila -> sala privada -> regras -> mediador -> PIX -> pagamento ->
 * sala liberada -> resultado. Toda a parte que fala com o Discord mora aqui.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const config = require('../config');
const { obterConfig, definirConfig } = require('../db');
const { embed, reais, mencao, mencaoCargo } = require('../util/embeds');
const filas = require('./filas');
const partidas = require('./partidas');
const staff = require('./staff');
const paineis = require('./paineis');
const blacklist = require('./blacklist');
const auditoria = require('./auditoria');

const { STATUS } = partidas;

const NOME_TIME = { 1: 'Equipe 1', 2: 'Equipe 2' };
const nomeTime = (time) => NOME_TIME[Number(time)] || `Equipe ${time}`;

function textoJogadores(lista) {
  return [1, 2]
    .map((time) => {
      const doTime = lista.filter((linha) => Number(linha.time) === time);
      const linhas = doTime.length
        ? doTime.map((linha) => `${linha.confirmou ? '✅' : '⏳'} ${mencao(linha.user_id)}`).join('\n')
        : '`vazio`';
      return `**${nomeTime(time)}**\n${linhas}`;
    })
    .join('\n\n');
}

function embedPartida(partida, lista) {
  const modo = config.modoPorId(partida.modo);
  const variante = config.varianteDoModo(modo, partida.gelo);
  const campos = [
    { name: 'Modo', value: modo ? modo.titulo : partida.modo, inline: true },
    { name: 'Aposta', value: reais(partida.preco), inline: true },
    { name: 'Tipo', value: variante ? `${variante.emoji} ${variante.nome}` : partida.gelo, inline: true },
    { name: 'Jogadores', value: textoJogadores(lista), inline: false },
    {
      name: 'Regra da partida',
      value: partida.regras
        ? `${partida.regras}\n— por ${mencao(partida.regras_por)}`
        : '`ninguém enviou ainda`',
      inline: false,
    },
  ];

  let titulo = `🎯 AP ${modo ? modo.titulo : partida.modo} · ${reais(partida.preco)}`;
  let descricao = '';
  let cor = config.CORES.principal;

  switch (partida.status) {
    case STATUS.CONFIRMANDO:
      descricao =
        '**Passo 1 · Regras**\n' +
        'Um dos jogadores clica em **Enviar regra** e escreve a regra da partida.\n' +
        'Depois **todos** clicam em **Confirmar Regras**.';
      break;
    case STATUS.AGUARDANDO_MEDIADOR:
      descricao = `**Passo 2 · Mediação**\nRegras confirmadas. Aguardando ${mencaoCargo(config.CARGO_MEDIADOR_ID)} assumir a sala.`;
      cor = config.CORES.aviso;
      campos.push({
        name: 'PIX do mediador',
        value: 'aparece aqui quando o mediador assumir a sala',
        inline: false,
      });
      break;
    case STATUS.AGUARDANDO_PAGAMENTO:
      descricao =
        '**Passo 3 · Pagamento**\n' +
        `Mediador: ${mencao(partida.mediador_id)}\n` +
        'Clique em **Enviar PIX** para mandar a chave, e em **Pagamento recebido** depois de conferir os comprovantes.';
      cor = config.CORES.aviso;
      campos.push({
        name: 'PIX do mediador',
        value: partida.pix_chave
          ? `\`${partida.pix_chave}\`${partida.pix_titular ? `\nTitular: ${partida.pix_titular}` : ''}`
          : 'clique em **Enviar PIX**',
        inline: false,
      });
      break;
    case STATUS.PAGO:
      descricao =
        '**Passo 4 · Sala**\nPagamento confirmado ✅\nO mediador agora libera o ID e a senha da sala.';
      cor = config.CORES.gelo;
      campos.push({
        name: 'PIX do mediador',
        value: partida.pix_chave ? `\`${partida.pix_chave}\`` : '—',
        inline: true,
      });
      break;
    case STATUS.SALA_LIBERADA:
      descricao =
        '**Passo 5 · Jogar**\nSala liberada! Entrem no Free Fire e joguem a partida.\n' +
        'Ao terminar, o mediador clica no vencedor (ou aplica W.O.).';
      cor = config.CORES.sucesso;
      campos.push(
        { name: 'ID da sala', value: partida.sala_id ? `\`${partida.sala_id}\`` : '—', inline: true },
        { name: 'Senha', value: partida.sala_senha ? `\`${partida.sala_senha}\`` : '—', inline: true },
      );
      break;
    case STATUS.FINALIZADA:
      titulo = `🏆 AP encerrado · ${nomeTime(partida.vencedor_time)} venceu`;
      descricao =
        `**Resultado:** ${nomeTime(partida.vencedor_time)} venceu${partida.motivo_fim === 'wo' ? ' por **W.O.**' : ''}.\n` +
        `Valor: ${reais(partida.preco)} · Modo: ${modo ? modo.titulo : partida.modo}`;
      cor = config.CORES.ouro;
      break;
    case STATUS.CANCELADA:
      titulo = '🚫 AP cancelado';
      descricao = `Essa sala foi cancelada.\nMotivo: ${partida.motivo_fim || 'não informado'}`;
      cor = config.CORES.erro;
      break;
    default:
      descricao = `Status: ${partida.status}`;
  }

  if (partida.mediador_id) {
    campos.push({ name: 'Mediador', value: mencao(partida.mediador_id), inline: true });
  }

  return embed(titulo, descricao, {
    cor,
    campos,
    rodape: `Sala ${partida.id} · ORG Royal AP`,
  });
}

function linha(...botoes) {
  return new ActionRowBuilder().addComponents(...botoes);
}

function componentesPartida(partida) {
  const id = partida.id;
  const linhas = [];
  const botao = (customId, label, emoji, style) =>
    new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);

  switch (partida.status) {
    case STATUS.CONFIRMANDO:
      linhas.push(
        linha(
          botao(`ap:regras:${id}`, 'Enviar regra', '📜', ButtonStyle.Secondary),
          botao(`ap:confirmar:${id}`, 'Confirmar Regras', '✅', ButtonStyle.Success),
          botao(`ap:cancelar:${id}`, 'Cancelar', '🚫', ButtonStyle.Danger),
        ),
      );
      break;
    case STATUS.AGUARDANDO_MEDIADOR:
      linhas.push(
        linha(
          botao(`ap:assumir:${id}`, 'Assumir sala', '👑', ButtonStyle.Primary),
          botao(`ap:cancelar:${id}`, 'Cancelar', '🚫', ButtonStyle.Danger),
        ),
      );
      break;
    case STATUS.AGUARDANDO_PAGAMENTO:
      linhas.push(
        linha(
          botao(`ap:pix:${id}`, 'Enviar PIX', '💸', ButtonStyle.Primary),
          botao(`ap:pago:${id}`, 'Pagamento recebido', '✅', ButtonStyle.Success),
          botao(`ap:cancelar:${id}`, 'Cancelar', '🚫', ButtonStyle.Danger),
        ),
      );
      break;
    case STATUS.PAGO:
      linhas.push(
        linha(
          botao(`ap:liberar:${id}`, 'Liberar sala', '🎮', ButtonStyle.Primary),
          botao(`ap:cancelar:${id}`, 'Cancelar', '🚫', ButtonStyle.Danger),
        ),
      );
      break;
    case STATUS.SALA_LIBERADA:
      linhas.push(
        linha(
          botao(`ap:vencer:${id}:1`, 'Equipe 1 venceu', '🏆', ButtonStyle.Success),
          botao(`ap:vencer:${id}:2`, 'Equipe 2 venceu', '🏆', ButtonStyle.Success),
        ),
        linha(
          botao(`ap:wo:${id}:1`, 'W.O. da Equipe 1', '⚠️', ButtonStyle.Secondary),
          botao(`ap:wo:${id}:2`, 'W.O. da Equipe 2', '⚠️', ButtonStyle.Secondary),
          botao(`ap:cancelar:${id}`, 'Cancelar', '🚫', ButtonStyle.Danger),
        ),
      );
      break;
    case STATUS.FINALIZADA:
    case STATUS.CANCELADA:
      linhas.push(linha(botao(`ap:fechar:${id}`, 'Fechar sala', '🔒', ButtonStyle.Secondary)));
      break;
    default:
      break;
  }
  return linhas;
}

/** Categoria onde as salas são criadas (env -> banco -> nome "filas aqui"). */
async function resolverCategoria(guild, db, chave, envId) {
  const salvo = obterConfig(db, guild.id, chave, envId);
  if (salvo) {
    const porId =
      guild.channels.cache.get(salvo) || (await guild.channels.fetch(salvo).catch(() => null));
    if (porId && porId.type === ChannelType.GuildCategory) return porId;
  }
  const categorias = guild.channels.cache.filter((canal) => canal.type === ChannelType.GuildCategory);
  return (
    categorias.find((canal) => /filas?\s*aqui/i.test(canal.name)) ||
    categorias.find((canal) => /\bfilas?\b/i.test(canal.name)) ||
    null
  );
}

async function criarCanalPartida(client, db, guild, { modo, preco, gelo, jogadores }) {
  const categoria = await resolverCategoria(guild, db, 'categoria_filas', config.CATEGORIA_FILAS_ID);
  const A = PermissionFlagsBits;
  const permissoes = [
    { id: guild.roles.everyone.id, deny: [A.ViewChannel] },
    {
      id: client.user.id,
      allow: [A.ViewChannel, A.SendMessages, A.EmbedLinks, A.ReadMessageHistory, A.ManageChannels, A.ManageMessages],
    },
    ...jogadores.map((userId) => ({
      id: String(userId),
      allow: [A.ViewChannel, A.SendMessages, A.ReadMessageHistory, A.EmbedLinks],
    })),
  ];
  for (const cargo of [config.CARGO_MEDIADOR_ID, config.CARGO_STAFF_ID, config.CARGO_ADMIN_ID]) {
    if (cargo) {
      permissoes.push({
        id: cargo,
        allow: [A.ViewChannel, A.SendMessages, A.ReadMessageHistory, A.EmbedLinks],
      });
    }
  }

  const nome = `ap-${modo.id}-${String(preco / 100).replace('.', ',')}-${gelo}`.toLowerCase().slice(0, 95);

  return guild.channels.create({
    name: nome,
    type: ChannelType.GuildText,
    ...(categoria ? { parent: categoria.id } : {}),
    topic: `AP ${modo.titulo} · ${reais(preco)} · ${gelo} · sala privada`,
    permissionOverwrites: permissoes,
  });
}

async function publicarSala(client, db, partida) {
  try {
    const canal = client.channels.cache.get(partida.canal_id) || (await client.channels.fetch(partida.canal_id));
    if (!canal) return false;
    const lista = partidas.jogadores(db, partida.id);
    const mensagem = await canal.send({
      content: `${lista.map((linha) => mencao(linha.user_id)).join(' ')} — sala de AP criada.`,
      embeds: [embedPartida(partida, lista)],
      components: componentesPartida(partida),
      allowedMentions: { parse: ['users'] },
    });
    partidas.definirMensagem(db, partida.id, mensagem.id);
    await canal.send({
      content: '📌 Enviem o **ID e a senha** da sala aqui quando ela estiver criada. O mediador confere tudo nesta sala.',
      allowedMentions: { parse: [] },
    }).catch(() => {});
    return true;
  } catch (erro) {
    console.error('[fluxo] não consegui publicar a sala:', erro.message);
    return false;
  }
}

async function atualizarPartida(client, db, partidaId) {
  const partida = partidas.buscar(db, partidaId);
  if (!partida) return false;
  try {
    const canal = client.channels.cache.get(partida.canal_id) || (await client.channels.fetch(partida.canal_id));
    if (!canal) return false;
    const lista = partidas.jogadores(db, partidaId);
    const payload = { embeds: [embedPartida(partida, lista)], components: componentesPartida(partida) };

    if (partida.mensagem_id) {
      const mensagem = await canal.messages.fetch(partida.mensagem_id).catch(() => null);
      if (mensagem) {
        await mensagem.edit(payload);
        return true;
      }
    }
    const nova = await canal.send({ ...payload, allowedMentions: { parse: ['users'] } });
    partidas.definirMensagem(db, partidaId, nova.id);
    return true;
  } catch (erro) {
    console.error('[fluxo] não consegui atualizar a sala:', erro.message);
    return false;
  }
}

/**
 * Manda a chave PIX do mediador na sala e na DM dos jogadores.
 * Usado pelo botão "Enviar PIX" e pelo comando /pix.
 */
async function anunciarPix(client, db, { partidaId, mediadorId, chave, titular }) {
  const partida = partidas.salvarPix(db, partidaId, { chave, titular });
  await atualizarPartida(client, db, partidaId);

  const jogadores = partidas.jogadores(db, partidaId);
  const aviso = jogadores.map((linha) => mencao(linha.user_id)).join(' ');
  const texto = [
    `💸 **PIX do mediador** — ${mencao(mediadorId)}`,
    `**Chave:** \`${chave}\``,
    titular ? `**Titular:** ${titular}` : null,
    `**Valor por jogador:** ${reais(partida.preco)}`,
    '',
    'Enviem o comprovante **nesta sala**. O mediador libera a sala depois de conferir.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const canal =
      client.channels.cache.get(partida.canal_id) || (await client.channels.fetch(partida.canal_id));
    await canal?.send({ content: `${aviso}\n${texto}`, allowedMentions: { parse: ['users'] } });

    for (const linha of jogadores) {
      const membro = await canal?.guild?.members?.fetch?.(linha.user_id)?.catch(() => null);
      await membro?.send?.({ embeds: [embed('💸 PIX do seu AP', texto)] })?.catch?.(() => {});
    }
  } catch (erro) {
    console.error('[fluxo] não consegui anunciar o PIX:', erro.message);
  }

  return partida;
}

/**
 * Coloca o jogador na fila e, se o grupo fechar, cria a sala privada.
 * Lança Error com mensagem amigável quando algo impede a entrada.
 */
async function entrarNaFila(client, db, { guild, userId, modo, preco, gelo }) {
  const modoInfo = config.modoPorId(modo);
  if (!modoInfo) throw new Error('Modo de AP inválido.');
  const valor = Number(preco);
  if (!config.PRECOS.includes(valor)) throw new Error('Faixa de aposta inválida.');
  if (!config.varianteDoModo(modoInfo, gelo)) {
    throw new Error('Escolha uma opção de entrada válida para esse modo.');
  }

  const bloqueio = blacklist.obter(db, guild.id, userId);
  if (bloqueio) throw new Error(`Você está na lista negra da ORG: **${bloqueio.motivo}**.`);

  const resultado = filas.entrar(db, {
    guildId: guild.id,
    modo: modoInfo.id,
    preco: valor,
    gelo,
    userId,
  });

  if (!resultado.entrou) {
    throw new Error(`Você já está nessa fila (posição ${resultado.posicao}).`);
  }

  await paineis.atualizar(client, db, { guildId: guild.id, modo: modoInfo.id, preco: valor });

  const naFila = filas.contar(db, { guildId: guild.id, modo: modoInfo.id, preco: valor, gelo });
  if (naFila < modoInfo.jogadores) {
    return { posicao: resultado.posicao, naFila, faltam: modoInfo.jogadores - naFila, fechou: false, partida: null };
  }

  const ids = filas.reservar(db, {
    guildId: guild.id,
    modo: modoInfo.id,
    preco: valor,
    gelo,
    quantidade: modoInfo.jogadores,
  });
  if (!ids) {
    return { posicao: resultado.posicao, naFila, faltam: 1, fechou: false, partida: null };
  }

  const jogadores = ids.map((id, indice) => ({
    userId: id,
    time: indice < modoInfo.time ? 1 : 2,
  }));

  let canal = null;
  try {
    canal = await criarCanalPartida(client, db, guild, { modo: modoInfo, preco: valor, gelo, jogadores: ids });
  } catch (erro) {
    console.error('[fluxo] não consegui criar a sala privada:', erro.message);
    for (const jogador of jogadores) {
      filas.entrar(db, {
        guildId: guild.id,
        modo: modoInfo.id,
        preco: valor,
        gelo,
        userId: jogador.userId,
      });
    }
    await paineis.atualizar(client, db, { guildId: guild.id, modo: modoInfo.id });
    throw new Error(
      'O grupo fechou, mas não consegui criar a sala privada. Peça para um ADM verificar se o bot tem **Gerenciar Canais** e se a categoria de filas existe.',
    );
  }

  const partida = partidas.criar(db, {
    guildId: guild.id,
    modo: modoInfo.id,
    preco: valor,
    gelo,
    canalId: canal.id,
    jogadores,
  });

  await publicarSala(client, db, partida);
  await paineis.atualizar(client, db, { guildId: guild.id, modo: modoInfo.id, preco: valor });
  await auditoria.registrar(db, client, {
    guildId: guild.id,
    acao: 'AP criado',
    detalhe: `${modoInfo.titulo} · ${reais(valor)} · ${gelo} · sala ${canal.name} · ${ids.length} jogadores`,
  });

  return { posicao: resultado.posicao, naFila: 0, faltam: 0, fechou: true, partida, canalId: canal.id };
}

/** Finaliza e avisa na sala. */
async function encerrarPartida(client, db, { partidaId, vencedorTime, autorId, motivo = 'resultado' }) {
  const resultado = partidas.finalizar(db, { partidaId, vencedorTime, autorId, motivo });
  await atualizarPartida(client, db, partidaId);
  await auditoria.registrar(db, client, {
    guildId: resultado.partida.guild_id,
    autorId,
    acao: motivo === 'wo' ? 'W.O. aplicado' : 'Resultado registrado',
    detalhe: `Sala ${partidaId} · ${nomeTime(vencedorTime)} venceu · ${reais(resultado.partida.preco)}`,
  });
  return resultado;
}

async function aplicarWO(client, db, { partidaId, timeAusente, autorId }) {
  const resultado = partidas.aplicarWO(db, { partidaId, timeAusente, autorId });
  await atualizarPartida(client, db, partidaId);
  await auditoria.registrar(db, client, {
    guildId: resultado.partida.guild_id,
    autorId,
    acao: 'W.O. aplicado',
    detalhe: `Sala ${partidaId} · ${nomeTime(timeAusente)} não apareceu · ${reais(resultado.partida.preco)}`,
  });
  return resultado;
}

async function cancelarPartida(client, db, { partidaId, autorId, motivo }) {
  const partida = partidas.cancelar(db, { partidaId, autorId, motivo });
  await atualizarPartida(client, db, partidaId);
  await auditoria.registrar(db, client, {
    guildId: partida.guild_id,
    autorId,
    acao: 'AP cancelado',
    detalhe: `Sala ${partidaId} · ${motivo}`,
  });
  return partida;
}

module.exports = {
  STATUS,
  nomeTime,
  textoJogadores,
  embedPartida,
  componentesPartida,
  resolverCategoria,
  criarCanalPartida,
  publicarSala,
  atualizarPartida,
  entrarNaFila,
  anunciarPix,
  encerrarPartida,
  aplicarWO,
  cancelarPartida,
  definirConfig,
  staff,
};
