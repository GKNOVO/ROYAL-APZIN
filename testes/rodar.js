'use strict';

/**
 * Testes offline do bot Royal AP (não precisa de internet nem token):
 *   node testes/rodar.js
 *
 * Testa banco, filas, partidas, PIX, fluxo da sala, painéis, tickets, API da Nix
 * e os 55 comandos.
 */

process.env.DISCORD_TOKEN = 'token-de-teste';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Collection, ChannelType, PermissionsBitField } = require('discord.js');

const config = require('../src/config');
const { abrirBanco } = require('../src/db');
const usuarios = require('../src/servicos/usuarios');
const staff = require('../src/servicos/staff');
const filas = require('../src/servicos/filas');
const partidas = require('../src/servicos/partidas');
const paineis = require('../src/servicos/paineis');
const fluxo = require('../src/servicos/fluxo');
const blacklist = require('../src/servicos/blacklist');
const auditoria = require('../src/servicos/auditoria');
const comandos = require('../src/comandos');
const tickets = require('../src/servicos/tickets');
const { reais } = require('../src/util/embeds');

const MANAGE_GUILD = PermissionsBitField.Flags.ManageGuild;
let ok = 0;

function passar(texto) {
  ok += 1;
  console.log(`OK  ${texto}`);
}

function pastaTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'royal-ap-'));
}

/** Ambiente falso do Discord: guild + client com canais em memória. */
function ambienteFalso() {
  const cache = new Collection();

  const client = {
    user: { id: 'bot', tag: 'Bot#0001' },
    channels: {
      cache,
      async fetch(id) {
        return cache.get(id) ?? null;
      },
    },
  };

  const guild = {
    id: 'g1',
    name: 'ORG Royal AP',
    roles: { everyone: { id: 'todos' } },
    channels: {
      cache: new Collection(),
      async fetch() {
        return null;
      },
      async create(dados) {
        const mensagens = new Collection();
        const canal = {
          id: `canal-${cache.size + 1}`,
          name: dados.name,
          type: ChannelType.GuildText,
          parentId: dados.parent ?? null,
          permissionOverwrites: dados.permissionOverwrites ?? [],
          enviadas: [],
          isTextBased: () => true,
          async send(payload) {
            const mensagem = {
              id: `msg-${mensagens.size + 1}`,
              payload,
              async edit(novo) {
                mensagem.payload = novo;
                return mensagem;
              },
            };
            mensagens.set(mensagem.id, mensagem);
            canal.enviadas.push(mensagem);
            return mensagem;
          },
          messages: {
            cache: mensagens,
            async fetch(id) {
              return mensagens.get(id) ?? null;
            },
          },
          posicao: null,
          async setPosition(posicao) {
            canal.posicao = posicao;
            return canal;
          },
          async delete() {
            cache.delete(canal.id);
            return canal;
          },
        };
        cache.set(canal.id, canal);
        guild.channels.cache.set(canal.id, canal);
        return canal;
      },
    },
  };

  return { client, guild };
}

function fakeInteraction({
  commandName,
  userId = 'u1',
  guildId = 'g1',
  channelId = 'canal-1',
  channel = null,
  options = {},
  perms = [],
  roles = [],
} = {}) {
  const chamadas = {};
  const interaction = {
    commandName,
    guildId,
    guild: { id: guildId },
    channelId,
    channel: channel ?? { id: channelId, isTextBased: () => true },
    commandName2: null,
    user: { id: userId, tag: `user#${userId}`, username: userId, bot: false },
    member: {
      id: userId,
      roles: { cache: { has: (id) => roles.includes(id) } },
      permissions: { has: (flag) => perms.includes(flag) },
    },
    memberPermissions: { has: (flag) => perms.includes(flag) },
    options: {
      getUser: (nome) => options[nome] ?? null,
      getString: (nome) => options[nome] ?? null,
      getNumber: (nome) => options[nome] ?? null,
      getInteger: (nome) => options[nome] ?? null,
      getBoolean: (nome) => options[nome] ?? null,
      getChannel: (nome) => options[nome] ?? null,
      getRole: (nome) => options[nome] ?? null,
      getSubcommand: () => options.sub ?? null,
    },
    deferred: false,
    replied: false,
    chamadas,
    async reply(payload) {
      chamadas.reply = payload;
      interaction.replied = true;
      return payload;
    },
    async deferReply(payload) {
      chamadas.deferReply = payload ?? true;
      interaction.deferred = true;
      return payload;
    },
    async deferUpdate() {
      chamadas.deferUpdate = true;
      interaction.deferred = true;
      return true;
    },
    async editReply(payload) {
      chamadas.editReply = payload;
      return payload;
    },
    async followUp(payload) {
      chamadas.followUp = payload;
      return payload;
    },
    async deleteReply() {
      chamadas.deleteReply = true;
      return true;
    },
    async update(payload) {
      chamadas.update = payload;
      return payload;
    },
  };
  return interaction;
}

/** Resposta final da interação (o deferReply automático vem antes dela). */
function resposta(interaction) {
  return interaction.chamadas.editReply ?? interaction.chamadas.followUp ?? interaction.chamadas.reply;
}

(async () => {
  const pasta = pastaTemp();
  const db = abrirBanco(path.join(pasta, 'teste.db'));
  const base = { guildId: 'g1' };

  // ---------- banco ----------
  {
    const tabelas = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((linha) => linha.name);
    for (const esperada of ['usuarios', 'staff', 'paineis', 'mensagens_painel', 'filas', 'partidas', 'partida_jogadores', 'transacoes', 'blacklist', 'auditoria', 'configuracoes', 'convites', 'logs_dm', 'plantao', 'telagem_links', 'telagens']) {
      assert.ok(tabelas.includes(esperada), `faltou a tabela ${esperada}`);
    }
    passar('banco: 16 tabelas criadas automaticamente');
  }

  // ---------- usuários e economia ----------
  {
    const saldo1 = usuarios.adicionarCoins(db, { ...base, userId: 'u1', valor: 500, motivo: 'teste' });
    assert.strictEqual(saldo1, 500);
    const saldo2 = usuarios.adicionarCoins(db, { ...base, userId: 'u1', valor: -200, motivo: 'teste' });
    assert.strictEqual(saldo2, 300);
    assert.throws(() => usuarios.adicionarCoins(db, { ...base, userId: 'u1', valor: -9999 }), /Saldo insuficiente/);
    assert.strictEqual(usuarios.obter(db, 'g1', 'u1').coins, 300);
    passar('economia: crédito, débito e bloqueio de saldo negativo');

    usuarios.transferirCoins(db, { ...base, deId: 'u1', paraId: 'u2', valor: 100 });
    assert.strictEqual(usuarios.obter(db, 'g1', 'u1').coins, 200);
    assert.strictEqual(usuarios.obter(db, 'g1', 'u2').coins, 100);
    assert.throws(() => usuarios.transferirCoins(db, { ...base, deId: 'u1', paraId: 'u1', valor: 10 }), /você mesmo/);
    passar('economia: envio entre jogadores e bloqueio de autoenvio');

    assert.strictEqual(usuarios.adicionarGiros(db, { ...base, userId: 'u3', quantidade: 7 }), 7);
    assert.throws(() => usuarios.adicionarGiros(db, { ...base, userId: 'u3', quantidade: -99 }), /giros/);
    passar('economia: giros com proteção de saldo');

    usuarios.registrarVitoria(db, { ...base, userId: 'u1', apostado: 500, ganho: 500 });
    usuarios.registrarVitoria(db, { ...base, userId: 'u1', apostado: 100 });
    usuarios.registrarDerrota(db, { ...base, userId: 'u1', apostado: 50, wo: true });
    const resumo = usuarios.resumo(db, 'g1', 'u1');
    assert.strictEqual(resumo.vitorias, 2);
    assert.strictEqual(resumo.derrotas, 1);
    assert.strictEqual(resumo.wos, 1);
    assert.strictEqual(resumo.aproveitamento, 67);
    assert.strictEqual(resumo.apostado, 650);
    passar('estatísticas: vitória, derrota, W.O. e aproveitamento');

    const top = usuarios.top(db, 'g1', 'vitorias', 10);
    assert.strictEqual(top[0].user_id, 'u1');
    passar('ranking: ordenação por vitórias');
  }

  // ---------- filas ----------
  {
    assert.strictEqual(filas.entrar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'infinito', userId: 'a' }).posicao, 1);
    const repetido = filas.entrar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'infinito', userId: 'a' });
    assert.strictEqual(repetido.entrou, false);
    assert.strictEqual(repetido.posicao, 1);
    filas.entrar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'infinito', userId: 'b' });
    filas.entrar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'normal', userId: 'c' });
    assert.strictEqual(filas.contar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'infinito' }), 2);
    assert.strictEqual(filas.contar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'normal' }), 1);
    assert.strictEqual(filas.total(db, { ...base, modo: 'x1mobile' }), 3);
    passar('fila: entrada única, posição e contagem por gelo');

    assert.strictEqual(filas.reservar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'normal', quantidade: 2 }), null);
    assert.strictEqual(filas.contar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'normal' }), 1);
    passar('fila: reserva não rouba jogador quando falta gente');

    const reservados = filas.reservar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'infinito', quantidade: 2 });
    assert.deepStrictEqual(reservados, ['a', 'b']);
    assert.strictEqual(filas.contar(db, { ...base, modo: 'x1mobile', preco: 50, gelo: 'infinito' }), 0);
    passar('fila: reserva atômica tira os jogadores da fila');

    assert.strictEqual(filas.sair(db, { ...base, modo: 'x1mobile', userId: 'c' }), 1);
    assert.strictEqual(filas.total(db, { ...base, modo: 'x1mobile' }), 0);
    passar('fila: sair remove o jogador');
  }

  // ---------- staff / PIX ----------
  {
    assert.strictEqual(staff.podeAssumir(db, 'g1', 'med1'), false);
    const registro = staff.registrarPix(db, {
      ...base,
      userId: 'med1',
      chave: 'med1@pix.com',
      titular: 'Mediador Um',
      comissao: 0.05,
    });
    assert.strictEqual(registro.pix_chave, 'med1@pix.com');
    assert.strictEqual(staff.podeAssumir(db, 'g1', 'med1'), true);
    assert.throws(() => staff.registrarPix(db, { ...base, userId: 'med1', chave: 'x' }), /curta/);
    assert.throws(() => staff.definirComissao(db, { ...base, userId: 'med1', comissao: 0.9 }), /comissão/);
    passar('PIX: cadastro, validação e liberação para assumir sala');
  }

  // ---------- partida completa (sem Discord) ----------
  {
    const partida = partidas.criar(db, {
      ...base,
      modo: 'x1mobile',
      preco: 500,
      gelo: 'infinito',
      canalId: 'canal-teste',
      jogadores: [
        { userId: 'p1', time: 1 },
        { userId: 'p2', time: 2 },
      ],
    });
    assert.ok(partida.id);
    assert.strictEqual(partida.status, 'confirmando');

    const primeira = partidas.confirmar(db, partida.id, 'p1');
    assert.strictEqual(primeira.confirmados, 1);
    assert.strictEqual(primeira.completo, false);
    assert.throws(() => partidas.confirmar(db, partida.id, 'forasteiro'), /não está nessa partida/);

    const segunda = partidas.confirmar(db, partida.id, 'p2');
    assert.strictEqual(segunda.completo, true);
    assert.strictEqual(partidas.buscar(db, partida.id).status, 'aguardando_mediador');
    passar('partida: regras confirmadas pelos dois jogadores');

    partidas.definirRegras(db, partida.id, '1x1 mobile, gelo infinito, 3 quedas', 'p1');
    assert.ok(partidas.buscar(db, partida.id).regras.includes('3 quedas'));

    const assumida = partidas.assumir(db, partida.id, 'med1', 0.05);
    assert.strictEqual(assumida.status, 'aguardando_pagamento');
    assert.throws(() => partidas.assumir(db, partida.id, 'med2', 0.05), /já tem um mediador/);
    passar('partida: mediador assume e ninguém toma a sala dele');

    partidas.salvarPix(db, partida.id, { chave: 'med1@pix.com', titular: 'Mediador Um' });
    assert.strictEqual(partidas.buscar(db, partida.id).pix_chave, 'med1@pix.com');
    assert.strictEqual(partidas.marcarPago(db, partida.id).status, 'pago');
    assert.throws(() => partidas.liberarSala(db, partida.id, { salaId: '   ' }), /ID da sala/);
    passar('partida: PIX salvo e sala só libera com ID');
  }

  // ---------- fluxo completo com Discord falso ----------
  {
    const { client, guild } = ambienteFalso();
    const db2 = abrirBanco(path.join(pasta, 'fluxo.db'));

    filas.entrar(db2, { guildId: guild.id, modo: 'x1mobile', preco: 100, gelo: 'normal', userId: 'j1' });
    const entrada = await fluxo.entrarNaFila(client, db2, {
      guild,
      userId: 'j2',
      modo: 'x1mobile',
      preco: 100,
      gelo: 'normal',
    });
    assert.strictEqual(entrada.fechou, true);
    assert.ok(entrada.canalId, 'canal privado criado');
    const partidaId = entrada.partida.id;
    passar('fluxo: 2 jogadores fecham a fila e o bot cria a sala privada');

    const canal = client.channels.cache.get(entrada.canalId);
    assert.ok(canal.enviadas.length >= 1);
    const embedSala = canal.enviadas[0].payload.embeds[0].toJSON();
    assert.ok(embedSala.title.includes('Aguardando'), 'card de abertura "Aguardando"');
    assert.ok(embedSala.title.includes('1v1 Mobile Gelo Normal'), 'tipo da partida no título');
    assert.deepStrictEqual(
      canal.enviadas[0].payload.components[0].toJSON().components.map((botao) => botao.label),
      ['Confirmar Partida', 'Cancelar'],
    );
    passar('fluxo: sala nasce com card "Aguardando" e botões Confirmar/Cancelar');

    partidas.definirRegras(db2, partidaId, 'Regra combinada: sem emulador, gelo infinito', 'j1');
    partidas.confirmar(db2, partidaId, 'j1');
    partidas.confirmar(db2, partidaId, 'j2');
    assert.strictEqual(partidas.buscar(db2, partidaId).status, 'aguardando_mediador');

    staff.registrarPix(db2, { guildId: guild.id, userId: 'med1', chave: 'pix@med1', comissao: 0.1 });
    partidas.assumir(db2, partidaId, 'med1', 0.1);
    await fluxo.atualizarPartida(client, db2, partidaId);
    const embedMediador = canal.enviadas[0].payload.embeds[0].toJSON();
    assert.ok(embedMediador.description.includes('Pagamento'));
    passar('fluxo: painel da sala muda de etapa sozinho');

    partidas.salvarPix(db2, partidaId, { chave: 'pix@med1', titular: 'Mediador' });
    partidas.marcarPago(db2, partidaId);
    const liberada = partidas.liberarSala(db2, partidaId, { salaId: '87654321', senha: 'abc' });
    assert.strictEqual(liberada.status, 'sala_liberada');
    await fluxo.atualizarPartida(client, db2, partidaId);

    const final = await fluxo.encerrarPartida(client, db2, {
      partidaId,
      vencedorTime: 1,
      autorId: 'med1',
    });
    assert.strictEqual(final.partida.status, 'finalizada');
    assert.strictEqual(final.partida.vencedor_time, 1);
    passar('fluxo: partida finalizada e resultado salvo');

    const vencedor = usuarios.resumo(db2, guild.id, 'j1');
    const perdedor = usuarios.resumo(db2, guild.id, 'j2');
    assert.strictEqual(vencedor.vitorias, 1);
    assert.strictEqual(vencedor.ganho, 100);
    assert.strictEqual(perdedor.derrotas, 1);
    assert.strictEqual(perdedor.apostado, 100);
    passar('fluxo: estatísticas dos jogadores atualizadas');

    const receita = staff.receita(db2, guild.id, 0);
    assert.strictEqual(receita.length, 1);
    assert.strictEqual(Math.round(receita[0].comissao), 20); // 10% de 2x R$1,00
    passar('fluxo: comissão do mediador calculada');

    assert.throws(() => partidas.finalizar(db2, { partidaId, vencedorTime: 2 }), /já foi encerrada/);
    passar('fluxo: não dá para finalizar a mesma partida duas vezes');

    const embedFinal = canal.enviadas[0].payload.embeds[0].toJSON();
    assert.ok(embedFinal.title.includes('venceu'));
    passar('fluxo: sala mostra o vencedor no embed');

    // blacklist
    blacklist.adicionar(db2, { guildId: guild.id, userId: 'banido', motivo: 'não pagou', autorId: 'med1' });
    await assert.rejects(
      () =>
        fluxo.entrarNaFila(client, db2, { guild, userId: 'banido', modo: 'x1mobile', preco: 50, gelo: 'infinito' }),
      /lista negra/,
    );
    assert.strictEqual(blacklist.remover(db2, { guildId: guild.id, userId: 'banido' }), 1);
    passar('fluxo: blacklist bloqueia entrada e pode ser removida');

    // modo 4x4 precisa de 8 jogadores
    for (let i = 1; i <= 7; i += 1) {
      filas.entrar(db2, { guildId: guild.id, modo: 'x4misto', preco: 10000, gelo: 'emu1', userId: `t${i}` });
    }
    const oitavo = await fluxo.entrarNaFila(client, db2, {
      guild,
      userId: 't8',
      modo: 'x4misto',
      preco: 10000,
      gelo: 'emu1',
    });
    assert.strictEqual(oitavo.fechou, true);
    const jogadores4x4 = partidas.jogadores(db2, oitavo.partida.id);
    assert.strictEqual(jogadores4x4.length, 8);
    assert.strictEqual(jogadores4x4.filter((linha) => linha.time === 1).length, 4);
    assert.strictEqual(jogadores4x4.filter((linha) => linha.time === 2).length, 4);
    passar('fluxo: 4x4 fecha com 8 jogadores e divide 4x4');

    // W.O.
    const wo = await fluxo.aplicarWO(client, db2, { partidaId: oitavo.partida.id, timeAusente: 1, autorId: 'med1' });
    assert.strictEqual(wo.partida.vencedor_time, 2);
    const ausente = usuarios.resumo(db2, guild.id, 't1');
    assert.strictEqual(ausente.wos, 1);
    assert.strictEqual(ausente.derrotas, 1);
    passar('fluxo: W.O. marca derrota para quem não apareceu');

    // cancelamento
    const cancelavel = partidas.criar(db2, {
      guildId: guild.id,
      modo: 'x2emu',
      preco: 250,
      gelo: 'normal',
      canalId: 'canal-x',
      jogadores: [{ userId: 'c1', time: 1 }, { userId: 'c2', time: 2 }],
    });
    const cancelada = await fluxo.cancelarPartida(client, db2, {
      partidaId: cancelavel.id,
      autorId: 'med1',
      motivo: 'jogador caiu',
    });
    assert.strictEqual(cancelada.status, 'cancelada');
    assert.strictEqual(usuarios.resumo(db2, guild.id, 'c1').derrotas, 0);
    passar('fluxo: cancelar não mexe nas estatísticas');

    assert.ok(auditoria.recentes(db2, guild.id, 5).length > 0);
    passar('auditoria: ações da staff registradas no banco');
  }

  // ---------- painéis ----------
  {
    const modo = config.modoPorId('x1mobile');
    const entrada = filas.listar(db, { guildId: 'g1', modo: 'x1mobile' });
    const painel = paineis.mensagemPainel(modo, entrada);
    assert.strictEqual(painel.embeds.length, 1);
    assert.strictEqual(painel.components.length, 2);

    const embed = painel.embeds[0].toJSON();
    assert.ok(embed.title.includes('1x1'));
    assert.strictEqual(config.PRECOS.length, 15);
    assert.strictEqual(embed.fields.length, 15);
    assert.ok(embed.fields[0].name.includes('R$ 0,50'), 'primeiro card é R$ 0,50');
    assert.ok(embed.fields[14].name.includes('R$ 100,00'), 'último card é R$ 100,00');
    assert.deepStrictEqual(config.PRECOS.map(reais), [
      'R$ 0,50', 'R$ 1,00', 'R$ 1,50', 'R$ 2,00', 'R$ 3,00', 'R$ 4,00', 'R$ 5,00', 'R$ 7,00',
      'R$ 10,00', 'R$ 15,00', 'R$ 20,00', 'R$ 30,00', 'R$ 50,00', 'R$ 70,00', 'R$ 100,00',
    ]);
    passar('painel antigo: 15 cards na ordem certa (R$ 0,50 no topo · R$ 100,00 no fundo)');

    // ---------- fila nova: 1 mensagem por faixa, menor preço por ÚLTIMO ----------
    const mensagens = paineis.mensagensFila(modo, entrada);
    assert.strictEqual(mensagens.length, 15, '15 mensagens por fila');
    assert.strictEqual(mensagens[0].preco, 10000, 'primeira mensagem é a maior aposta');
    assert.strictEqual(mensagens[14].preco, 50, 'última mensagem é R$ 0,50 (fica embaixo)');
    assert.ok(mensagens[14].payload.embeds[0].toJSON().title.includes('R$ 0,50'));
    assert.ok(mensagens[0].payload.components[0].toJSON().components[0].custom_id.includes(':10000:'));
    passar('fila: 15 mensagens separadas, do maior preço (topo) ao menor (última, embaixo)');

    // card minimalista: título "1v1 Mobile | R$ 0,50" + campo Jogadores
    const cardVazio = paineis.mensagemPreco(modo, 50, []).embeds[0].toJSON();
    assert.strictEqual(cardVazio.title, '1v1 Mobile | R$ 0,50');
    assert.strictEqual(cardVazio.description, undefined, 'sem textão explicativo');
    assert.strictEqual(cardVazio.footer, undefined, 'sem rodapé');
    assert.deepStrictEqual(cardVazio.fields.map((campo) => campo.name), ['Jogadores']);
    assert.strictEqual(cardVazio.fields[0].value, 'Nenhum jogador na fila.');

    const cardComJogador = paineis
      .mensagemPreco(modo, 50, [{ preco: 50, gelo: 'normal', user_id: 'j1' }])
      .embeds[0]
      .toJSON();
    assert.strictEqual(cardComJogador.fields[0].value, 'Gelo Normal | <@j1>');
    passar('fila: card minimalista, "Nenhum jogador na fila." e "Gelo Normal | <@id>"');

    // publicação: 15 mensagens no canal ATUAL, sem criar canal nenhum
    const { client: clienteFila, guild: guildFila } = ambienteFalso();
    const canalFila = await guildFila.channels.create({ name: '⚡╸royal' });
    const canaisAntes = guildFila.channels.cache.size;

    const enviadas = await paineis.publicarFila(db, canalFila, { guildId: 'g1', modo, entradas: [] });
    assert.strictEqual(enviadas.length, 15);
    assert.strictEqual(canalFila.enviadas.length, 15, '15 mensagens no canal atual');
    assert.strictEqual(guildFila.channels.cache.size, canaisAntes, 'nenhum canal novo criado');
    assert.strictEqual(paineis.mensagensSalvas(db, { guildId: 'g1', modo: 'x1mobile' }).length, 15);
    assert.strictEqual(
      await paineis.atualizar(clienteFila, db, { guildId: 'g1', modo: 'x1mobile', preco: 50 }),
      true,
    );
    passar('fila: 15 mensagens no canal atual, sem criar canal novo');

    const menu = painel.components[0].toJSON().components[0];
    assert.strictEqual(menu.custom_id, 'ap:preco:x1mobile');
    assert.strictEqual(menu.options.length, 15);
    const botoesPainel = painel.components[1].toJSON().components.map((botao) => botao.custom_id);
    assert.deepStrictEqual(botoesPainel, ['ap:sair:x1mobile:todos', 'ap:como']);
    passar('painel: menu com 15 valores e sem botão de ranking');

    const mobile = paineis.componentesEntrada(modo, 250)[0].toJSON().components;
    assert.deepStrictEqual(
      mobile.map((botao) => botao.custom_id),
      ['ap:entrar:x1mobile:250:infinito', 'ap:entrar:x1mobile:250:normal', 'ap:como'],
    );
    assert.deepStrictEqual(mobile.map((botao) => botao.label), ['Gelo Infinito', 'Gelo Normal', 'Como funciona']);
    passar('cards mobile: Gelo Infinito · Gelo Normal (sem "Sair" no card público)');

    // "Sair" é dinâmico: só aparece para quem está naquela faixa (efêmero)
    const comSair = paineis.componentesEntrada(modo, 250, { sair: true })[0].toJSON().components;
    assert.deepStrictEqual(comSair.map((botao) => botao.custom_id), [
      'ap:entrar:x1mobile:250:infinito',
      'ap:entrar:x1mobile:250:normal',
      'ap:sair:x1mobile:250',
      'ap:como',
    ]);
    assert.strictEqual(paineis.linhaSair(modo, 250).toJSON().components[0].custom_id, 'ap:sair:x1mobile:250');
    passar('cards: botão "Sair" só aparece para quem está na fila daquela faixa');

    const emu = paineis.componentesEntrada(config.modoPorId('x2emu'), 500)[0].toJSON().components;
    assert.deepStrictEqual(emu.map((botao) => botao.label), ['Normal', 'Full UMP e XM8', 'Como funciona']);
    const capa = paineis.componentesEntrada(config.modoPorId('x1fullcapa'), 500)[0].toJSON().components;
    assert.deepStrictEqual(capa.map((botao) => botao.label), ['Full Capa', 'Como funciona']);
    passar('cards emu e full capa: botões certos em cada categoria');

    const misto = ['x2misto', 'x3misto', 'x4misto'].map(
      (id) => paineis.componentesEntrada(config.modoPorId(id), 1000)[0].toJSON().components,
    );
    assert.deepStrictEqual(misto[0].map((botao) => botao.label), ['1 Emu']);
    assert.deepStrictEqual(misto[1].map((botao) => botao.label), ['1 Emu', '2 Emu']);
    assert.deepStrictEqual(misto[2].map((botao) => botao.label), ['1 Emu', '2 Emu', '3 Emu']);
    for (const linha of misto) {
      assert.ok(!linha.some((botao) => /Como funciona/.test(botao.label)), 'misto sem "Como funciona"');
    }
    passar('cards misto: 1/2/3 Emu, sem "Como funciona"');

    assert.strictEqual(config.MODOS.length, 15);
    const titulos = config.MODOS.map((m) => m.titulo);
    for (const esperado of ['1x1 | mobile', '4x4 | mobile', '1x1 | full capa', '4x4 | full capa', '1x1 | emu', '4x4 | emu', '2x2 | misto', '4x4 | misto']) {
      assert.ok(titulos.includes(esperado), `faltou o modo ${esperado}`);
    }
    passar('modos: os 15 painéis existem com os títulos certos');
  }

  // ---------- matchmaking: sala na categoria + confirmação pública ----------
  {
    const { client, guild } = ambienteFalso();
    const db3 = abrirBanco(path.join(pasta, 'match.db'));

    // Sala privada nasce DENTRO da categoria configurada (sem canal de referência).
    const categoriaFilas = { id: 'cat-filas-ap', name: 'FILAS AP', type: ChannelType.GuildCategory };
    guild.channels.cache.set(categoriaFilas.id, categoriaFilas);
    const categoriaAntes = config.CATEGORIA_FILAS_ID;
    config.CATEGORIA_FILAS_ID = categoriaFilas.id;

    filas.entrar(db3, { guildId: guild.id, modo: 'x1mobile', preco: 50, gelo: 'normal', userId: 'k1' });
    const fechou = await fluxo.entrarNaFila(client, db3, {
      guild,
      userId: 'k2',
      modo: 'x1mobile',
      preco: 50,
      gelo: 'normal',
    });
    config.CATEGORIA_FILAS_ID = categoriaAntes;

    assert.strictEqual(fechou.fechou, true);
    const sala = client.channels.cache.get(fechou.canalId);
    assert.strictEqual(sala.name, 'fila-gelo-normal-001');
    assert.strictEqual(sala.parentId, 'cat-filas-ap', 'sala criada DENTRO da categoria de filas');

    const cardSala = sala.enviadas[0].payload.embeds[0].toJSON();
    assert.ok(cardSala.title.includes('Aguardando'));
    assert.ok(cardSala.title.includes('1v1 Mobile Gelo Normal'));
    const camposSala = Object.fromEntries(cardSala.fields.map((campo) => [campo.name, campo.value]));
    assert.strictEqual(camposSala.Aposta, 'R$ 0,50');
    assert.ok(camposSala.Jogadores.includes('1. <@k1>'), camposSala.Jogadores);
    assert.ok(camposSala.Jogadores.includes('2. <@k2>'), camposSala.Jogadores);
    passar('matchmaking: sala #fila-gelo-normal-001 dentro da categoria com card "Aguardando"');

    const { handleBotao: cliqueBotao } = require('../src/interacoes/botoes');
    const confirmar1 = fakeInteraction({ userId: 'k1' });
    confirmar1.customId = `ap:confirmar:${fechou.partida.id}`;
    confirmar1.isButton = () => true;
    confirmar1.guild = guild;
    await cliqueBotao(confirmar1, { db: db3, client });

    const aviso1 = String(sala.enviadas.at(-1)?.payload?.content || '');
    assert.ok(aviso1.includes('<@k1> confirmou a partida'), aviso1);
    assert.ok(aviso1.includes('Agora falta apenas <@k2> para confirmar'), aviso1);
    passar('matchmaking: 1ª confirmação avisa publicamente quem falta');

    const confirmar2 = fakeInteraction({ userId: 'k2' });
    confirmar2.customId = `ap:confirmar:${fechou.partida.id}`;
    confirmar2.isButton = () => true;
    confirmar2.guild = guild;
    await cliqueBotao(confirmar2, { db: db3, client });

    const aviso2 = String(sala.enviadas.at(-1)?.payload?.content || '');
    assert.ok(aviso2.includes('<@k2> confirmou a partida'), aviso2);
    assert.ok(aviso2.includes('Todos confirmaram! Partida iniciando...'), aviso2);
    assert.strictEqual(partidas.buscar(db3, fechou.partida.id).status, 'aguardando_mediador');
    passar('matchmaking: 2ª confirmação libera "Todos confirmaram! Partida iniciando..."');
  }

  // ---------- mediação: configuração, plantão, PIX, telagem e /verp ----------
  {
    const cfgMed = require('../src/servicos/mediadores');
    const plantao = require('../src/servicos/plantao');
    const telagem = require('../src/servicos/telagem');
    const salas = require('../src/servicos/salas');
    const { handleBotao: cliqueMed } = require('../src/interacoes/botoes');
    const { handleModal: modalMed } = require('../src/interacoes/modais');

    // configuração do módulo (cargos, canais e modo)
    cfgMed.definirCargos(db, 'g1', ['cargo-med', 'cargo-adm']);
    assert.deepStrictEqual(cfgMed.cargos(db, 'g1'), ['cargo-med', 'cargo-adm']);
    cfgMed.definirCanalBatePonto(db, 'g1', 'canal-ponto');
    cfgMed.definirCanalConfigPix(db, 'g1', 'canal-pixcfg');
    cfgMed.definirModo(db, 'g1', 'fila');
    assert.strictEqual(cfgMed.modo(db, 'g1'), 'fila');
    assert.strictEqual(cfgMed.canalBatePonto(db, 'g1'), 'canal-ponto');

    const painelMediadores = cfgMed.painelConfig(db, 'g1');
    assert.ok(painelMediadores.embeds[0].toJSON().title.includes('Módulo de Mediadores'));
    assert.deepStrictEqual(
      painelMediadores.components.flatMap((linha) => linha.toJSON().components.map((item) => item.custom_id)),
      ['ap:medcargos', 'ap:medfila', 'ap:medpix', 'ap:medlimpar', 'ap:medgestaopix', 'ap:medmodo', 'ap:medreenviar'],
    );
    passar('/mediadores: painel com cargos, canais (plantão/PIX) e modo salvos no banco');

    // Menus de CARGO e de CANAL: ack imediato e 2 cargos salvos juntos
    const { handleSelect } = require('../src/interacoes/selects');
    cfgMed.definirCargos(db, 'g1', ['cargo-antigo']);
    const menuCargos = fakeInteraction({ perms: [PermissionsBitField.Flags.Administrator], guildId: 'g1' });
    menuCargos.customId = 'ap:medcargos';
    menuCargos.values = ['cargo-med', 'cargo-adm'];
    menuCargos.isRoleSelectMenu = () => true;
    await handleSelect(menuCargos, { db, client: null });
    assert.strictEqual(menuCargos.chamadas.deferUpdate, true, 'deferUpdate ANTES do banco');
    assert.deepStrictEqual(cfgMed.cargos(db, 'g1'), ['cargo-med', 'cargo-adm'], 'os 2 cargos salvos juntos');
    assert.ok(menuCargos.chamadas.editReply, 'painel redesenhado com a escolha');
    passar('menus: 2 cargos (Mediador + ADM) salvos juntos e ack imediato');

    const menuCanal = fakeInteraction({ perms: [PermissionsBitField.Flags.Administrator], guildId: 'g1' });
    menuCanal.customId = 'ap:medfila';
    menuCanal.values = ['canal-ponto'];
    menuCanal.isChannelSelectMenu = () => true;
    await handleSelect(menuCanal, { db, client: null });
    assert.strictEqual(menuCanal.chamadas.deferUpdate, true, 'canal também confirma na hora');
    assert.strictEqual(cfgMed.canalBatePonto(db, 'g1'), 'canal-ponto');
    passar('menus: canal do bate-ponto reconhecido (channel select tratado)');

    // Canal escolhido recebe o painel automaticamente
    const canalAuto = {
      id: 'canal-auto-ponto',
      enviadas: [],
      async send(payload) {
        canalAuto.enviadas.push(payload);
        return { id: 'msg-auto', async pin() {} };
      },
    };
    const clientAuto = { channels: { cache: new Map([[canalAuto.id, canalAuto]]), fetch: async () => null } };
    const menuAuto = fakeInteraction({ perms: [PermissionsBitField.Flags.Administrator], guildId: 'g1' });
    menuAuto.customId = 'ap:medpix';
    menuAuto.values = ['canal-auto-ponto'];
    menuAuto.isChannelSelectMenu = () => true;
    await handleSelect(menuAuto, { db, client: clientAuto });
    assert.strictEqual(canalAuto.enviadas.length, 1, 'painel publicado automaticamente no canal');
    assert.ok(canalAuto.enviadas[0].embeds[0].toJSON().title.includes('Central de Pagamentos'));
    assert.strictEqual(cfgMed.canalConfigPix(db, 'g1'), 'canal-auto-ponto');
    passar('menus: canal de PIX recebe o painel na hora (publicação automática)');

    // Painel de plantão sem o botão "Config" (só Entrar/Sair/Atualizar)
    const botoesPlantao = plantao.painel(db, 'g1').components[0].toJSON().components;
    assert.deepStrictEqual(
      botoesPlantao.map((botao) => botao.label),
      ['Entrar', 'Sair', 'Atualizar'],
      'painel de plantão sem Config',
    );
    passar('plantão: painel só com Entrar, Sair e Atualizar');

    // Entrar no plantão exige um dos cargos configurados (Mediador/ADM)
    const semCargoPlantao = fakeInteraction({ userId: 'semcargo', guildId: 'g1' });
    semCargoPlantao.customId = 'ap:plantaoentrar';
    semCargoPlantao.isButton = () => true;
    semCargoPlantao.guild = { id: 'g1' };
    await cliqueMed(semCargoPlantao, { db, client: null });
    assert.strictEqual(
      plantao.posicao(db, { guildId: 'g1', userId: 'semcargo' }),
      null,
      'não pode entrar sem cargo',
    );
    assert.ok(resposta(semCargoPlantao).embeds[0].toJSON().description.includes('cargos'));
    passar('plantão: sem cargo configurado, o botão Entrar é bloqueado');

    // plantão (bate-ponto)
    assert.strictEqual(plantao.entrar(db, { guildId: 'g1', userId: 'med1' }), true);
    assert.strictEqual(plantao.entrar(db, { guildId: 'g1', userId: 'med1' }), false);
    plantao.entrar(db, { guildId: 'g1', userId: 'med2' });
    assert.strictEqual(plantao.total(db, 'g1'), 2);
    assert.strictEqual(plantao.posicao(db, { guildId: 'g1', userId: 'med2' }), 2);
    assert.strictEqual(plantao.proximo(db, 'g1'), 'med1');
    assert.ok(plantao.painel(db, 'g1').embeds[0].toJSON().description.includes('2 mediador(es) na fila'));
    assert.strictEqual(plantao.sair(db, { guildId: 'g1', userId: 'med2' }), 1);
    plantao.limpar(db, 'g1');
    assert.ok(plantao.painel(db, 'g1').embeds[0].toJSON().description.includes('Nenhum mediador na fila'));
    assert.ok(plantao.painelRegistroPix().embeds[0].toJSON().title.includes('Central de Pagamentos'));
    passar('plantão: fila de mediadores, rodízio e painel de PIX');

    // botão Entrar do painel de plantão
    const entrarPlantao = fakeInteraction({ userId: 'med1', roles: ['cargo-med'], guildId: 'g1' });
    entrarPlantao.customId = 'ap:plantaoentrar';
    entrarPlantao.isButton = () => true;
    entrarPlantao.guild = { id: 'g1' };
    await cliqueMed(entrarPlantao, { db, client: null });
    assert.strictEqual(plantao.total(db, 'g1'), 1);
    assert.ok(entrarPlantao.chamadas.editReply.embeds[0].toJSON().description.includes('1 mediador(es) na fila'));
    passar('plantão: botão Entrar coloca o mediador na fila e atualiza o painel');

    // PIX individual pelo modal da Central de Pagamentos
    const modalPix = fakeInteraction({ perms: [PermissionsBitField.Flags.Administrator], guildId: 'g1' });
    modalPix.customId = 'ap:modalpix';
    modalPix.fields = {
      getTextInputValue: (nome) => ({ chave: 'pix@med', titular: 'Mediador Teste', cidade: 'São Paulo' })[nome],
    };
    await modalMed(modalPix, { db, client: null });
    const registroMed = staff.obter(db, 'g1', 'u1');
    assert.strictEqual(registroMed.pix_chave, 'pix@med');
    assert.strictEqual(registroMed.pix_cidade, 'São Paulo');
    passar('PIX: modal salva chave, titular e cidade do mediador');

    // Modal PIX: labels <= 45 (o limite do Discord — origem do "Invalid string length")
    const aberturaPix = fakeInteraction({ userId: 'med1', roles: ['cargo-med'], guildId: 'g1' });
    aberturaPix.showModal = async (modal) => {
      aberturaPix.modal = modal;
    };
    await require('../src/interacoes/modais').abrirModalPix(aberturaPix);
    const jsonPix = aberturaPix.modal.toJSON();
    assert.ok(jsonPix.title.length <= 45, jsonPix.title);
    for (const linha of jsonPix.components) {
      for (const campo of linha.components) {
        assert.ok(campo.label.length <= 45, `label grande demais: ${campo.label}`);
        assert.ok(campo.max_length <= 4000, 'max_length inválido');
      }
    }
    passar('PIX: modal abre com labels e limites válidos (sem "Invalid string length")');

    // telagem
    const codigo = telagem.novoCodigo();
    assert.ok(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(codigo), codigo);

    // Código exclusivo e estável por canal/partida
    const codigoSala = telagem.codigoDoCanal('g1', 'canal-xyz');
    assert.ok(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(codigoSala), codigoSala);
    assert.strictEqual(telagem.codigoDoCanal('g1', 'canal-xyz'), codigoSala, 'mesmo canal = mesma sala');
    assert.notStrictEqual(
      telagem.codigoDoCanal('g1', 'outro-canal'),
      codigoSala,
      'canais diferentes = salas diferentes',
    );
    const painelTelagem = telagem.painel(codigo);
    assert.ok(painelTelagem.embeds[0].toJSON().title.includes('Sala de Telagem Criada'));
    assert.ok(painelTelagem.embeds[0].toJSON().description.includes(codigo));
    assert.strictEqual(painelTelagem.components[0].toJSON().components[0].style, 5, 'botão de link');
    passar('telagem: código 3-4-3, link da call e painel "Sala de Telagem Criada"');

    // Provedores: jitsi (sala criada na hora) e google (Meet), + link colado
    assert.ok(telagem.link(codigo).includes('royal-ap-'), telagem.link(codigo));
    const provedorAntes = config.TELAGEM_PROVEDOR;
    config.TELAGEM_PROVEDOR = 'google';
    assert.ok(telagem.link(codigo).startsWith('https://meet.google.com/'), telagem.link(codigo));
    config.TELAGEM_PROVEDOR = provedorAntes;
    assert.strictEqual(telagem.linkValido('https://evil.com/sala'), null, 'só aceita meet.google.com');
    const painelMeet = telagem.painel(codigo, { url: 'https://meet.google.com/abc-defg-hij' });
    assert.strictEqual(
      painelMeet.components[0].toJSON().components[0].url,
      'https://meet.google.com/abc-defg-hij',
    );
    passar('telagem: link do Google Meet validado (fixo ou colado no comando)');

    // Pool de links REAIS do Meet: exclusivo por partida e com liberação automática
    const linksAntes = config.TELAGEM_LINKS;
    config.TELAGEM_LINKS =
      'https://meet.google.com/aaa-bbbb-ccc, link-invalido ,https://meet.google.com/ddd-eeee-fff';
    assert.deepStrictEqual(telagem.pool(db, 'g-pool'), [
      'https://meet.google.com/aaa-bbbb-ccc',
      'https://meet.google.com/ddd-eeee-fff',
    ]);

    const poolA = partidas.criar(db, {
      guildId: 'g-pool',
      modo: 'x1mobile',
      preco: 100,
      gelo: 'normal',
      canalId: 'pool-canal-a',
      jogadores: [{ userId: 'q1', time: 1 }, { userId: 'q2', time: 2 }],
    });
    const poolB = partidas.criar(db, {
      guildId: 'g-pool',
      modo: 'x1mobile',
      preco: 100,
      gelo: 'normal',
      canalId: 'pool-canal-b',
      jogadores: [{ userId: 'q3', time: 1 }, { userId: 'q4', time: 2 }],
    });

    const reservaA = telagem.reservar(db, 'g-pool', `partida:${poolA.id}`);
    const reservaB = telagem.reservar(db, 'g-pool', `partida:${poolB.id}`);
    assert.ok(reservaA.url.startsWith('https://meet.google.com/'));
    assert.notStrictEqual(reservaA.url, reservaB.url, 'cada partida recebe um link diferente');
    assert.strictEqual(
      telagem.reservar(db, 'g-pool', `partida:${poolA.id}`).url,
      reservaA.url,
      'a mesma partida mantém o mesmo link',
    );
    assert.throws(() => telagem.reservar(db, 'g-pool', 'partida:inexistente'), /Google Meet/);

    // Partida finalizada devolve o link para o pool
    db.prepare("UPDATE partidas SET status = 'finalizada' WHERE id = ?").run(poolA.id);
    const reaproveitado = telagem.reservar(db, 'g-pool', 'canal:novo-canal');
    assert.strictEqual(reaproveitado.url, reservaA.url, 'link de partida encerrada volta a ser usado');

    assert.strictEqual(
      telagem.adicionarLink(db, 'g-pool', 'https://meet.google.com/ggg-hhhh-iii'),
      'https://meet.google.com/ggg-hhhh-iii',
    );
    assert.ok(telagem.pool(db, 'g-pool').includes('https://meet.google.com/ggg-hhhh-iii'));
    assert.strictEqual(telagem.removerLink(db, 'g-pool', 'https://meet.google.com/ggg-hhhh-iii'), 1);
    telagem.limparLinks(db, 'g-pool');
    config.TELAGEM_LINKS = linksAntes;
    passar('telagem: pool do Meet exclusivo por sala, com gestão e liberação automática');

    // /criar_telagem dentro da sala da partida
    const { client: clientTelagem, guild: guildTelagem } = ambienteFalso();
    const salaTelagem = await guildTelagem.channels.create({ name: 'fila-gelo-normal-050' });
    partidas.criar(db, {
      guildId: 'g1',
      modo: 'x1mobile',
      preco: 500,
      gelo: 'normal',
      canalId: salaTelagem.id,
      jogadores: [{ userId: 'u1', time: 1 }, { userId: 'u2', time: 2 }],
    });
    const comandoTelagem = fakeInteraction({
      commandName: 'criar_telagem',
      userId: 'med1',
      roles: ['cargo-med'],
      channel: salaTelagem,
      channelId: salaTelagem.id,
    });
    await comandos.executar(comandoTelagem, { db, client: clientTelagem });
    assert.strictEqual(salaTelagem.enviadas.length, 1);
    assert.ok(salaTelagem.enviadas[0].payload.embeds[0].toJSON().title.includes('Sala de Telagem'));
    passar('/criar_telagem: publica o painel com link da call no canal da partida');

    // /criar_telagem fora da partida: também funciona (sem falso negativo)
    const { client: clientAvulso, guild: guildAvulso } = ambienteFalso();
    const canalAvulso = await guildAvulso.channels.create({ name: 'telagem-staff' });
    const comandoAvulso = fakeInteraction({
      commandName: 'criar_telagem',
      userId: 'med1',
      roles: ['cargo-med'],
      channel: canalAvulso,
      channelId: canalAvulso.id,
    });
    await comandos.executar(comandoAvulso, { db, client: clientAvulso });
    assert.strictEqual(canalAvulso.enviadas.length, 1, 'publica o painel mesmo sem partida no canal');
    assert.ok(resposta(comandoAvulso).embeds[0].toJSON().description.includes('criada'));
    passar('/criar_telagem: funciona em qualquer canal da staff');

    // /criar_telagem exige um dos cargos configurados (Mediador/ADM)
    const semCargoTelagem = fakeInteraction({
      commandName: 'criar_telagem',
      userId: 'semcargo',
      guildId: 'g1',
      channel: canalAvulso,
      channelId: canalAvulso.id,
    });
    await comandos.executar(semCargoTelagem, { db, client: clientAvulso });
    assert.strictEqual(canalAvulso.enviadas.length, 1, 'nada publicado sem cargo');
    assert.ok(resposta(semCargoTelagem).embeds[0].toJSON().description.includes('cargos'));
    passar('/criar_telagem: bloqueia quem não tem cargo de mediador/ADM');

    // /criar_telagem reserva um link real do Meet por canal (pool)
    const { client: clientMeet, guild: guildMeet } = ambienteFalso();
    const meetA = await guildMeet.channels.create({ name: 'call-a' });
    const meetB = await guildMeet.channels.create({ name: 'call-b' });
    const poolAntes = config.TELAGEM_LINKS;
    config.TELAGEM_LINKS = 'https://meet.google.com/aaa-bbbb-ccc,https://meet.google.com/ddd-eeee-fff';

    const rodarTelagem = async (canal) => {
      const interacao = fakeInteraction({
        commandName: 'criar_telagem',
        userId: 'adm-meet',
        guildId: guildMeet.id,
        channel: canal,
        channelId: canal.id,
        roles: ['cargo-med'],
        perms: [PermissionsBitField.Flags.Administrator],
      });
      await comandos.executar(interacao, { db, client: clientMeet });
      return interacao;
    };

    await rodarTelagem(meetA);
    await rodarTelagem(meetB);
    const urlA = meetA.enviadas[0].payload.components[0].toJSON().components[0].url;
    const urlB = meetB.enviadas[0].payload.components[0].toJSON().components[0].url;
    assert.ok(urlA.startsWith('https://meet.google.com/'), urlA);
    assert.notStrictEqual(urlA, urlB, 'canais diferentes recebem links diferentes');

    await rodarTelagem(meetA);
    assert.strictEqual(
      meetA.enviadas[1].payload.components[0].toJSON().components[0].url,
      urlA,
      'o mesmo canal mantém o link reservado',
    );
    config.TELAGEM_LINKS = poolAntes;
    telagem.limparLinks(db, guildMeet.id);
    passar('/criar_telagem: pool do Meet fixa um link exclusivo por canal');

    // /verp
    const verp = fakeInteraction({ commandName: 'verp', options: { usuario: { id: 'u1', username: 'u1' } } });
    await comandos.executar(verp, { db, client: null });
    const placar = resposta(verp).embeds[0].toJSON();
    assert.ok(placar.title.includes('Placar'));
    assert.ok(placar.fields.some((campo) => campo.name.includes('Vitórias') && campo.value === '2'));
    assert.ok(placar.fields.some((campo) => campo.name.includes('Derrotas')));
    passar('/verp: placar de vitórias e derrotas do jogador');

    // /mediadores e /painel_mediadores (ADM)
    const comandoMediadores = fakeInteraction({
      commandName: 'mediadores',
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(comandoMediadores, { db, client: null });
    assert.ok(resposta(comandoMediadores).embeds[0].toJSON().title.includes('Módulo de Mediadores'));
    const semAdmConfig = fakeInteraction({ commandName: 'mediadores' });
    await comandos.executar(semAdmConfig, { db, client: null });
    assert.ok(resposta(semAdmConfig).embeds[0].toJSON().description.includes('ADM'));

    const canalPonto = {
      id: 'canal-ponto-bp',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalPonto.enviadas.push(payload);
        return { id: 'msg-ponto', async pin() {} };
      },
    };
    const comandoPainelMed = fakeInteraction({
      commandName: 'painel_mediadores',
      channel: canalPonto,
      channelId: canalPonto.id,
      perms: [PermissionsBitField.Flags.Administrator],
      options: { tipo: 'fila' },
    });
    await comandos.executar(comandoPainelMed, { db, client: null });
    assert.strictEqual(canalPonto.enviadas.length, 1);
    assert.ok(canalPonto.enviadas[0].embeds[0].toJSON().title.includes('Fila de Mediadores'));
    assert.strictEqual(require('../src/db').obterConfig(db, 'g1', 'canal_bateponto'), 'canal-ponto-bp');
    passar('/mediadores e /painel_mediadores: painel e plantão publicados pelo ADM');

    // card pago tem o botão de criar a sala pela Nix
    const partidaPaga = partidas.criar(db, {
      guildId: 'g1',
      modo: 'x1mobile',
      preco: 100,
      gelo: 'normal',
      canalId: 'canal-pago',
      jogadores: [{ userId: 'u1', time: 1 }, { userId: 'u2', time: 2 }],
    });
    partidas.confirmar(db, partidaPaga.id, 'u1');
    partidas.confirmar(db, partidaPaga.id, 'u2');
    partidas.assumir(db, partidaPaga.id, 'med1', 0.05);
    const paga = partidas.marcarPago(db, partidaPaga.id);
    const botoesPago = fluxo.componentesPartida(paga)[0].toJSON().components.map((botao) => botao.label);
    assert.deepStrictEqual(botoesPago, ['Criar sala (Nix)', 'Cancelar']);
    assert.strictEqual(salas.modoNix(paga), 'ap_padrao');
    passar('partida paga: botão "Criar sala (Nix)" no lugar de digitar ID/senha');
  }

  // ---------- comandos ----------
  {
    const definicoes = comandos.definicoes();
    const nomes = definicoes.map((comando) => comando.name);
    const obrigatorios = [
      'addgiros', 'addvitoria', 'ajuda', 'analista', 'anunciar', 'apostas', 'aux', 'blacklist',
      'boombot', 'conectar', 'convites', 'desconectar', 'enviar_dm', 'envio_massa', 'limpar',
      'limpardm', 'logs', 'loja', 'painel', 'painel_mediador', 'perfil', 'pix', 'ranking',
      'receita_mediadores', 'registrar_pix', 'ssemu', 'ssmob', 'temu', 'ticket', 'ticketfixo',
      'vencedor', 'vitoria', 'wo', 'nix', 'botperfil', 'setbot',
      'criar_telagem', 'verp', 'mediadores', 'painel_mediadores', 'go',
      'anunciar2', 'conectarbotcall', 'tirarbotcall', 'telagem_links',
    ];
    for (const nome of obrigatorios) {
      assert.ok(nomes.includes(nome), `faltou o comando /${nome}`);
    }
    const paineisEsperados = config.MODOS.map((modo) => modo.comando);
    for (const nome of paineisEsperados) {
      assert.ok(nomes.includes(nome), `faltou o painel /${nome}`);
    }
    assert.strictEqual(nomes.length, 60);
    assert.strictEqual(new Set(nomes).size, 60, 'nome de comando repetido');
    passar('comandos: 60 registrados (45 gerais + 15 painéis), sem repetição');

    const comandoNix = definicoes.find((comando) => comando.name === 'nix');
    assert.deepStrictEqual(
      comandoNix.options.map((opcao) => opcao.name).sort(),
      ['chutar', 'criarsala', 'iniciar', 'jogador', 'liberar', 'resultado', 'status', 'statussala'],
    );
    passar('comandos: /nix com os 8 subcomandos da API de salas');

    // Automação da Nix exige cargo configurado no módulo de mediadores
    const nixSemCargo = fakeInteraction({ commandName: 'nix', options: { sub: 'criarsala' }, guildId: 'g1' });
    await comandos.executar(nixSemCargo, { db, client: null });
    assert.ok(resposta(nixSemCargo).embeds[0].toJSON().description.includes('cargos'));
    passar('/nix criarsala: sem cargo configurado é bloqueado');

    const blacklistComando = definicoes.find((comando) => comando.name === 'blacklist');
    assert.deepStrictEqual(
      blacklistComando.options.map((opcao) => opcao.name).sort(),
      ['adicionar', 'listar', 'remover'],
    );
    const loja = definicoes.find((comando) => comando.name === 'loja');
    assert.deepStrictEqual(
      loja.options.map((opcao) => opcao.name).sort(),
      ['addcoins', 'enviar', 'removecoins'],
    );
    passar('comandos: subcomandos de blacklist e loja corretos');

    // /registrar_pix com permissão
    const it = fakeInteraction({
      commandName: 'registrar_pix',
      options: { chave: 'pix@teste.com', titular: 'Teste', comissao: 10 },
      perms: [MANAGE_GUILD],
    });
    await comandos.executar(it, { db, client: { channels: { cache: new Collection(), fetch: async () => null } } });
    const registroTeste = staff.obter(db, 'g1', 'u1');
    assert.strictEqual(registroTeste.pix_chave, 'pix@teste.com');
    assert.strictEqual(registroTeste.comissao, 0.1);
    assert.strictEqual(it.chamadas.deferReply.flags, 64, 'deferReply efêmero imediato');
    assert.ok(resposta(it).embeds || resposta(it).content);
    passar('/registrar_pix: deferReply imediato, salva chave e converte comissão');

    // /registrar_pix sem cargo
    const semPermissao = fakeInteraction({ commandName: 'registrar_pix', options: { chave: 'x@y.com' } });
    await comandos.executar(semPermissao, { db, client: { channels: { cache: new Collection(), fetch: async () => null } } });
    assert.ok(resposta(semPermissao).embeds[0].toJSON().description.includes('staff'));
    passar('/registrar_pix: bloqueia quem não é staff');

    // /ajuda e /perfil
    const ajuda = fakeInteraction({ commandName: 'ajuda' });
    await comandos.executar(ajuda, { db, client: null });
    assert.ok(resposta(ajuda).embeds[0].toJSON().description.includes('painel_mediador'));
    const perfil = fakeInteraction({ commandName: 'perfil' });
    await comandos.executar(perfil, { db, client: null });
    assert.ok(resposta(perfil).embeds[0].toJSON().title.includes('u1'));
    passar('/ajuda e /perfil respondem com embed');

    // /loja addcoins exige ADM e credita
    const lojaAdmin = fakeInteraction({
      commandName: 'loja',
      options: { sub: 'addcoins', usuario: { id: 'u9' }, quantidade: 250 },
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(lojaAdmin, { db, client: { channels: { cache: new Collection(), fetch: async () => null } } });
    assert.strictEqual(usuarios.obter(db, 'g1', 'u9').coins, 250);
    passar('/loja addcoins: credita moedas para ADM');

    // /vencedor sem permissão
    const vencedorSemPermissao = fakeInteraction({ commandName: 'vencedor', options: { time: 1 } });
    await comandos.executar(vencedorSemPermissao, { db, client: null });
    assert.strictEqual(vencedorSemPermissao.chamadas.deferReply.flags, undefined, '/vencedor responde público');
    assert.ok(resposta(vencedorSemPermissao).embeds[0].toJSON().description.includes('mediadores'));
    passar('/vencedor: bloqueia quem não é mediador');

    // /boombot status
    const status = fakeInteraction({ commandName: 'boombot', options: { sub: 'status' } });
    await comandos.executar(status, {
      db,
      client: { ws: { ping: 42 }, guilds: { cache: new Collection() } },
    });
    assert.ok(resposta(status).embeds[0].toJSON().title.includes('Status'));
    passar('/boombot status: mostra saúde do bot');

    // /boombot setcategoria: categoria onde as salas de AP nascem
    const setcategoria = fakeInteraction({
      commandName: 'boombot',
      options: { sub: 'setcategoria', categoria: { id: 'cat-filas-ap', name: 'FILAS AP' } },
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(setcategoria, {
      db,
      client: { ws: { ping: 1 }, guilds: { cache: new Collection() } },
    });
    assert.strictEqual(require('../src/db').obterConfig(db, 'g1', 'categoria_filas', null), 'cat-filas-ap');
    passar('/boombot setcategoria: salva a CATEGORIA das salas de AP');

    // /anunciar2: anúncio simples direto no canal atual
    const canalAnuncio2 = {
      id: 'canal-anuncio2',
      name: 'avisos',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalAnuncio2.enviadas.push(payload);
        return { id: 'msg-an2' };
      },
    };
    const anuncio2 = fakeInteraction({
      commandName: 'anunciar2',
      options: { texto: 'Servidor em manutenção às 22h.' },
      channel: canalAnuncio2,
      channelId: canalAnuncio2.id,
      perms: [PermissionsBitField.Flags.ManageGuild],
    });
    await comandos.executar(anuncio2, { db, client: null });
    assert.strictEqual(canalAnuncio2.enviadas.length, 1);
    const embedAnuncio2 = canalAnuncio2.enviadas[0].embeds[0].toJSON();
    assert.ok(embedAnuncio2.title.includes('Anúncio'));
    assert.strictEqual(embedAnuncio2.description, 'Servidor em manutenção às 22h.');
    assert.ok(embedAnuncio2.footer.text.includes('ORG Royal AP'));
    passar('/anunciar2: texto no mesmo embed elegante do /anunciar');

    // Voz: sem conexão ativa, /tirarbotcall responde sem travar
    const tirarCall = fakeInteraction({
      commandName: 'tirarbotcall',
      perms: [PermissionsBitField.Flags.ManageGuild],
    });
    tirarCall.guild = { id: 'g1' };
    await comandos.executar(tirarCall, { db, client: null });
    assert.ok(resposta(tirarCall).content.includes('não está'), JSON.stringify(resposta(tirarCall)));
    passar('/tirarbotcall: responde quando o bot não está em call');

    // Voz: /conectarbotcall sem canal é bloqueado com aviso
    const conectarSemCanal = fakeInteraction({
      commandName: 'conectarbotcall',
      options: { canal: null },
      perms: [PermissionsBitField.Flags.ManageGuild],
    });
    conectarSemCanal.guild = { id: 'g1', voiceAdapterCreator: {} };
    await comandos.executar(conectarSemCanal, { db, client: null });
    assert.ok(resposta(conectarSemCanal).embeds[0].toJSON().description.includes('canal de voz'));
    passar('/conectarbotcall: exige um canal de voz');

    // /botperfil: painel ADM para trocar nome, avatar, descrição e status
    const botperfil = fakeInteraction({
      commandName: 'botperfil',
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(botperfil, { db, client: null });
    assert.deepStrictEqual(
      resposta(botperfil).components[0].toJSON().components.map((botao) => botao.custom_id),
      ['ap:botnome', 'ap:botavatar', 'ap:botdescricao', 'ap:botstatus'],
    );
    assert.strictEqual(resposta(botperfil).flags & 64, 64, 'painel só para o ADM');
    const semAdmPerfil = fakeInteraction({ commandName: 'botperfil' });
    await comandos.executar(semAdmPerfil, { db, client: null });
    assert.ok(resposta(semAdmPerfil).embeds[0].toJSON().description.includes('ADM'));
    passar('/botperfil: só ADM recebe o painel de nome/avatar/descrição/status');

    // modais do /botperfil aplicam no perfil do bot
    const clientePerfil = {
      user: {
        id: 'bot',
        async setUsername(nome) {
          clientePerfil.nome = nome;
        },
        async setAvatar(url) {
          clientePerfil.avatar = url;
        },
        setPresence(presenca) {
          clientePerfil.presenca = presenca;
        },
      },
      application: {
        async edit(dados) {
          clientePerfil.app = dados;
        },
      },
    };
    const { handleModal } = require('../src/interacoes/modais');
    const modalNome = fakeInteraction({ perms: [PermissionsBitField.Flags.Administrator] });
    modalNome.customId = 'ap:modalbotnome';
    modalNome.fields = { getTextInputValue: () => 'Royal AP Bot' };
    await handleModal(modalNome, { db, client: clientePerfil });
    assert.strictEqual(clientePerfil.nome, 'Royal AP Bot');

    const modalDescricao = fakeInteraction({ perms: [PermissionsBitField.Flags.Administrator] });
    modalDescricao.customId = 'ap:modalbotdescricao';
    modalDescricao.fields = { getTextInputValue: () => 'Filas e apostas da ORG' };
    await handleModal(modalDescricao, { db, client: clientePerfil });
    assert.strictEqual(clientePerfil.app.description, 'Filas e apostas da ORG');
    passar('/botperfil: modal grava nome e descrição no bot sem token');

    // /ticket: Central de Atendimento efêmera, apaga em 15s
    const ticket = fakeInteraction({ commandName: 'ticket' });
    await comandos.executar(ticket, { db, client: null });
    assert.strictEqual(ticket.chamadas.deferReply.flags, 64, 'deferReply efêmero antes do painel');
    assert.strictEqual(resposta(ticket).flags, 64);
    assert.deepStrictEqual(
      resposta(ticket).components[0].toJSON().components.map((botao) => botao.label),
      ['Suporte', 'Reembolso', 'Resgatar Evento', 'Vagas', 'Divulgação'],
    );
    assert.ok(ticket.__expiraTicket, 'timer de 15s agendado');
    clearTimeout(ticket.__expiraTicket);
    passar('/ticket: painel efêmero com 5 setores e expiração de 15s');

    // /aux desativado de propósito
    const aux = fakeInteraction({ commandName: 'aux' });
    await comandos.executar(aux, { db, client: null });
    assert.ok(resposta(aux).content.includes('/ticket'));
    assert.strictEqual(resposta(aux).flags, 64);
    passar('/aux: só orienta a usar /ticket (não abre ticket)');

    // /ticketfixo: bloqueia quem não é ADM
    const fixoSemPermissao = fakeInteraction({ commandName: 'ticketfixo' });
    await comandos.executar(fixoSemPermissao, { db, client: null });
    assert.ok(resposta(fixoSemPermissao), 'respondeu negando');
    passar('/ticketfixo: bloqueia quem não é ADM');

    // /ticketfixo: publica no canal para ADM
    const canalFixo = {
      id: 'canal-fixo',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalFixo.enviadas.push(payload);
        return { id: 'msg-central' };
      },
    };
    const fixo = fakeInteraction({
      commandName: 'ticketfixo',
      channel: canalFixo,
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(fixo, { db, client: null });
    assert.strictEqual(canalFixo.enviadas.length, 1);
    assert.strictEqual(canalFixo.enviadas[0].components[0].toJSON().components.length, 5);
    passar('/ticketfixo: publica a Central de Atendimento permanente');

    // Abertura de ticket: canal privado DENTRO da categoria configurada
    const { client: clientTicket, guild: guildTicket } = ambienteFalso();
    const categoriaTickets = { id: 'cat-tickets', name: 'ATENDIMENTO', type: ChannelType.GuildCategory };
    guildTicket.channels.cache.set(categoriaTickets.id, categoriaTickets);
    guildTicket.channels.fetch = async (id) => guildTicket.channels.cache.get(id) ?? null;

    const cfg = require('../src/config');
    const categoriaAntiga = cfg.CATEGORY_TICKETS_ID;
    cfg.CATEGORY_TICKETS_ID = 'cat-tickets';

    const aberto = await tickets.abrirTicket(
      { guild: guildTicket, guildId: 'g1', user: { id: 'j9', username: 'jogador9', tag: 'jogador9#1' } },
      { db, client: clientTicket, tipo: 'vagas' },
    );
    cfg.CATEGORY_TICKETS_ID = categoriaAntiga;

    assert.strictEqual(aberto.canal.name, 'vagas-jogador9');
    assert.strictEqual(aberto.existente, false);
    assert.strictEqual(aberto.canal.parentId, 'cat-tickets', 'canal criado dentro da categoria de tickets');
    assert.strictEqual(aberto.link, `<#${aberto.canal.id}>`);
    const boasVindas = aberto.canal.enviadas[0].payload;
    assert.ok(boasVindas.content.includes('<@j9>'), 'marca o jogador no ticket');
    assert.ok(boasVindas.embeds[0].toJSON().description.includes('Nick'));
    passar('ticket: canal na categoria certa, jogador marcado e link devolvido');

    // Sem CATEGORY_TICKETS_ID o ticket NUNCA cai na categoria das filas
    const { client: clientSem, guild: guildSem } = ambienteFalso();
    guildSem.channels.cache.set('cat-filas', {
      id: 'cat-filas',
      name: 'filas aqui',
      type: ChannelType.GuildCategory,
    });
    // categoria "de atendimento" no servidor: mesmo assim NÃO pode ser usada
    guildSem.channels.cache.set('cat-suporte', {
      id: 'cat-suporte',
      name: 'suporte',
      type: ChannelType.GuildCategory,
    });
    guildSem.channels.fetch = async (id) => guildSem.channels.cache.get(id) ?? null;
    const suporteAntigo = cfg.CATEGORIA_SUPORTE_ID;
    cfg.CATEGORY_TICKETS_ID = '';
    cfg.CATEGORIA_SUPORTE_ID = '';
    const semCategoria = await tickets.abrirTicket(
      { guild: guildSem, guildId: 'g1', user: { id: 'j8', username: 'jogador8', tag: 'jogador8#1' } },
      { db, client: clientSem, tipo: 'suporte' },
    );
    cfg.CATEGORY_TICKETS_ID = categoriaAntiga;
    cfg.CATEGORIA_SUPORTE_ID = suporteAntigo;
    assert.strictEqual(semCategoria.canal.parentId, null, 'não invade categoria de filas nem "suporte"');
    passar('ticket: sem ID configurado não cai em categoria aleatória');

    // Ticket com ID de CANAL (modo antigo): usa a CATEGORIA onde o canal está
    const { client: clientRef, guild: guildRef } = ambienteFalso();
    const catRef = { id: 'cat-ref', name: 'ATENDIMENTO', type: ChannelType.GuildCategory };
    guildRef.channels.cache.set(catRef.id, catRef);
    const canalRef = {
      id: 'canal-referencia',
      name: '🎫・ABRIR-TICKET',
      type: ChannelType.GuildText,
      parentId: catRef.id,
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalRef.enviadas.push(payload);
        return { id: `msg-ref-${canalRef.enviadas.length}` };
      },
    };
    guildRef.channels.cache.set(canalRef.id, canalRef);
    guildRef.channels.fetch = async (id) => guildRef.channels.cache.get(id) ?? null;

    const destinoAntigo = cfg.TICKET_DESTINO_ID;
    cfg.CATEGORY_TICKETS_ID = '';
    cfg.CATEGORIA_SUPORTE_ID = '';
    cfg.TICKET_DESTINO_ID = 'canal-referencia';
    const porCanal = await tickets.abrirTicket(
      { guild: guildRef, guildId: 'g1', user: { id: 'j5', username: 'jogador5', tag: 'jogador5#1' } },
      { db, client: clientRef, tipo: 'suporte' },
    );
    cfg.CATEGORY_TICKETS_ID = categoriaAntiga;
    cfg.CATEGORIA_SUPORTE_ID = suporteAntigo;
    cfg.TICKET_DESTINO_ID = destinoAntigo;

    assert.strictEqual(porCanal.canal.parentId, 'cat-ref', 'ticket nasce na categoria do canal informado');
    assert.strictEqual(canalRef.enviadas.length, 0, 'nada é enviado no chat geral');
    passar('ticket: ID de canal aponta para a categoria dele, sem mensagem pública');

    // Botão do painel cria o ticket e devolve o link direto
    const cliqueTicket = fakeInteraction({ commandName: undefined, userId: 'j7' });
    cliqueTicket.customId = 'ap:ticket:suporte';
    cliqueTicket.isButton = () => true;
    cliqueTicket.guild = guildTicket;
    cfg.CATEGORY_TICKETS_ID = 'cat-tickets';
    await require('../src/interacoes/botoes').handleBotao(cliqueTicket, { db, client: clientTicket });
    cfg.CATEGORY_TICKETS_ID = categoriaAntiga;
    // o ambiente falso guarda os canais criados na coleção do client
    const canalDoClique = clientTicket.channels.cache.find((canal) => canal.name === 'suporte-j7');
    assert.ok(canalDoClique, 'canal do ticket criado pelo botão');
    assert.strictEqual(canalDoClique.parentId, 'cat-tickets');
    assert.ok(
      cliqueTicket.chamadas.followUp.content.includes(
        `Seu ticket foi criado com sucesso! Acesse: <#${canalDoClique.id}>`,
      ),
      'resposta aponta para o canal criado',
    );
    assert.strictEqual(cliqueTicket.chamadas.followUp.flags & 64, 64, 'resposta efêmera');
    assert.deepStrictEqual(
      cliqueTicket.chamadas.followUp.components[0].toJSON().components.map((botao) => botao.label),
      ['Ignorar mensagem'],
    );
    passar('ticket: botão cria o canal na categoria e devolve o link');

    // botão "Ignorar mensagem" apaga o aviso temporário
    const ignorar = fakeInteraction({ commandName: undefined, userId: 'j7' });
    ignorar.customId = 'ap:ignorarticket';
    ignorar.isButton = () => true;
    ignorar.guild = guildTicket;
    await require('../src/interacoes/botoes').handleBotao(ignorar, { db, client: clientTicket });
    assert.strictEqual(ignorar.chamadas.deleteReply, true, 'apaga o aviso efêmero');
    passar('ticket: botão "Ignorar mensagem" apaga o aviso temporário');

    // /pix dentro da sala: mediador manda a chave pelo comando
    const pixCanal = {
      id: 'canal-pix',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        pixCanal.enviadas.push(payload);
        return { id: 'msg-pix' };
      },
    };
    const clientePix = {
      channels: {
        cache: new Collection([['canal-pix', pixCanal]]),
        async fetch(id) {
          return id === 'canal-pix' ? pixCanal : null;
        },
      },
    };
    const partidaPix = partidas.criar(db, {
      guildId: 'g1',
      modo: 'x1mobile',
      preco: 500,
      gelo: 'infinito',
      canalId: 'canal-pix',
      jogadores: [{ userId: 'u1', time: 1 }, { userId: 'u2', time: 2 }],
    });
    partidas.confirmar(db, partidaPix.id, 'u1');
    partidas.confirmar(db, partidaPix.id, 'u2');
    partidas.assumir(db, partidaPix.id, 'u1', 0.05);
    staff.registrarPix(db, { guildId: 'g1', userId: 'u1', chave: 'pix@sala', titular: 'U1' });

    const pix = fakeInteraction({
      commandName: 'pix',
      userId: 'u1',
      channelId: 'canal-pix',
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(pix, { db, client: clientePix });
    assert.strictEqual(partidas.buscar(db, partidaPix.id).pix_chave, 'pix@sala');
    assert.ok(pixCanal.enviadas.length >= 1, 'PIX publicado na sala');
    passar('/pix: mediador envia a chave na sala pelo comando');

    // /pix em QUALQUER canal: acha a sala ativa do próprio mediador
    db.prepare("UPDATE partidas SET status = 'finalizada' WHERE id = ?").run(partidaPix.id);
    const partidaFora = partidas.criar(db, {
      guildId: 'g1',
      modo: 'x1mobile',
      preco: 300,
      gelo: 'normal',
      canalId: 'canal-pix-fora',
      jogadores: [{ userId: 'u3', time: 1 }, { userId: 'u4', time: 2 }],
    });
    partidas.confirmar(db, partidaFora.id, 'u3');
    partidas.confirmar(db, partidaFora.id, 'u4');
    partidas.assumir(db, partidaFora.id, 'u1', 0.05);
    staff.registrarPix(db, { guildId: 'g1', userId: 'u1', chave: 'pix@fora', titular: 'U1' });

    const pixFora = fakeInteraction({
      commandName: 'pix',
      userId: 'u1',
      channelId: 'canal-aleatorio',
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(pixFora, { db, client: clientePix });
    assert.strictEqual(partidas.buscar(db, partidaFora.id).pix_chave, 'pix@fora');
    passar('/pix: funciona fora do canal da sala (usa a sala ativa do mediador)');

    // /filasx1mobile: deferReply imediato + 15 mensagens da fila publicadas
    const canalPainel = {
      id: 'canal-painel',
      name: 'ap-1x1',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalPainel.enviadas.push(payload);
        return { id: 'msg-painel' };
      },
    };
    const clientePainel = { channels: { cache: new Collection(), fetch: async () => null } };
    const comandoPainel = fakeInteraction({
      commandName: 'filasx1mobile',
      channel: canalPainel,
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(comandoPainel, { db, client: clientePainel });
    assert.strictEqual(comandoPainel.chamadas.deferReply.flags, 64, 'respondeu antes de montar o painel');
    assert.strictEqual(canalPainel.enviadas.length, 15, '15 mensagens da fila publicadas');
    assert.strictEqual(clientePainel.channels.cache.size, 0, 'o comando NÃO cria canal novo');
    assert.ok(canalPainel.enviadas[0].embeds[0].toJSON().title.includes('R$ 100,00'), 'maior aposta no topo');
    assert.ok(canalPainel.enviadas[14].embeds[0].toJSON().title.includes('R$ 0,50'), 'menor aposta na última');
    assert.ok(resposta(comandoPainel).embeds[0].toJSON().description.includes('15 mensagens'));
    passar('/filasx1mobile: deferReply em <3s + 15 mensagens da fila (menor valor embaixo)');

    // Botão: ack instantâneo com deferUpdate + resposta em followUp
    const { handleBotao } = require('../src/interacoes/botoes');
    const botaoComo = fakeInteraction({ commandName: undefined });
    botaoComo.customId = 'ap:como';
    botaoComo.isButton = () => true;
    const tratado = await handleBotao(botaoComo, { db, client: null });
    assert.strictEqual(tratado, true);
    assert.strictEqual(botaoComo.chamadas.deferUpdate, true, 'deferUpdate antes de qualquer envio');
    assert.ok(botaoComo.chamadas.followUp.embeds[0].toJSON().title.includes('Como funciona'));
    passar('botão: deferUpdate imediato e resposta sem "Interaction Failed"');

    // Servidor HTTP de saúde (Render)
    const { criarServidor } = require('../src/servidor');
    const http = require('http');
    const servidor = criarServidor();
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    const porta = servidor.address().port;
    const saude = await new Promise((ok, falha) => {
      http
        .get({ host: '127.0.0.1', port: porta, path: '/' }, (res) => {
          let corpo = '';
          res.setEncoding('utf8');
          res.on('data', (pedaco) => {
            corpo += pedaco;
          });
          res.on('end', () => ok({ codigo: res.statusCode, corpo }));
        })
        .on('error', falha);
    });
    await new Promise((ok) => servidor.close(ok));
    assert.strictEqual(saude.codigo, 200);
    assert.ok(saude.corpo.includes('Royal AP Online e Operante'));
    passar('servidor HTTP: responde 200 na porta do Render');
  }

  // ---------- tickets: categoria OU canal de texto ----------
  {
    const { client: clientCanal, guild: guildCanal } = ambienteFalso();
    const categoria = { id: 'cat-atendimento', name: 'ATENDIMENTO', type: ChannelType.GuildCategory };
    const avisos = [];
    const canalTexto = {
      id: 'canal-atendimento',
      name: 'abrir-ticket',
      type: ChannelType.GuildText,
      parentId: categoria.id,
      isTextBased: () => true,
      async send(payload) {
        avisos.push(payload);
        return { id: `aviso-${avisos.length}` };
      },
    };
    guildCanal.channels.cache.set(categoria.id, categoria);
    guildCanal.channels.cache.set(canalTexto.id, canalTexto);
    guildCanal.channels.fetch = async (id) => guildCanal.channels.cache.get(id) ?? null;

    const cfg2 = require('../src/config');
    const antesCategoria = cfg2.CATEGORY_TICKETS_ID;
    // ID de CANAL na variável de categoria: tem que funcionar sem travar
    cfg2.CATEGORY_TICKETS_ID = 'canal-atendimento';
    const porCanal = await tickets.abrirTicket(
      { guild: guildCanal, guildId: 'g1', user: { id: 'j10', username: 'jogador10', tag: 'jogador10#1' } },
      { db, client: clientCanal, tipo: 'suporte' },
    );
    cfg2.CATEGORY_TICKETS_ID = antesCategoria;

    assert.strictEqual(porCanal.canal.parentId, 'cat-atendimento', 'ticket dentro da categoria do canal');
    assert.strictEqual(avisos.length, 0, 'nenhuma mensagem pública no chat geral');
    passar('ticket: aceita ID de CANAL e usa a categoria dele, sem aviso público');

    // /boombot setticket salva a preferência no banco
    const setticket = fakeInteraction({
      commandName: 'boombot',
      options: { sub: 'setticket', destino: { id: 'cat-config', name: 'TICKETS', type: ChannelType.GuildCategory } },
      perms: [PermissionsBitField.Flags.Administrator],
    });
    await comandos.executar(setticket, { db, client: null });
    assert.strictEqual(require('../src/db').obterConfig(db, 'g1', 'categoria_tickets'), 'cat-config');
    assert.ok(resposta(setticket).embeds[0].toJSON().description.includes('TICKETS'));
    passar('/boombot setticket: guarda a CATEGORIA dos tickets no banco');

    // CATEGORY_TICKETS_ID (env) vence a categoria salva no banco
    const { client: clientPrior, guild: guildPrior } = ambienteFalso();
    const catEnv = { id: 'cat-env', name: 'TICKETS-ENV', type: ChannelType.GuildCategory };
    const catBanco = { id: 'cat-antiga', name: 'TICKETS-BANCO', type: ChannelType.GuildCategory };
    guildPrior.channels.cache.set(catEnv.id, catEnv);
    guildPrior.channels.cache.set(catBanco.id, catBanco);
    guildPrior.channels.fetch = async (id) => guildPrior.channels.cache.get(id) ?? null;
    require('../src/db').definirConfig(db, 'g1', 'categoria_tickets', 'cat-antiga');

    const cfg3 = require('../src/config');
    const antesEnv = cfg3.CATEGORY_TICKETS_ID;
    cfg3.CATEGORY_TICKETS_ID = 'cat-env';
    const prioritario = await tickets.abrirTicket(
      { guild: guildPrior, guildId: 'g1', user: { id: 'j11', username: 'jogador11', tag: 'jogador11#1' } },
      { db, client: clientPrior, tipo: 'suporte' },
    );
    cfg3.CATEGORY_TICKETS_ID = antesEnv;

    assert.strictEqual(prioritario.canal.parentId, 'cat-env', 'env vence a categoria do banco');
    passar('ticket: CATEGORY_TICKETS_ID (env) vence a categoria do banco');
  }

  // ---------- integração Nix FF ----------
  {
    const nix = require('../src/servicos/nix');
    const fetchOriginal = global.fetch;
    const pedidos = [];
    process.env.NIX_API_KEY = 'nix_sk_teste';
    process.env.NIX_API_URL = 'https://salas.exemplo.test';

    global.fetch = async (url, opcoes) => {
      pedidos.push({ url, opcoes });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ session_id: 'sess1', room_id: 947072, password: '1234', invite_link: 'https://ffshare.exemplo' }),
      };
    };

    const sala = await nix.criarSala({ senha: '1234', delayMinutos: 10, modo: 'gelo_inf' });
    assert.strictEqual(sala.room_id, 947072);
    assert.strictEqual(pedidos[0].url, 'https://salas.exemplo.test/rooms');
    assert.strictEqual(pedidos[0].opcoes.method, 'POST');
    assert.strictEqual(pedidos[0].opcoes.headers.Authorization, 'Bearer nix_sk_teste');
    assert.strictEqual(JSON.parse(pedidos[0].opcoes.body).config_type, 'gelo_inf');
    passar('nix: cria sala (POST /rooms) com a chave do ambiente');

    await assert.rejects(() => nix.criarSala({ senha: '' }), /senha/i);
    await assert.rejects(() => nix.criarSala({ senha: '1234', delayMinutos: 30 }), /1 a 10/);
    await assert.rejects(() => nix.criarSala({ senha: '1234', modo: 'inventado' }), /Modo inválido/);
    assert.throws(() => nix.jogador('abc'), /UID/);
    assert.strictEqual(pedidos.length, 1, 'nada inválido chegou a virar requisição');
    passar('nix: valida senha, tempo, modo e UID antes de gastar requisição');

    global.fetch = async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ detail: 'Token invalido' }) });
    await assert.rejects(() => nix.saldo(), /401/);
    global.fetch = async () => ({ ok: false, status: 402, text: async () => '{}' });
    await assert.rejects(() => nix.criarSala({ senha: '1234' }), /402|Saldo/i);

    const chaveAntes = process.env.NIX_API_KEY;
    process.env.NIX_API_KEY = '';
    await assert.rejects(() => nix.saldo(), /NIX_API_KEY/);
    process.env.NIX_API_KEY = chaveAntes;

    global.fetch = fetchOriginal;
    delete process.env.NIX_API_URL;
    passar('nix: 401/402 e chave ausente viram mensagens claras em português');
  }

  // ---------- /go ----------
  {
    const db5 = abrirBanco(path.join(pasta, 'go.db'));
    const criarGo = (canalId, a, b) =>
      partidas.criar(db5, {
        guildId: 'g1',
        modo: 'x1mobile',
        preco: 100,
        gelo: 'normal',
        canalId,
        jogadores: [{ userId: a, time: 1 }, { userId: b, time: 2 }],
      });
    const pGo = criarGo('canal-go', 'ga', 'gb');
    partidas.confirmar(db5, pGo.id, 'ga');
    partidas.confirmar(db5, pGo.id, 'gb');
    partidas.assumir(db5, pGo.id, 'med1', 0.05);
    partidas.marcarPago(db5, pGo.id);
    partidas.liberarSala(db5, pGo.id, { salaId: '87654321', senha: 'xyz' });

    assert.throws(() => partidas.darGo(db5, { partidaId: pGo.id, userId: 'fora' }), /não está nessa partida/);
    const go1 = partidas.darGo(db5, { partidaId: pGo.id, userId: 'ga' });
    assert.strictEqual(go1.iniciou, false);
    assert.strictEqual(partidas.buscar(db5, pGo.id).status, 'sala_liberada');

    const go2 = partidas.darGo(db5, { partidaId: pGo.id, userId: 'gb' });
    assert.strictEqual(go2.iniciou, true);
    assert.strictEqual(partidas.buscar(db5, pGo.id).status, 'em_andamento');
    assert.strictEqual(partidas.darGo(db5, { partidaId: pGo.id, userId: 'gb' }).iniciou, false);
    passar('/go: só inicia com os dois jogadores e nunca dispara duas vezes');

    // Comando: anúncio público no canal da partida e aviso dos 3 segundos
    const canalGo = {
      id: 'canal-go2',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalGo.enviadas.push(payload);
        return { id: `msg-go-${canalGo.enviadas.length}`, async edit() { return null; } };
      },
    };
    const clienteGo = {
      channels: {
        cache: new Collection([['canal-go2', canalGo]]),
        async fetch() {
          return canalGo;
        },
      },
    };
    const pGo2 = criarGo('canal-go2', 'gc', 'gd');
    partidas.confirmar(db5, pGo2.id, 'gc');
    partidas.confirmar(db5, pGo2.id, 'gd');
    partidas.assumir(db5, pGo2.id, 'med1', 0.05);
    partidas.marcarPago(db5, pGo2.id);
    partidas.liberarSala(db5, pGo2.id, { salaId: '11223344', senha: 'abc', sessao: 'sess-go-1' });

    const iGo1 = fakeInteraction({ commandName: 'go', userId: 'gc', channelId: 'canal-go2', channel: canalGo });
    await comandos.executar(iGo1, { db: db5, client: clienteGo });
    assert.ok(canalGo.enviadas.some((payload) => String(payload.content).includes('deu GO')));
    assert.strictEqual(partidas.buscar(db5, pGo2.id).status, 'sala_liberada');

    // O GO precisa dar start REAL na sala da Nix (sem esperar os 10 min).
    const fetchAntesGo = global.fetch;
    const chaveAntesGo = process.env.NIX_API_KEY;
    const pedidosGo = [];
    process.env.NIX_API_KEY = 'nix_sk_go';
    global.fetch = async (url, opcoes) => {
      pedidosGo.push({ url, metodo: opcoes?.method });
      return { ok: true, status: 200, text: async () => '{}' };
    };

    const iGo2 = fakeInteraction({ commandName: 'go', userId: 'gd', channelId: 'canal-go2', channel: canalGo });
    await comandos.executar(iGo2, { db: db5, client: clienteGo });
    assert.strictEqual(partidas.buscar(db5, pGo2.id).status, 'em_andamento');
    assert.ok(
      canalGo.enviadas.some((payload) =>
        String(payload.content).includes('Os dois jogadores estão prontos! A partida irá iniciar em 3 segundos.'),
      ),
    );
    assert.ok(
      pedidosGo.some((pedido) => pedido.metodo === 'POST' && pedido.url.endsWith('/rooms/sess-go-1/start')),
      'a sala foi iniciada na Nix no segundo GO',
    );
    global.fetch = fetchAntesGo;
    process.env.NIX_API_KEY = chaveAntesGo ?? '';
    passar('/go: comando anuncia o GO, avisa os 3 segundos e inicia a sala na Nix');

    // /go digitado no canal da fila: anuncia só na sala privada da partida.
    const canalGo3 = {
      id: 'canal-go3',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalGo3.enviadas.push(payload);
        return { id: `g3-${canalGo3.enviadas.length}`, async edit() { return null; } };
      },
    };
    const canalFilaGo = {
      id: 'canal-fila-go',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalFilaGo.enviadas.push(payload);
        return { id: `fila-${canalFilaGo.enviadas.length}` };
      },
    };
    const clienteGo3 = {
      channels: {
        cache: new Collection([['canal-go3', canalGo3], ['canal-fila-go', canalFilaGo]]),
        async fetch(id) {
          return id === 'canal-go3' ? canalGo3 : id === 'canal-fila-go' ? canalFilaGo : null;
        },
      },
    };
    const pGo3 = criarGo('canal-go3', 'ge', 'gf');
    partidas.confirmar(db5, pGo3.id, 'ge');
    partidas.confirmar(db5, pGo3.id, 'gf');
    partidas.assumir(db5, pGo3.id, 'med1', 0.05);
    partidas.marcarPago(db5, pGo3.id);
    partidas.liberarSala(db5, pGo3.id, { salaId: '55667788', senha: 'abc' });

    const iFila = fakeInteraction({
      commandName: 'go',
      userId: 'ge',
      channelId: 'canal-fila-go',
      channel: canalFilaGo,
    });
    await comandos.executar(iFila, { db: db5, client: clienteGo3 });
    assert.strictEqual(partidas.buscar(db5, pGo3.id).status, 'sala_liberada');
    assert.ok(canalGo3.enviadas.some((payload) => String(payload.content).includes('deu GO')));
    assert.strictEqual(
      canalFilaGo.enviadas.filter((payload) => String(payload.content).includes('deu GO')).length,
      0,
      'o canal público da fila não recebe o anúncio',
    );
    passar('/go: funciona digitado no canal da fila e anuncia só na sala privada da partida');

    db5.close();
  }

  // ---------- painel se recupera sozinho ----------
  {
    const db6 = abrirBanco(path.join(pasta, 'painel.db'));
    const { client } = ambienteFalso();
    const guildPainel = {
      id: 'g1',
      roles: { everyone: { id: 'todos' } },
      channels: client.channels,
    };
    guildPainel.channels = {
      cache: new Collection(),
      async fetch() { return null; },
      async create(dados) {
        const mensagens = new Collection();
        const canal = {
          id: `canal-painel-${guildPainel.channels.cache.size + 1}`,
          name: dados.name,
          type: ChannelType.GuildText,
          isTextBased: () => true,
          enviadas: [],
          async send(payload) {
            const mensagem = {
              id: `pmsg-${guildPainel.channels.cache.size + 1}-${mensagens.size + 1}`,
              payload,
              author: { id: 'bot' },
              async edit(novo) { mensagem.payload = novo; return mensagem; },
              async delete() { mensagens.delete(mensagem.id); return true; },
            };
            mensagens.set(mensagem.id, mensagem);
            canal.enviadas.push(mensagem);
            return mensagem;
          },
          messages: {
            cache: mensagens,
            async fetch(id) { return mensagens.get(id) ?? null; },
          },
        };
        guildPainel.channels.cache.set(canal.id, canal);
        client.channels.cache.set(canal.id, canal);
        return canal;
      },
    };

    const canalPainel = await guildPainel.channels.create({ name: '2x2-mobile' });
    const modo = config.modoPorId('x2mobile');
    await paineis.publicarFila(db6, canalPainel, { guildId: 'g1', modo, entradas: [] });
    assert.strictEqual(paineis.mensagensSalvas(db6, { guildId: 'g1', modo: modo.id }).length, 15);

    // Simula deploy/troca de token: as mensagens gravadas não existem mais.
    db6.prepare("UPDATE mensagens_painel SET mensagem_id = 'apagada' WHERE guild_id = 'g1' AND modo = ?").run(modo.id);
    const recuperou = await paineis.atualizar(client, db6, { guildId: 'g1', modo: modo.id, preco: 200 });
    assert.strictEqual(recuperou, true, 'painel republicado sozinho');
    const novas = paineis.mensagensSalvas(db6, { guildId: 'g1', modo: modo.id });
    assert.strictEqual(novas.length, 15);
    assert.ok(novas.every((linha) => linha.mensagem_id !== 'apagada'));

    // Depois de recuperado, entrar na fila volta a escrever o nome na faixa.
    await fluxo.entrarNaFila(client, db6, {
      guild: guildPainel,
      userId: 'z1',
      modo: modo.id,
      preco: 200,
      gelo: 'normal',
    });
    const alvo = paineis.mensagensSalvas(db6, { guildId: 'g1', modo: modo.id }).find((linha) => linha.preco === 200);
    const mensagem = await canalPainel.messages.fetch(alvo.mensagem_id);
    assert.ok(mensagem.payload.embeds[0].toJSON().fields[0].value.includes('<@z1>'));
    passar('painel: IDs antigos/apagados são detectados, painel é republicado e a fila volta a atualizar');
    db6.close();
  }

  // ---------- botões do painel de mediadores ----------
  {
    const db7 = abrirBanco(path.join(pasta, 'mediadores.db'));
    const { handleBotao: cliqueMed } = require('../src/interacoes/botoes');
    const servicoMediadores = require('../src/servicos/mediadores');
    const servicoPlantao = require('../src/servicos/plantao');
    const ADMIN = PermissionsBitField.Flags.Administrator;
    const clique = (customId, extra = {}) => {
      const interacao = fakeInteraction({ commandName: undefined, perms: [ADMIN], ...extra });
      interacao.customId = customId;
      interacao.isButton = () => true;
      return interacao;
    };

    servicoPlantao.entrar(db7, { guildId: 'g1', userId: 'm1' });
    const antesModo = servicoMediadores.modo(db7, 'g1');
    const btnModo = clique('ap:medmodo');
    await cliqueMed(btnModo, { db: db7, client: null });
    assert.notStrictEqual(servicoMediadores.modo(db7, 'g1'), antesModo);
    assert.ok(btnModo.chamadas.editReply.embeds[0].toJSON().title.includes('Módulo de Mediadores'));

    const btnLimpar = clique('ap:medlimpar');
    await cliqueMed(btnLimpar, { db: db7, client: null });
    assert.strictEqual(servicoPlantao.total(db7, 'g1'), 0);

    const btnPix = clique('ap:medgestaopix');
    await cliqueMed(btnPix, { db: db7, client: null });
    assert.ok(resposta(btnPix).embeds[0].toJSON().title.includes('Gestão PIX'));

    const canalMed = {
      id: 'canal-med',
      enviadas: [],
      isTextBased: () => true,
      async send(payload) {
        canalMed.enviadas.push(payload);
        return { id: 'msg-med' };
      },
    };
    const btnReenviar = clique('ap:medreenviar', { channel: canalMed, channelId: 'canal-med' });
    await cliqueMed(btnReenviar, { db: db7, client: null });
    assert.strictEqual(canalMed.enviadas.length, 1);

    // Quem não é ADM não mexe em nada.
    servicoPlantao.entrar(db7, { guildId: 'g1', userId: 'm2' });
    const semAdm = clique('ap:medlimpar', { userId: 'm2', perms: [] });
    await cliqueMed(semAdm, { db: db7, client: null });
    assert.strictEqual(servicoPlantao.total(db7, 'g1'), 1);

    passar('mediadores: Limpar, Modo, Gestão PIX e Reenviar respondem (e só ADM mexe)');
    db7.close();
  }

  // ---------- limpeza ----------
  db.close();
  fs.rmSync(pasta, { recursive: true, force: true });

  console.log(`\n${ok} verificações · TODOS OS TESTES PASSARAM`);
})().catch((erro) => {
  console.error('\nFALHOU:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
