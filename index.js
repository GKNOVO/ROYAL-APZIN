'use strict';

/**
 * ORG Royal AP · núcleo de filas e apostas de Free Fire.
 * Ponto de entrada: valida configuração, abre o banco e conecta no Discord.
 */

const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./src/config');
const { abrirBanco } = require('./src/db');
const eventos = require('./src/eventos');

const erroConfig = config.validarToken();
if (erroConfig) {
  console.error('\n──────────────────────────────────────────────');
  console.error('❌ Configuração incompleta');
  console.error(`   ${erroConfig}`);
  console.error('\n   Arquivo: .env (na mesma pasta do index.js)');
  console.error('──────────────────────────────────────────────\n');
  process.exit(1);
}

let db;
try {
  db = abrirBanco(config.CAMINHO_BANCO);
  console.log(`🗄️  Banco de dados pronto: ${config.CAMINHO_BANCO} (motor ${db.motor || 'sqlite'})`);
} catch (erro) {
  console.error('\n❌ Não consegui abrir o banco de dados:', erro.message);
  console.error('   Atualize o Node para 22.13+ (traz SQLite embutido) ou rode:');
  console.error('   npm install better-sqlite3\n');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

eventos.montar(client, db);
eventos.ligarProcesso(db);

client.login(config.TOKEN).catch((erro) => {
  const mensagem = String(erro?.message || erro);
  console.error('\n──────────────────────────────────────────────');
  if (/invalid token|TokenInvalid|An invalid token/i.test(mensagem)) {
    console.error('❌ Token inválido.');
    console.error('   Developer Portal → seu app → Bot → Reset Token → Copy');
    console.error('   Cole no .env em: DISCORD_TOKEN= (uma linha só, sem espaços)');
  } else if (/disallowed intents/i.test(mensagem)) {
    console.error('❌ O bot precisa do intent de membros ligado.');
    console.error('   Developer Portal → Bot → Privileged Gateway Intents →');
    console.error('   ligue "Server Members Intent" e salve.');
  } else {
    console.error('❌ Não consegui conectar no Discord:', mensagem);
    console.error('   Confira sua internet e tente de novo.');
  }
  console.error('──────────────────────────────────────────────\n');
  process.exit(1);
});
