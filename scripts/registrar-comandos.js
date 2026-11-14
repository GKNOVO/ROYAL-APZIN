'use strict';

const config = require('../src/config');
const comandos = require('../src/comandos');
const { registrarComandos } = require('../src/servicos/registroComandos');

async function main() {
  const erroToken = config.validarToken();
  if (erroToken) throw new Error(erroToken);
  if (!config.CLIENT_ID) {
    throw new Error('Defina CLIENT_ID nas variáveis do ambiente antes de sincronizar os comandos.');
  }

  const resultado = await registrarComandos({
    token: config.TOKEN,
    clientId: config.CLIENT_ID,
    guildId: config.GUILD_ID,
    definicoes: comandos.definicoes(),
  });
  const destino = resultado.guildId ? `guild ${resultado.guildId}` : 'escopo global';
  console.log(`✅ ${resultado.quantidade} slash commands sincronizados no ${destino}.`);
  if (!resultado.guildId) console.log('A publicação global pode levar até uma hora para aparecer em todos os servidores.');
  return resultado;
}

if (require.main === module) {
  main().catch((erro) => {
    console.error('❌ Falha ao sincronizar slash commands:', erro.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
