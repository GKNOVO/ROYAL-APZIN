'use strict';

/** Junta todos os comandos em um só lugar. */

const modulos = [
  require('./paineis'),
  require('./fila'),
  require('./perfil'),
  require('./economia'),
  require('./staff'),
  require('./moderacao'),
  require('./utilidades'),
];

const comandos = modulos.flatMap((modulo) => modulo.comandos);
const porNome = new Map(comandos.map((comando) => [comando.data.name, comando]));

function definicoes() {
  return comandos.map((comando) => comando.data.toJSON());
}

function buscar(nome) {
  return porNome.get(String(nome)) || null;
}

async function executar(interaction, ctx) {
  const comando = buscar(interaction.commandName);
  if (!comando) return null;
  return comando.executar(interaction, ctx);
}

module.exports = {
  comandos,
  definicoes,
  buscar,
  executar,
  nomes: comandos.map((comando) => comando.data.name),
};
