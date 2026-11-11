'use strict';

/**
 * Junta todos os comandos e garante a resposta rápida que o Discord exige
 * (menos de 3 segundos). O deferReply acontece AQUI, antes de qualquer
 * consulta no banco, embed ou envio de painel — depois o comando só edita
 * a resposta com interaction.editReply(...).
 */

const { MessageFlags } = require('discord.js');
const { embedErro } = require('../util/embeds');

const modulos = [
  require('./paineis'),
  require('./fila'),
  require('./perfil'),
  require('./economia'),
  require('./staff'),
  require('./moderacao'),
  require('./utilidades'),
  require('./botperfil'),
  require('./mediadores'),
  require('./telagem'),
  require('./voz'),
  require('./verp'),
  require('./nix'),
];

const comandos = modulos.flatMap((modulo) => modulo.comandos);
const porNome = new Map(comandos.map((comando) => [comando.data.name, comando]));

const EFEMERO = MessageFlags?.Ephemeral ?? 64;

/** Comandos cujo resultado deve ficar visível para todo o canal. */
const PUBLICOS = new Set(['ranking', 'vencedor', 'wo']);

/**
 * Tipo de resposta inicial de cada comando:
 *   'privado'  → deferReply efêmero (padrão: ninguém vê o "pensando")
 *   'publico'  → deferReply normal (ranking, resultado de partida)
 *   'nenhum'   → o próprio comando responde (use comando.defer = 'nenhum')
 */
function modoDefer(comando) {
  if (comando.defer) return comando.defer;
  return PUBLICOS.has(comando.data.name) ? 'publico' : 'privado';
}

function definicoes() {
  return comandos.map((comando) => comando.data.toJSON());
}

function buscar(nome) {
  return porNome.get(String(nome)) || null;
}

async function avisarFalha(interaction, adiado, erro) {
  const aviso = {
    embeds: [embedErro(String(erro?.message || 'Deu um erro aqui. Tente de novo em alguns segundos.').slice(0, 400))],
  };
  try {
    if (adiado || interaction.deferred) return await interaction.editReply(aviso);
    if (interaction.replied) return await interaction.followUp({ ...aviso, flags: EFEMERO });
    return await interaction.reply({ ...aviso, flags: EFEMERO });
  } catch {
    return null; // interação já expirou: o log abaixo já registrou
  }
}

async function executar(interaction, ctx) {
  const comando = buscar(interaction.commandName);
  if (!comando) return null;

  const modo = modoDefer(comando);
  let adiado = false;

  if (
    modo !== 'nenhum' &&
    typeof interaction.deferReply === 'function' &&
    !interaction.deferred &&
    !interaction.replied
  ) {
    try {
      await interaction.deferReply(modo === 'privado' ? { flags: EFEMERO } : {});
      adiado = true;
    } catch (erro) {
      // 10062 = interação expirada (bot acabou de reiniciar). Não adianta seguir.
      console.error(`[comandos] deferReply falhou em /${interaction.commandName}:`, erro.message);
    }
  }

  try {
    return await comando.executar(interaction, ctx);
  } catch (erro) {
    console.error(`[comandos] erro em /${interaction.commandName}:`, erro);
    await avisarFalha(interaction, adiado, erro);
    return null;
  }
}

module.exports = {
  comandos,
  definicoes,
  buscar,
  executar,
  modoDefer,
  nomes: comandos.map((comando) => comando.data.name),
};
