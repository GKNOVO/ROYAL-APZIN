'use strict';

/** Acesso privado ao Supabase. Nunca registre nem envie a chave service-role. */

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

let cliente;

function obterCliente() {
  if (cliente) return cliente;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase não configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis do ambiente; não compartilhe a chave service-role.',
    );
  }
  cliente = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return cliente;
}

function falha(operacao, erro) {
  const codigo = erro?.code ? ` (${erro.code})` : '';
  return new Error(`${operacao}${codigo}: ${erro?.message || 'erro sem detalhes retornados pelo Supabase'}`);
}

async function definirConfig(guildId, chave, valor, clienteOverride) {
  if (!guildId || !chave) throw new Error('Servidor e chave da configuração são obrigatórios.');
  const supabase = clienteOverride || obterCliente();
  const { error } = await supabase.from('discord_configuracoes').upsert(
    {
      guild_id: String(guildId),
      chave: String(chave),
      valor: String(valor),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'guild_id,chave' },
  );
  if (error) throw falha('Não consegui salvar a configuração no Supabase', error);
}

async function obterConfig(guildId, chave, clienteOverride) {
  if (!guildId || !chave) return null;
  const supabase = clienteOverride || obterCliente();
  const { data, error } = await supabase
    .from('discord_configuracoes')
    .select('valor')
    .eq('guild_id', String(guildId))
    .eq('chave', String(chave))
    .maybeSingle();
  if (error) throw falha('Não consegui ler a configuração do Supabase', error);
  return data?.valor ?? null;
}

async function sortearVersiculo(guildId, userId, clienteOverride) {
  const supabase = clienteOverride || obterCliente();
  const { data, error } = await supabase.rpc('discord_sortear_versiculo', {
    p_guild_id: guildId == null ? null : String(guildId),
    p_user_id: userId == null ? null : String(userId),
  });
  if (error) throw falha('Não consegui sortear o versículo no Supabase', error);
  const registro = Array.isArray(data) ? data[0] : data;
  if (!registro?.id || !registro?.texto || !registro?.referencia) {
    throw new Error('O Supabase não retornou um versículo. Execute a migração SQL e o seed de versículos.');
  }
  return {
    versiculo: { id: registro.id, texto: registro.texto, referencia: registro.referencia },
    cicloReiniciado: Boolean(registro.ciclo_reiniciado),
  };
}

module.exports = { obterCliente, definirConfig, obterConfig, sortearVersiculo };
