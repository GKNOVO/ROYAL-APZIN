'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'royal-ap-')), 'royal.db');
const { abrirBanco } = require('../src/db');
const comandos = require('../src/comandos');
const { responderPrivado, ehComponente, EFEMERO } = require('../src/util/seguranca');
const db = abrirBanco(process.env.DATABASE_PATH);
const testes = [];
function test(name, fn) { testes.push({ name, fn }); }

test('banco cria perfis e convites sem tabelas legadas', () => {
  const tables = db.prepare("select name from sqlite_master where type='table'").all().map((x) => x.name);
  assert.ok(tables.includes('usuarios'));
  assert.ok(tables.includes('convites'));
  assert.equal(tables.some((x) => /legado-impossivel/i.test(x)), false);
});

test('serviço de usuários mantém somente histórico local de partidas', () => {
  const servico = fs.readFileSync(path.join(__dirname, '../src/servicos/usuarios.js'), 'utf8');
  assert.match(servico, /historicoApostas/);
  assert.doesNotMatch(servico, /adicionarCoins|adicionarGiros|registrarVitoria|registrarDerrota|UPDATE usuarios|INSERT INTO usuarios/);
});

test('convites de runtime são gravados no Supabase, não no SQLite', () => {
  const eventos = fs.readFileSync(path.join(__dirname, '../src/eventos/index.js'), 'utf8');
  const servico = fs.readFileSync(path.join(__dirname, '../src/servicos/convites.js'), 'utf8');
  assert.match(eventos, /royalSupabase\.registrarInvite/);
  assert.doesNotMatch(eventos, /convites\.registrar\(/);
  assert.doesNotMatch(servico, /db\.prepare|\.prepare\(/);
});

test('novos comandos estão registrados e comandos legados não existem', () => {
  assert.ok(comandos.nomes.includes('roleta'));
  assert.ok(comandos.nomes.includes('lojinha'));
  assert.ok(comandos.nomes.includes('inventario'));
  for (const nome of comandos.nomes) assert.equal(/legado-impossivel/i.test(nome), false, nome);
});

test('diretório de serviços não contém o módulo removido', () =>
  assert.equal(fs.readdirSync(path.join(__dirname, '../src/servicos')).some((name) => /legacy-service/i.test(name)), false),
);

test('rotas críticas de PIX apontam para Supabase e não persistem snapshots locais', () => {
  const arquivos = ['src/interacoes/modais.js', 'src/interacoes/botoes.js', 'src/comandos/staff.js'];
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
    assert.match(texto, /staffSupabase/);
  }
  const fluxo = fs.readFileSync(path.join(__dirname, '../src/servicos/fluxo.js'), 'utf8');
  const staff = fs.readFileSync(path.join(__dirname, '../src/comandos/staff.js'), 'utf8');
  assert.doesNotMatch(fluxo, /partidas\.salvarPix/);
  assert.doesNotMatch(staff, /detalhe: `Sala \$\{partida\.id\} · \$\{registro\.pix_chave\}`/);
  const sqlPix = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202611150001_supabase_source_of_truth.sql'), 'utf8');
  assert.match(sqlPix, /royal_upsert_pix_key/);
  assert.match(sqlPix, /primary key\(guild_id,request_id\)/i);
});

test('economia, perfil, placar e rankings usam serviço Supabase, sem chamadas aos métodos SQLite', () => {
  const economia = fs.readFileSync(path.join(__dirname, '../src/comandos/economia.js'), 'utf8');
  const perfil = fs.readFileSync(path.join(__dirname, '../src/comandos/perfil.js'), 'utf8');
  const verp = fs.readFileSync(path.join(__dirname, '../src/comandos/verp.js'), 'utf8');
  const botoes = fs.readFileSync(path.join(__dirname, '../src/interacoes/botoes.js'), 'utf8');
  assert.match(economia, /royal\.ajustarPerfil/);
  assert.match(economia, /royal\.transferirCoins/);
  assert.doesNotMatch(economia, /require\(['"]\.\.\/servicos\/usuarios['"]\)|usuarios\./);
  assert.match(perfil, /royalSupabase\.ranking/);
  assert.doesNotMatch(perfil, /usuarios\.(resumo|top|posicaoNoRanking)\(/);
  assert.match(verp, /royalSupabase\.resumo/);
  assert.doesNotMatch(verp, /require\(['"]\.\.\/servicos\/usuarios['"]\)|usuarios\./);
  assert.match(botoes, /royalSupabase\.topPerfis/);
  assert.doesNotMatch(botoes, /usuarios\.top/);
  const fluxo = fs.readFileSync(path.join(__dirname, '../src/servicos/fluxo.js'), 'utf8');
  assert.match(fluxo, /royalSupabase\.registrarResultadoPartida/);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202611150002_economy_source_of_truth.sql'), 'utf8');
  for (const rpc of [
    'royal_adjust_profile',
    'royal_transfer_coins',
    'royal_apply_match_result',
    'royal_spin',
    'royal_buy_item',
    'royal_invite_ranking',
    'royal_mark_reward_delivered',
    'royal_mark_purchase_delivered',
  ]) {
    assert.match(sql, new RegExp(`function public\\.${rpc}`));
  }
});

test('resposta de interação usa followUp após Discord 40060 e nunca repete reply', async () => {
  const chamadas = [];
  const interaction = {
    deferred: false,
    replied: false,
    reply: async () => {
      chamadas.push('reply');
      throw Object.assign(new Error('Interaction has already been acknowledged'), { code: 40060 });
    },
    followUp: async (payload) => {
      chamadas.push(['followUp', payload]);
      return payload;
    },
  };
  await responderPrivado(interaction, { content: 'PIX salvo.' });
  await responderPrivado(interaction, { content: 'Resultado atualizado.' });
  assert.deepEqual(chamadas.map((item) => Array.isArray(item) ? item[0] : item), ['reply', 'followUp', 'followUp']);
  assert.equal(chamadas[1][1].flags & EFEMERO, EFEMERO);
});

test('dispatcher deduplica por ID antes de despachar handlers assíncronos', () => {
  const eventos = fs.readFileSync(path.join(__dirname, '../src/eventos/index.js'), 'utf8');
  assert.match(eventos, /interacoesVistasPorCliente = new WeakMap\(\)/);
  assert.match(eventos, /if \(!primeiraEntrega\(client, interaction\)\)/);
});

test('componente já adiado responde com followUp, sem segundo ACK inicial', async () => {
  const chamadas = [];
  const interaction = {
    deferred: true,
    replied: false,
    isButton: () => true,
    reply: async () => chamadas.push('reply'),
    editReply: async () => chamadas.push('editReply'),
    followUp: async () => chamadas.push('followUp'),
  };
  await responderPrivado(interaction, { content: 'Cadastro PIX.' });
  assert.deepEqual(chamadas, ['followUp']);
});

test('modal/context menu não são componentes e resposta deferida usa editReply', async () => {
  assert.equal(ehComponente({ isModalSubmit: () => true }), false);
  assert.equal(ehComponente({ isContextMenuCommand: () => true }), false);
  const chamadas = [];
  const interaction = {
    deferred: true,
    replied: false,
    isModalSubmit: () => true,
    editReply: async () => chamadas.push('editReply'),
    followUp: async () => chamadas.push('followUp'),
  };
  await responderPrivado(interaction, { content: 'PIX salvo.' });
  assert.deepEqual(chamadas, ['editReply']);
  const modais = fs.readFileSync(path.join(__dirname, '../src/interacoes/modais.js'), 'utf8');
  const handler = modais.slice(modais.indexOf('async function handleModal'));
  assert.ok(handler.indexOf('interaction.deferReply') < handler.indexOf('aplicarPix(interaction, db)'));
});

async function main() {
  let ok = 0;
  try {
    for (const { name, fn } of testes) {
      await fn();
      ok += 1;
      console.log(`OK ${name}`);
    }
    console.log(`✅ ${ok} testes offline concluídos.`);
  } finally {
    db.close();
  }
}

main().catch((erro) => {
  console.error('❌ Teste falhou:', erro);
  process.exitCode = 1;
});
