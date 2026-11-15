'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DISCORD_TOKEN = 'test.token.value';
process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'royal-ap-')), 'royal.db');
const { abrirBanco } = require('../src/db');
const comandos = require('../src/comandos');
const usuarios = require('../src/servicos/usuarios');
const convites = require('../src/servicos/convites');
const db = abrirBanco(process.env.DATABASE_PATH);
let ok = 0;
function test(name, fn) { fn(); ok += 1; console.log(`OK ${name}`); }
test('banco cria perfis e convites sem tabelas legadas', () => {
  const tables = db.prepare("select name from sqlite_master where type='table'").all().map((x) => x.name);
  assert.ok(tables.includes('usuarios')); assert.ok(tables.includes('convites')); assert.equal(tables.some((x) => /legado-impossivel/i.test(x)), false);
});
test('economia protege saldo negativo e atualiza giros', () => {
  assert.equal(usuarios.adicionarCoins(db, { guildId: 'g', userId: 'u', valor: 100 }), 100);
  assert.throws(() => usuarios.adicionarCoins(db, { guildId: 'g', userId: 'u', valor: -101 }), /Saldo insuficiente/);
  assert.equal(usuarios.adicionarGiros(db, { guildId: 'g', userId: 'u', quantidade: 2 }), 2);
});
test('convite grava convidador e convidado corretamente', () => {
  convites.registrar(db, { guildId: 'g', convidadorId: 'inviter', convidadoId: 'new', codigo: 'abc' });
  assert.equal(db.prepare('select convidador_id from convites where convidado_id=?').get('new').convidador_id, 'inviter');
});
test('novos comandos estão registrados e comandos legados não existem', () => {
  assert.ok(comandos.nomes.includes('roleta')); assert.ok(comandos.nomes.includes('lojinha')); assert.ok(comandos.nomes.includes('inventario'));
  for (const nome of comandos.nomes) assert.equal(/legado-impossivel/i.test(nome), false, nome);
});
test('diretório de serviços não contém o módulo removido', () => assert.equal(fs.readdirSync(path.join(__dirname, '../src/servicos')).some((name) => /legacy-service/i.test(name)), false));
test('fluxos críticos de PIX apontam para o repositório Supabase', () => {
  const arquivos = ['src/interacoes/modais.js', 'src/interacoes/botoes.js', 'src/comandos/staff.js', 'src/comandos/perfil.js'];
  for (const arquivo of arquivos) {
    const texto = fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
    assert.match(texto, /staffSupabase/);
  }
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202611150001_supabase_source_of_truth.sql'), 'utf8');
  assert.match(sql, /royal_upsert_pix_key/);
  assert.match(sql, /primary key\(guild_id,request_id\)/i);
});
db.close(); console.log(`✅ ${ok} testes offline concluídos.`);
