-- Persistência Supabase das funcionalidades recentes do bot Royal AP.
-- Execute no Supabase SQL Editor. Não habilite acesso anon/authenticated.
-- O histórico de versículos é global para o bot, compartilhado entre servidores.

create table if not exists public.discord_configuracoes (
  guild_id text not null,
  chave text not null,
  valor text not null,
  atualizado_em timestamptz not null default now(),
  primary key (guild_id, chave)
);

create table if not exists public.discord_versiculos (
  id text primary key,
  texto text not null,
  referencia text not null
);

-- Um ID só pode ser consumido uma vez até a lista global inteira se esgotar.
create table if not exists public.discord_versiculos_usados (
  versiculo_id text primary key references public.discord_versiculos(id) on delete cascade,
  usado_em timestamptz not null default now(),
  guild_id text,
  user_id text
);

alter table public.discord_configuracoes enable row level security;
alter table public.discord_versiculos enable row level security;
alter table public.discord_versiculos_usados enable row level security;

revoke all on table public.discord_configuracoes from anon, authenticated;
revoke all on table public.discord_versiculos from anon, authenticated;
revoke all on table public.discord_versiculos_usados from anon, authenticated;
grant all on table public.discord_configuracoes to service_role;
grant all on table public.discord_versiculos to service_role;
grant all on table public.discord_versiculos_usados to service_role;

create or replace function public.discord_sortear_versiculo(
  p_guild_id text default null,
  p_user_id text default null
)
returns table (
  id text,
  texto text,
  referencia text,
  ciclo_reiniciado boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_versiculo public.discord_versiculos%rowtype;
  v_ciclo_reiniciado boolean := false;
begin
  -- Pool e ciclo são globais; o lock serializa chamadas de todos os servidores.
  perform pg_catalog.pg_advisory_xact_lock(74920114, 1);

  select v.*
    into v_versiculo
    from public.discord_versiculos as v
   where not exists (
     select 1
       from public.discord_versiculos_usados as u
      where u.versiculo_id = v.id
   )
   order by pg_catalog.random()
   limit 1;

  if not found then
    delete from public.discord_versiculos_usados;
    v_ciclo_reiniciado := true;

    select v.*
      into v_versiculo
      from public.discord_versiculos as v
     order by pg_catalog.random()
     limit 1;
  end if;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Nenhum versículo cadastrado; execute scripts/seed-versiculos.js.';
  end if;

  insert into public.discord_versiculos_usados (versiculo_id, guild_id, user_id)
  values (v_versiculo.id, p_guild_id, p_user_id)
  on conflict (versiculo_id) do nothing;

  return query
    select v_versiculo.id, v_versiculo.texto, v_versiculo.referencia, v_ciclo_reiniciado;
end;
$$;

revoke all on function public.discord_sortear_versiculo(text, text) from public, anon, authenticated;
grant execute on function public.discord_sortear_versiculo(text, text) to service_role;
