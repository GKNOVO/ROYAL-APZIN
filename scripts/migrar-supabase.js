'use strict';
/** Exporta dados essenciais do SQLite para o Supabase sem apagar o banco local. */
const config = require('../src/config');
const { abrirBanco } = require('../src/db');
const supabase = require('../src/servicos/supabase').obterCliente();
async function upsert(table, rows, conflict) { for (let i=0;i<rows.length;i+=500) { const {error}=await supabase.from(table).upsert(rows.slice(i,i+500),{onConflict:conflict}); if(error) throw new Error(`${table}: ${error.message}`); } }
async function main() {
 const db=abrirBanco(config.CAMINHO_BANCO);
 try {
  const usuarios=db.prepare('select guild_id,user_id,coins,giros as spins,vitorias as wins,derrotas as losses,wos,apostado,ganho from usuarios').all();
  await upsert('royal_profiles',usuarios,'guild_id,user_id');
  const invites=db.prepare('select guild_id,convidado_id as invited_user_id,convidador_id as inviter_user_id,codigo as code from convites').all();
  await upsert('royal_invites',invites,'guild_id,invited_user_id');
  const partidas=db.prepare('select id,guild_id,modo as mode,preco as price,status,mediador_id as mediator_id,vencedor_time as winner_team,motivo_fim as reason,datetime(criado_em/1000,\'unixepoch\') as created_at,datetime(finalizada_em/1000,\'unixepoch\') as finished_at from partidas').all();
  await upsert('royal_match_records',partidas,'id');
  const players=db.prepare('select partida_id as match_id,user_id,time as team,confirmou as confirmed from partida_jogadores').all().map(x=>({...x,confirmed:Boolean(x.confirmed)}));
  await upsert('royal_match_players',players,'match_id,user_id');
  const pix=db.prepare('select guild_id,user_id,pix_chave as pix_key,pix_titular as pix_holder,pix_cidade as pix_city,comissao as commission,ativo as active,datetime(registrado_em/1000,\'unixepoch\') as registered_at,datetime(atualizado_em/1000,\'unixepoch\') as updated_at from staff where pix_chave is not null').all().map(x=>({...x,active:Boolean(x.active),commission:Number(x.commission ?? 0.05)}));
  await upsert('royal_pix_keys',pix,'guild_id,user_id');
  const configs=db.prepare('select guild_id,chave as key,valor as value from configuracoes').all();
  await upsert('royal_guild_configs',configs,'guild_id,key');
  const stats={profiles:usuarios.length,invites:invites.length,matches:partidas.length,players:players.length,pix:pix.length,configs:configs.length};
  console.log(`✅ Migração concluída: ${JSON.stringify(stats)}`);
 } finally { db.close(); }
}
if(require.main===module) main().catch(e=>{console.error('❌ Migração falhou:',e.message);process.exitCode=1;});
module.exports={main};
