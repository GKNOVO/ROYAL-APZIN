'use strict';

const { REST, Routes } = require('discord.js');

async function registrarComandos({ token, clientId, guildId, definicoes, rest }) {
  if (!clientId) throw new Error('CLIENT_ID é obrigatório para registrar comandos slash.');
  if (!Array.isArray(definicoes)) throw new Error('A lista de definições slash precisa ser um array.');
  if (!rest && !token) throw new Error('DISCORD_TOKEN é obrigatório para registrar comandos slash.');

  const clienteRest = rest || new REST({ version: '10' }).setToken(token);
  const escopoGuild = guildId ? String(guildId) : null;
  const rota = escopoGuild
    ? Routes.applicationGuildCommands(String(clientId), escopoGuild)
    : Routes.applicationCommands(String(clientId));

  await clienteRest.put(rota, { body: definicoes });
  return {
    rota,
    guildId: escopoGuild,
    quantidade: definicoes.length,
  };
}

module.exports = { registrarComandos };
