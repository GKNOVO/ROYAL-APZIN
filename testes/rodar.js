'use strict';

/**
 * Testes offline do bot Royal AP (não precisa de internet nem token):
 *   node testes/rodar.js
 *
 * Testa banco, filas, partidas, PIX, fluxo da sala, painéis, tickets e os 48 comandos.
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
          async delete() {
            cache.delete(canal.id);
            return canal;
          },
        };
        cache.set(canal.id, canal);
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
    for (const esperada of ['usuarios', 'staff', 'paineis', 'filas', 'partidas', 'partida_jogadores', 'transacoes', 'blacklist', 'auditoria', 'configuracoes', 'convites', 'logs_dm']) {
      assert.ok(tabelas.includes(esperada), `faltou a tabela ${esperada}`);
    }
    passar('banco: 12 tabelas criadas automaticamente');
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
    assert.ok(embedSala.title.includes('1x1'));
    assert.ok(canal.enviadas[0].payload.components.length >= 1);
    passar('fluxo: sala já nasce com embed e botão de confirmar');

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
    assert.strictEqual(config.PRECOS.length, 14);
    assert.strictEqual(embed.fields.length, 14);
    assert.ok(embed.fields[0].name.includes('R$ 0,50'), 'primeiro card é R$ 0,50');
    assert.ok(embed.fields[13].name.includes('R$ 100,00'), 'último card é R$ 100,00');
    assert.deepStrictEqual(config.PRECOS.map(reais), [
      'R$ 0,50', 'R$ 1,00', 'R$ 1,50', 'R$ 2,50', 'R$ 5,00', 'R$ 10,00', 'R$ 20,00',
      'R$ 30,00', 'R$ 40,00', 'R$ 50,00', 'R$ 70,00', 'R$ 80,00', 'R$ 90,00', 'R$ 100,00',
    ]);
    passar('painel: 14 cards na ordem certa (R$ 0,50 no topo · R$ 100,00 no fundo)');

    const menu = painel.components[0].toJSON().components[0];
    assert.strictEqual(menu.custom_id, 'ap:preco:x1mobile');
    assert.strictEqual(menu.options.length, 14);
    const botoesPainel = painel.components[1].toJSON().components.map((botao) => botao.custom_id);
    assert.deepStrictEqual(botoesPainel, ['ap:sair:x1mobile:todos', 'ap:como']);
    passar('painel: menu com 14 valores e sem botão de ranking');

    const mobile = paineis.componentesEntrada(modo, 250)[0].toJSON().components;
    assert.deepStrictEqual(
      mobile.map((botao) => botao.custom_id),
      [
        'ap:entrar:x1mobile:250:infinito',
        'ap:entrar:x1mobile:250:normal',
        'ap:sair:x1mobile:250',
        'ap:como',
      ],
    );
    assert.deepStrictEqual(mobile.map((botao) => botao.label), [
      'Gelo Infinito',
      'Gelo Normal',
      'Sair',
      'Como funciona',
    ]);
    passar('cards mobile: Gelo Infinito · Gelo Normal · Sair · Como funciona');

    const emu = paineis.componentesEntrada(config.modoPorId('x2emu'), 500)[0].toJSON().components;
    assert.deepStrictEqual(emu.map((botao) => botao.label), [
      'Normal',
      'Full UMP e XM8',
      'Sair',
      'Como funciona',
    ]);
    const capa = paineis.componentesEntrada(config.modoPorId('x1fullcapa'), 500)[0].toJSON().components;
    assert.deepStrictEqual(capa.map((botao) => botao.label), ['Full Capa', 'Sair', 'Como funciona']);
    passar('cards emu e full capa: botões certos em cada categoria');

    const misto = ['x2misto', 'x3misto', 'x4misto'].map(
      (id) => paineis.componentesEntrada(config.modoPorId(id), 1000)[0].toJSON().components,
    );
    assert.deepStrictEqual(misto[0].map((botao) => botao.label), ['1 Emu', 'Sair']);
    assert.deepStrictEqual(misto[1].map((botao) => botao.label), ['1 Emu', '2 Emu', 'Sair']);
    assert.deepStrictEqual(misto[2].map((botao) => botao.label), ['1 Emu', '2 Emu', '3 Emu', 'Sair']);
    for (const linha of misto) {
      assert.ok(!linha.some((botao) => /Como funciona/.test(botao.label)), 'misto sem "Como funciona"');
    }
    passar('cards misto: 1/2/3 Emu + Sair, sem "Como funciona"');

    assert.strictEqual(config.MODOS.length, 15);
    const titulos = config.MODOS.map((m) => m.titulo);
    for (const esperado of ['1x1 | mobile', '4x4 | mobile', '1x1 | full capa', '4x4 | full capa', '1x1 | emu', '4x4 | emu', '2x2 | misto', '4x4 | misto']) {
      assert.ok(titulos.includes(esperado), `faltou o modo ${esperado}`);
    }
    passar('modos: os 15 painéis existem com os títulos certos');
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
      'vencedor', 'vitoria', 'wo',
    ];
    for (const nome of obrigatorios) {
      assert.ok(nomes.includes(nome), `faltou o comando /${nome}`);
    }
    const paineisEsperados = config.MODOS.map((modo) => modo.comando);
    for (const nome of paineisEsperados) {
      assert.ok(nomes.includes(nome), `faltou o painel /${nome}`);
    }
    assert.strictEqual(nomes.length, 48);
    assert.strictEqual(new Set(nomes).size, 48, 'nome de comando repetido');
    passar('comandos: 48 registrados (33 gerais + 15 painéis), sem repetição');

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
    assert.strictEqual(semCategoria.canal.parentId, null, 'não invade a categoria de filas');
    passar('ticket: sem categoria configurada não invade a categoria das filas');

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
    passar('ticket: botão cria o canal na categoria e devolve o link');

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

    // /filasx1mobile: deferReply imediato + painel de 14 cards publicado
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
    assert.strictEqual(canalPainel.enviadas.length, 1, 'painel publicado');
    assert.strictEqual(canalPainel.enviadas[0].embeds[0].toJSON().fields.length, 14);
    assert.ok(resposta(comandoPainel).content.includes('publicado'));
    passar('/filasx1mobile: deferReply em <3s + painel de 14 cards no canal');

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

  // ---------- limpeza ----------
  db.close();
  fs.rmSync(pasta, { recursive: true, force: true });

  console.log(`\n${ok} verificações · TODOS OS TESTES PASSARAM`);
})().catch((erro) => {
  console.error('\nFALHOU:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
