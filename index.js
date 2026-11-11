'use strict';

/**
 * ORG Royal AP · núcleo de filas e apostas de Free Fire.
 * Ponto de entrada: valida configuração, abre o banco e conecta no Discord.
 *
 * Feito para ficar online em hospedagem (Discloud, Render, VPS, Termux):
 *  • o servidor HTTP de saúde sobe ANTES do login (a porta responde mesmo
 *    enquanto o bot conecta);
 *  • o token vem sempre de process.env.DISCORD_TOKEN (nunca fixo no código);
 *  • se a conexão falhar por rede, o bot tenta de novo sozinho;
 *  • se ficar muito tempo desconectado, ele mesmo reinicia para a hospedagem
 *    subir de novo (AUTORESTART=true no discloud.config).
 */

const { Client, GatewayIntentBits, Events } = require('discord.js');
const config = require('./src/config');
const { abrirBanco } = require('./src/db');
const { iniciarServidor } = require('./src/servidor');
const eventos = require('./src/eventos');

const TENTATIVAS_LOGIN = 5;
const ESPERA_MAXIMA = 60 * 1000;
/** Tempo sem conexão que dispara o reinício automático. */
const LIMITE_OFFLINE = 10 * 60 * 1000;

function separador() {
  console.log('──────────────────────────────────────────────');
}

// 1) Servidor HTTP primeiro: a hospedagem vê o serviço vivo desde o primeiro segundo.
const servidorHttp = iniciarServidor();

// 2) Token e configuração mínima.
const erroConfig = config.validarToken();
if (erroConfig) {
  separador();
  console.error('❌ Configuração incompleta');
  console.error(`   ${erroConfig}`);
  console.error('\n   Arquivo: .env (na mesma pasta do index.js)');
  console.error('   Na Discloud/Render: cadastre DISCORD_TOKEN nas variáveis de ambiente.');
  separador();
  process.exit(1);
}

separador();
console.log('👑 ORG Royal AP · bot de filas e apostas');
console.log(`   Node ${process.version} · porta HTTP ${Number(process.env.PORT) || 3000}`);
console.log(`   Token: carregado de ${config.TOKEN_ORIGEM} (${config.TOKEN.length} caracteres)`);
console.log(
  `   Nix FF: ${config.NIX_API_KEY && !/^COLE_/i.test(config.NIX_API_KEY) ? 'API configurada' : 'sem NIX_API_KEY (só /nix fica limitado)'}`,
);
separador();

// 3) Banco de dados.
let db;
try {
  db = abrirBanco(config.CAMINHO_BANCO);
  console.log(`🗄️  Banco pronto: ${config.CAMINHO_BANCO} (motor ${db.motor || 'sqlite'})`);
} catch (erro) {
  console.error('\n❌ Não consegui abrir o banco de dados:', erro.message);
  console.error('   Atualize o Node para 22.13+ (traz SQLite embutido) ou rode:');
  console.error('   npm install better-sqlite3\n');
  process.exit(1);
}

// 4) Cliente do Discord.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

eventos.montar(client, db);
eventos.ligarProcesso(db);

process.on('SIGTERM', () => {
  try {
    servidorHttp.close?.();
  } catch {
    /* já fechado */
  }
});

/**
 * Login com novas tentativas.
 * Token inválido ou intent faltando não tem conserto por retry: avisa e sai
 * (a hospedagem reinicia e o log mostra o motivo real, em vez de "offline").
 */
async function conectar(tentativa = 1) {
  try {
    await client.login(config.TOKEN);
    return;
  } catch (erro) {
    const mensagem = String(erro?.message || erro);
    console.error(`\n❌ Tentativa ${tentativa}/${TENTATIVAS_LOGIN} de login falhou: ${mensagem}`);

    if (/invalid token|TokenInvalid|An invalid token/i.test(mensagem)) {
      separador();
      console.error('❌ Token inválido.');
      console.error('   Developer Portal → seu app → Bot → Reset Token → Copy');
      console.error('   Cole em DISCORD_TOKEN= (uma linha só, sem espaços e sem aspas).');
      console.error('   Na Discloud: Dashboard → seu bot → Variáveis → DISCORD_TOKEN.');
      separador();
      process.exit(1);
    }

    if (/disallowed intents/i.test(mensagem)) {
      separador();
      console.error('❌ O bot precisa do intent de membros ligado.');
      console.error('   Developer Portal → Bot → Privileged Gateway Intents →');
      console.error('   ligue "Server Members Intent" e salve.');
      separador();
      process.exit(1);
    }

    if (tentativa >= TENTATIVAS_LOGIN) {
      console.error('\n❌ Não consegui conectar no Discord depois de várias tentativas.');
      console.error('   Confira a internet da hospedagem e o status em discordstatus.com.\n');
      process.exit(1);
    }

    const espera = Math.min(ESPERA_MAXIMA, 5000 * tentativa);
    console.warn(`   Vou tentar de novo em ${Math.round(espera / 1000)}s...`);
    setTimeout(() => {
      try {
        client.destroy();
      } catch {
        /* ainda não conectado */
      }
      conectar(tentativa + 1);
    }, espera);
  }
}

// 5) Guardião: se o bot cair da conexão e não voltar, reinicia o processo.
let vistoOnline = Date.now();
client.on(Events.ClientReady, () => {
  vistoOnline = Date.now();
});
client.on(Events.ShardDisconnect, () => {
  console.warn('[discord] conexão caiu; o discord.js tenta reconectar sozinho.');
});

const guardiao = setInterval(() => {
  if (client.isReady()) {
    vistoOnline = Date.now();
    return;
  }
  const offline = Date.now() - vistoOnline;
  if (offline > LIMITE_OFFLINE) {
    console.error(
      `\n❌ O bot está ${Math.round(offline / 60000)} min sem conexão com o Discord. Reiniciando o processo...`,
    );
    try {
      db?.close?.();
    } catch {
      /* já fechado */
    }
    process.exit(1);
  }
}, 60 * 1000);
if (typeof guardiao.unref === 'function') guardiao.unref();

conectar();
