'use strict';
/** Fonte de verdade remota para mediadores e PIX. Nunca usa o filesystem local. */
const crypto = require('crypto');
const config = require('../config');
const { obterCliente } = require('./supabase');
function rid(value) { return String(value || crypto.randomUUID()); }
function erro(op, error) { return new Error(`${op}: ${error?.message || 'erro sem detalhes retornado pelo Supabase'}`); }
function normalizar({ guildId, userId, chave, titular, cidade, comissao }) {
  const pixKey = String(chave || '').trim();
  if (pixKey.length < 3 || pixKey.length > 200) throw new Error('A chave PIX precisa ter entre 3 e 200 caracteres.');
  const commission = comissao == null ? 0.05 : Number(comissao);
  if (!Number.isFinite(commission) || commission < 0 || commission > 0.5) throw new Error('A comissão precisa estar entre 0 e 0,50 (0% a 50%).');
  return { p_guild_id: String(guildId), p_user_id: String(userId), p_pix_key: pixKey, p_holder: titular ? String(titular).trim().slice(0, 120) : null, p_city: cidade ? String(cidade).trim().slice(0, 80) : null, p_commission: commission, p_request_id: rid(`${guildId}:${userId}:${pixKey}`) };
}
function model(row) { return row ? { guild_id: row.guild_id, user_id: row.user_id, pix_chave: row.pix_key, pix_titular: row.pix_holder, pix_cidade: row.pix_city, comissao: Number(row.commission ?? 0.05), ativo: Boolean(row.active), registrado_em: row.registered_at, atualizado_em: row.updated_at } : null; }
async function registrarPix(args) {
  const { data, error } = await obterCliente().rpc('royal_upsert_pix_key', normalizar(args));
  if (error) throw erro('Não consegui salvar o PIX no Supabase', error);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.user_id) throw new Error('O Supabase confirmou a operação, mas não retornou o cadastro PIX.');
  return model(row);
}
async function obter(guildId, userId) {
  const { data, error } = await obterCliente().from('royal_pix_keys').select('guild_id,user_id,pix_key,pix_holder,pix_city,commission,active,registered_at,updated_at').eq('guild_id', String(guildId)).eq('user_id', String(userId)).maybeSingle();
  if (error) throw erro('Não consegui consultar o PIX no Supabase', error);
  return model(data);
}
async function listar(guildId) {
  const { data, error } = await obterCliente().from('royal_pix_keys').select('guild_id,user_id,pix_key,pix_holder,pix_city,commission,active,registered_at,updated_at').eq('guild_id', String(guildId)).order('active', { ascending: false }).order('registered_at', { ascending: true });
  if (error) throw erro('Não consegui listar os mediadores no Supabase', error);
  return (data || []).map(model);
}
async function definirAtivo(guildId, userId, ativo) {
  const { data, error } = await obterCliente().from('royal_pix_keys').update({ active: Boolean(ativo), updated_at: new Date().toISOString() }).eq('guild_id', String(guildId)).eq('user_id', String(userId)).select().maybeSingle();
  if (error) throw erro('Não consegui atualizar o status do PIX', error); return model(data);
}
async function podeAssumir(guildId, userId) { const row = await obter(guildId, userId); return Boolean(row?.ativo && row.pix_chave); }
async function cargos(guildId) {
  const { data, error } = await obterCliente().from('royal_guild_configs').select('value').eq('guild_id', String(guildId)).eq('key', 'cargos_mediadores').maybeSingle();
  if (error) throw erro('Não consegui consultar cargos de mediadores', error);
  try { const parsed = JSON.parse(data?.value || '[]'); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
async function temCargoMediador(guildId, member) {
  if (member?.permissions?.has?.('Administrator') || member?.permissions?.has?.(8n)) return true;
  const ids = await cargos(guildId);
  const configurados = ids.length ? ids : [config.CARGO_MEDIADOR_ID, config.CARGO_ADMIN_ID].filter(Boolean);
  return configurados.some((id) => member?.roles?.cache?.has?.(id));
}
async function definirConfig(guildId, key, value) {
  const { error } = await obterCliente().from('royal_guild_configs').upsert({ guild_id: String(guildId), key: String(key), value: value == null ? null : String(value), updated_at: new Date().toISOString() }, { onConflict: 'guild_id,key' });
  if (error) throw erro('Não consegui salvar configuração no Supabase', error);
}
module.exports = { registrarPix, obter, listar, definirAtivo, podeAssumir, cargos, temCargoMediador, definirConfig };
