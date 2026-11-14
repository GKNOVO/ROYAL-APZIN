'use strict';
/** Domínio persistente da economia Royal AP no Supabase. */
const crypto = require('crypto');
const supabaseBase = require('./supabase');
const cliente = () => supabaseBase.obterCliente();
const requestId = (prefix, value) => `${prefix}:${value || crypto.randomUUID()}`;
async function rpc(nome, args) {
  const { data, error } = await cliente().rpc(nome, args);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return Array.isArray(data) ? data[0] : data;
}
async function girar({ guildId, userId, request }) {
  return rpc('royal_spin', { p_guild_id: String(guildId), p_user_id: String(userId), p_request_id: requestId('spin', request) });
}
async function comprar({ guildId, userId, itemId, request }) {
  return rpc('royal_buy_item', { p_guild_id: String(guildId), p_user_id: String(userId), p_item_id: itemId, p_request_id: requestId('buy', request) });
}
async function listarItens(guildId) {
  const { data, error } = await cliente().from('royal_shop_items').select('*').eq('guild_id', String(guildId)).eq('active', true).order('price');
  if (error) throw new Error(`listar loja: ${error.message}`); return data || [];
}
async function inventario(guildId, userId) {
  const { data, error } = await cliente().from('royal_inventory').select('quantity,item_id,royal_shop_items(name,description,reward_type,reward_value)').eq('guild_id', String(guildId)).eq('user_id', String(userId)).gt('quantity', 0).order('updated_at', { ascending: false });
  if (error) throw new Error(`inventário: ${error.message}`); return data || [];
}
async function rankingConvites(guildId, limit = 10) {
  const { data, error } = await cliente().from('royal_invites').select('inviter_user_id').eq('guild_id', String(guildId)).not('inviter_user_id', 'is', null);
  if (error) throw new Error(`ranking invites: ${error.message}`);
  const mapa = new Map(); for (const row of data || []) mapa.set(row.inviter_user_id, (mapa.get(row.inviter_user_id) || 0) + 1);
  return [...mapa.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([inviter_user_id,total]) => ({ inviter_user_id,total }));
}
async function registrarInvite({ guildId, invitedUserId, inviterUserId, code, confidence = 'observed' }) {
  const { error } = await cliente().from('royal_invites').upsert({ guild_id: String(guildId), invited_user_id: String(invitedUserId), inviter_user_id: inviterUserId ? String(inviterUserId) : null, code: code || null, confidence }, { onConflict: 'guild_id,invited_user_id', ignoreDuplicates: true });
  if (error) throw new Error(`registrar invite: ${error.message}`);
}
async function perfil(guildId, userId) {
  const { data, error } = await cliente().from('royal_profiles').select('*').eq('guild_id', String(guildId)).eq('user_id', String(userId)).maybeSingle();
  if (error) throw new Error(`perfil Supabase: ${error.message}`); return data;
}
async function auditar(evento) {
  const { error } = await cliente().from('royal_audit_events').insert({ ...evento, guild_id: evento.guildId, actor_id: evento.actorId, entity_type: evento.entityType, entity_id: evento.entityId, request_id: evento.requestId });
  if (error) console.error('[royal-supabase] auditoria:', error.message);
}
module.exports = { girar, comprar, listarItens, inventario, rankingConvites, registrarInvite, perfil, auditar };
