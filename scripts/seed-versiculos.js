'use strict';

const supabase = require('../src/servicos/supabase');
const { listarVersiculos } = require('../src/servicos/versiculos');

const TAMANHO_LOTE = 500;

async function seedVersiculos(clienteOverride) {
  const cliente = clienteOverride || supabase.obterCliente();
  const dados = listarVersiculos().map(({ id, texto, referencia }) => ({ id, texto, referencia }));

  for (let inicio = 0; inicio < dados.length; inicio += TAMANHO_LOTE) {
    const lote = dados.slice(inicio, inicio + TAMANHO_LOTE);
    const { error } = await cliente.from('discord_versiculos').upsert(lote, { onConflict: 'id' });
    if (error) {
      throw new Error(`Falha ao carregar o lote ${Math.floor(inicio / TAMANHO_LOTE) + 1}: ${error.message}`);
    }
    console.log(`[seed] ${Math.min(inicio + lote.length, dados.length)}/${dados.length} versículos enviados.`);
  }
  return dados.length;
}

async function main() {
  try {
    const total = await seedVersiculos();
    console.log(`✅ Seed concluído: ${total} versículos disponíveis no Supabase.`);
  } catch (erro) {
    console.error('❌ Seed de versículos falhou:', erro.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { TAMANHO_LOTE, seedVersiculos };
