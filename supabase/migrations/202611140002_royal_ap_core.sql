-- Royal AP core v2
-- Aplicar no Supabase SQL Editor ou via ferramenta de migração.
-- Todas as operações mutáveis expostas ao bot passam por RPCs atômicas.

create extension if not exists pgcrypto;

create table if not exists public.royal_profiles (
  guild_id text not null,
  user_id text not null,
  coins bigint not null default 0 check (coins >= 0),
  spins bigint not null default 0 check (spins >= 0),
  wins bigint not null default 0 check (wins >= 0),
  losses bigint not null default 0 check (losses >= 0),
  wos bigint not null default 0 check (wos >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);
create table if not exists public.royal_wallet_ledger (
  id uuid primary key default gen_random_uuid(), guild_id text not null, user_id text not null,
  asset text not null check (asset in ('coins','spins')), amount bigint not null,
  balance_after bigint not null check (balance_after >= 0), reason text not null,
  actor_id text, request_id text, created_at timestamptz not null default now(),
  unique (guild_id, user_id, asset, request_id)
);
create table if not exists public.royal_shop_items (
  id uuid primary key default gen_random_uuid(), guild_id text not null, slug text not null,
  name text not null, description text, price bigint not null check (price > 0),
  reward_type text not null check (reward_type in ('coins','spins','role','physical','pix')),
  reward_value text not null, stock bigint check (stock is null or stock >= 0), active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(guild_id, slug)
);
create table if not exists public.royal_purchases (
  id uuid primary key default gen_random_uuid(), guild_id text not null, user_id text not null,
  item_id uuid not null references public.royal_shop_items(id), price bigint not null, status text not null default 'completed' check (status in ('completed','pending','paid','delivered','cancelled')),
  request_id text not null, created_at timestamptz not null default now(), unique(guild_id, request_id)
);
create table if not exists public.royal_inventory (
  guild_id text not null, user_id text not null, item_id uuid not null references public.royal_shop_items(id), quantity bigint not null default 0 check(quantity >= 0), updated_at timestamptz not null default now(),
  primary key(guild_id,user_id,item_id)
);
create table if not exists public.royal_roulette_prizes (
  id uuid primary key default gen_random_uuid(), guild_id text not null, name text not null,
  reward_type text not null check (reward_type in ('coins','spins','role','shop_item')),
  reward_value text not null, weight integer not null check(weight > 0), active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.royal_roulette_spins (
  id uuid primary key default gen_random_uuid(), guild_id text not null, user_id text not null,
  prize_id uuid not null references public.royal_roulette_prizes(id), request_id text not null,
  created_at timestamptz not null default now(), unique(guild_id,request_id)
);
create table if not exists public.royal_invites (
  guild_id text not null, invited_user_id text not null, inviter_user_id text,
  code text, confidence text not null default 'observed' check(confidence in ('observed','unknown')),
  created_at timestamptz not null default now(), primary key(guild_id,invited_user_id)
);
create table if not exists public.royal_audit_events (
  id bigint generated always as identity primary key, guild_id text, actor_id text, action text not null,
  entity_type text, entity_id text, request_id text, before_data jsonb, after_data jsonb, detail text,
  created_at timestamptz not null default now()
);
create index if not exists royal_profiles_rank on public.royal_profiles(guild_id,wins desc,coins desc,spins desc);
create index if not exists royal_invites_rank on public.royal_invites(guild_id,inviter_user_id);
create index if not exists royal_audit_guild on public.royal_audit_events(guild_id,created_at desc);

insert into public.royal_shop_items(guild_id,slug,name,description,price,reward_type,reward_value,metadata)
select g.guild_id, x.slug,x.name,x.description,x.price,x.reward_type,x.reward_value,'{}'::jsonb
from (select distinct guild_id from public.discord_configuracoes) g
cross join (values
 ('pix-5','PIX R$ 5','Resgate PIX de cinco reais',500,'pix','5.00'),
 ('pix-10','PIX R$ 10','Resgate PIX de dez reais',1000,'pix','10.00'),
 ('giro-extra','Giro extra','Um giro adicional na roleta',250,'spins','1')
) x(slug,name,description,price,reward_type,reward_value)
on conflict (guild_id,slug) do nothing;

revoke all on all tables in schema public from anon, authenticated;

create or replace function public.royal_spin(p_guild_id text,p_user_id text,p_request_id text)
returns table(spin_id uuid, prize_id uuid, prize_name text, reward_type text, reward_value text)
language plpgsql security definer set search_path=public as $$
declare p royal_roulette_prizes%rowtype; total integer; pick integer; acc integer := 0; r royal_profiles%rowtype;
begin
 if p_request_id is null or length(trim(p_request_id)) < 8 then raise exception 'request_id inválido'; end if;
 if exists(select 1 from royal_roulette_spins where guild_id=p_guild_id and request_id=p_request_id) then
   return query select s.id,p.id,p.name,p.reward_type,p.reward_value from royal_roulette_spins s join royal_roulette_prizes p on p.id=s.prize_id where s.guild_id=p_guild_id and s.request_id=p_request_id; return;
 end if;
 insert into royal_profiles(guild_id,user_id) values(p_guild_id,p_user_id) on conflict do nothing;
 select * into r from royal_profiles where guild_id=p_guild_id and user_id=p_user_id for update;
 if r.spins < 1 then raise exception 'Você não possui giros disponíveis'; end if;
 select coalesce(sum(weight),0) into total from royal_roulette_prizes where guild_id=p_guild_id and active;
 if total=0 then raise exception 'A roleta ainda não foi configurada'; end if;
 pick := floor(random()*total)::integer+1;
 for p in select * from royal_roulette_prizes where guild_id=p_guild_id and active order by id loop acc:=acc+p.weight; exit when acc>=pick; end loop;
 update royal_profiles set spins=spins-1,updated_at=now() where guild_id=p_guild_id and user_id=p_user_id;
 insert into royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id) values(p_guild_id,p_user_id,'spins',-1,r.spins-1,'roleta',p_request_id);
 insert into royal_roulette_spins(guild_id,user_id,prize_id,request_id) values(p_guild_id,p_user_id,p.id,p_request_id);
 if p.reward_type='coins' then update royal_profiles set coins=coins+(p.reward_value::bigint) where guild_id=p_guild_id and user_id=p_user_id;
 elsif p.reward_type='spins' then update royal_profiles set spins=spins+(p.reward_value::bigint) where guild_id=p_guild_id and user_id=p_user_id; end if;
 return query select s.id,p.id,p.name,p.reward_type,p.reward_value from royal_roulette_spins s join royal_roulette_prizes p on p.id=s.prize_id where s.guild_id=p_guild_id and s.request_id=p_request_id;
end $$;

create or replace function public.royal_buy_item(p_guild_id text,p_user_id text,p_item_id uuid,p_request_id text)
returns table(purchase_id uuid,item_name text,new_balance bigint,status text)
language plpgsql security definer set search_path=public as $$
declare i royal_shop_items%rowtype; r royal_profiles%rowtype; q royal_purchases%rowtype;
begin
 select * into q from royal_purchases where guild_id=p_guild_id and request_id=p_request_id; if found then return query select q.id,i.name,r.coins,q.status from royal_shop_items i,royal_profiles r where i.id=q.item_id and r.guild_id=p_guild_id and r.user_id=p_user_id; return; end if;
 select * into i from royal_shop_items where id=p_item_id and guild_id=p_guild_id and active for update; if not found then raise exception 'Item indisponível'; end if;
 insert into royal_profiles(guild_id,user_id) values(p_guild_id,p_user_id) on conflict do nothing;
 select * into r from royal_profiles where guild_id=p_guild_id and user_id=p_user_id for update;
 if r.coins<i.price then raise exception 'Saldo insuficiente'; end if;
 if i.stock is not null and i.stock<1 then raise exception 'Item sem estoque'; end if;
 update royal_profiles set coins=coins-i.price,updated_at=now() where guild_id=p_guild_id and user_id=p_user_id;
 if i.stock is not null then update royal_shop_items set stock=stock-1,updated_at=now() where id=i.id; end if;
 insert into royal_purchases(guild_id,user_id,item_id,price,request_id) values(p_guild_id,p_user_id,i.id,i.price,p_request_id) returning * into q;
 insert into royal_inventory(guild_id,user_id,item_id,quantity) values(p_guild_id,p_user_id,i.id,1) on conflict(guild_id,user_id,item_id) do update set quantity=royal_inventory.quantity+1,updated_at=now();
 insert into royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id) values(p_guild_id,p_user_id,'coins',-i.price,r.coins-i.price,'compra:'||i.slug,p_request_id);
 return query select q.id,i.name,r.coins-i.price,q.status;
end $$;

grant execute on function public.royal_spin(text,text,text) to service_role;
grant execute on function public.royal_buy_item(text,text,uuid,text) to service_role;

-- Espelhos permanentes dos módulos legados, usados pela sincronização e reconciliação.
create table if not exists public.royal_match_records (
  id text primary key, guild_id text not null, mode text not null, price integer not null,
  status text not null, mediator_id text, winner_team integer, reason text,
  created_at timestamptz not null default now(), finished_at timestamptz
);
create table if not exists public.royal_match_players (
  match_id text not null references public.royal_match_records(id) on delete cascade,
  user_id text not null, team integer not null, confirmed boolean not null default false,
  primary key(match_id,user_id)
);
create table if not exists public.royal_pix_keys (
  guild_id text not null, user_id text not null, pix_key text not null,
  holder text, city text, active boolean not null default true, updated_at timestamptz not null default now(),
  primary key(guild_id,user_id)
);
create table if not exists public.royal_guild_configs (
  guild_id text not null, key text not null, value text, updated_at timestamptz not null default now(),
  primary key(guild_id,key)
);
revoke all on public.royal_match_records, public.royal_match_players, public.royal_pix_keys, public.royal_guild_configs from anon, authenticated;
grant select,insert,update on public.royal_match_records, public.royal_match_players, public.royal_pix_keys, public.royal_guild_configs to service_role;
