'use strict';

/**
 * Exporta dados legados do SQLite para Supabase sem apagar o banco local.
 * Perfis econômicos são reconciliados de forma conservadora: somente valores
 * remotos zero/ausentes recebem o valor local; conflito não é sobrescrito.
 */
const config = require('../src/config');
const { abrirBanco } = require('../src/db');
const supabase = require('../src/servicos/supabase').obterCliente();
const CAMPOS_PERFIL = ['coins', 'spins', 'wins', 'losses', 'wos', 'apostado', 'ganho'];

async function upsert(table, rows, conflict, options = {}) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + 500), { onConflict: conflict, ...options });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function reconciliarPerfis(perfis) {
  const porGuild = new Map();
  for (const perfil of perfis) {
    const lista = porGuild.get(String(perfil.guild_id)) || [];
    lista.push(perfil);
    porGuild.set(String(perfil.guild_id), lista);
  }

  const planos = [];
  const conflitos = [];
  for (const [guildId, locais] of porGuild) {
    const remotos = new Map();
    for (let i = 0; i < locais.length; i += 500) {
      const ids = locais.slice(i, i + 500).map((perfil) => String(perfil.user_id));
      const { data, error } = await supabase
        .from('royal_profiles')
        .select(`guild_id,user_id,${CAMPOS_PERFIL.join(',')}`)
        .eq('guild_id', guildId)
        .in('user_id', ids);
      if (error) throw new Error(`consultar royal_profiles (${guildId}): ${error.message}`);
      for (const row of data || []) remotos.set(String(row.user_id), row);
    }

    for (const local of locais) {
      const remoto = remotos.get(String(local.user_id));
      const deltas = {};
      const camposEmConflito = [];
      for (const campo of CAMPOS_PERFIL) {
        const valorLocal = Math.trunc(Number(local[campo]) || 0);
        const valorRemoto = Math.trunc(Number(remoto?.[campo]) || 0);
        if (valorLocal === 0) continue;
        if (!remoto || valorRemoto === 0) deltas[campo] = valorLocal;
        else if (valorRemoto !== valorLocal) camposEmConflito.push(campo);
      }
      if (camposEmConflito.length) {
        conflitos.push(`${guildId}/${local.user_id} (${camposEmConflito.join(', ')})`);
      } else if (Object.values(deltas).some((valor) => valor !== 0)) {
        planos.push({ guildId, userId: String(local.user_id), deltas });
      }
    }
  }

  if (conflitos.length) {
    const amostra = conflitos.slice(0, 20).join('\n- ');
    throw new Error(
      `Conflito entre SQLite e Supabase em ${conflitos.length} perfil(is). Nenhum saldo foi sobrescrito; ` +
        `reconcilie manualmente e execute novamente.\n- ${amostra}`,
    );
  }

  for (const plano of planos) {
    const requestId = `legacy-migration:${plano.guildId}:${plano.userId}`;
    const { error } = await supabase.rpc('royal_adjust_profile', {
      p_guild_id: plano.guildId,
      p_user_id: plano.userId,
      p_deltas: plano.deltas,
      p_reason: 'importação inicial do SQLite',
      p_actor_id: null,
      p_request_id: requestId,
    });
    if (error) throw new Error(`migrar perfil ${plano.guildId}/${plano.userId}: ${error.message}`);
  }
  return { reconciled: planos.length, conflicts: 0 };
}

async function main() {
  const db = abrirBanco(config.CAMINHO_BANCO);
  try {
    const usuarios = db.prepare(
      'select guild_id,user_id,coins,giros as spins,vitorias as wins,derrotas as losses,wos,apostado,ganho from usuarios',
    ).all();
    // Planejar e verificar todos os conflitos antes de alterar qualquer perfil remoto.
    const perfis = await reconciliarPerfis(usuarios);

    const invites = db.prepare(
      'select guild_id,convidado_id as invited_user_id,convidador_id as inviter_user_id,codigo as code from convites',
    ).all();
    await upsert('royal_invites', invites, 'guild_id,invited_user_id', { ignoreDuplicates: true });

    const partidas = db.prepare(
      "select id,guild_id,modo as mode,preco as price,status,mediador_id as mediator_id,vencedor_time as winner_team,motivo_fim as reason,datetime(criado_em/1000,'unixepoch') as created_at,datetime(finalizada_em/1000,'unixepoch') as finished_at from partidas",
    ).all();
    await upsert('royal_match_records', partidas, 'id', { ignoreDuplicates: true });

    const jogadores = db.prepare(
      'select partida_id as match_id,user_id,time as team,confirmou as confirmed from partida_jogadores',
    ).all().map((row) => ({ ...row, confirmed: Boolean(row.confirmed) }));
    await upsert('royal_match_players', jogadores, 'match_id,user_id', { ignoreDuplicates: true });

    const pix = db.prepare(
      "select guild_id,user_id,pix_chave as pix_key,pix_titular as pix_holder,pix_cidade as pix_city,comissao as commission,ativo as active,datetime(registrado_em/1000,'unixepoch') as registered_at,datetime(atualizado_em/1000,'unixepoch') as updated_at from staff where pix_chave is not null",
    ).all().map((row) => ({
      ...row,
      active: Boolean(row.active),
      commission: Number(row.commission ?? 0.05),
    }));
    // Supabase permanece autoridade; chaves locais antigas não substituem uma chave remota atual.
    await upsert('royal_pix_keys', pix, 'guild_id,user_id', { ignoreDuplicates: true });

    const configs = db.prepare('select guild_id,chave as key,valor as value from configuracoes').all();
    await upsert('royal_guild_configs', configs, 'guild_id,key', { ignoreDuplicates: true });

    // Só depois de todas as gravações remotas terem sucesso, higienizar cópias antigas.
    db.prepare(
      'UPDATE staff SET pix_chave=NULL,pix_titular=NULL,pix_cidade=NULL WHERE pix_chave IS NOT NULL OR pix_titular IS NOT NULL OR pix_cidade IS NOT NULL',
    ).run();
    db.prepare(
      'UPDATE partidas SET pix_chave=NULL,pix_titular=NULL WHERE pix_chave IS NOT NULL OR pix_titular IS NOT NULL',
    ).run();
    db.prepare(
      "UPDATE auditoria SET detalhe=substr(detalhe,1,instr(detalhe,' · ')+2)||'[chave PIX omitida]' WHERE acao='PIX enviado na sala' AND instr(detalhe,' · ')>0",
    ).run();

    console.log(`✅ Migração concluída: ${JSON.stringify({ profiles: usuarios.length, ...perfis, invites: invites.length, matches: partidas.length, players: jogadores.length, pix: pix.length, configs: configs.length })}`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((erro) => {
    console.error('❌ Migração falhou:', erro.message);
    process.exitCode = 1;
  });
}

module.exports = { main, reconciliarPerfis };
