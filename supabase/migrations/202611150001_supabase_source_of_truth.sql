-- Royal AP v3: Supabase como fonte de verdade para mediadores e PIX.
-- Aplicar depois de 202611140001 e 202611140002.

alter table public.royal_profiles add column if not exists apostado bigint not null default 0 check (apostado >= 0);
alter table public.royal_profiles add column if not exists ganho bigint not null default 0 check (ganho >= 0);

alter table public.royal_pix_keys add column if not exists pix_key text;
alter table public.royal_pix_keys add column if not exists pix_holder text;
alter table public.royal_pix_keys add column if not exists pix_city text;
alter table public.royal_pix_keys add column if not exists commission numeric(6,5) not null default 0.05;
alter table public.royal_pix_keys add column if not exists active boolean not null default true;
alter table public.royal_pix_keys add column if not exists registered_at timestamptz not null default now();
alter table public.royal_pix_keys add column if not exists updated_at timestamptz not null default now();
alter table public.royal_pix_keys add column if not exists last_request_id text;

-- Compatibilidade com a tabela criada na v2: copia os nomes antigos uma única vez.
update public.royal_pix_keys set pix_holder = coalesce(pix_holder, holder), pix_city = coalesce(pix_city, city);
create index if not exists royal_pix_active_idx on public.royal_pix_keys(guild_id,active);
create table if not exists public.royal_pix_mutations (
  guild_id text not null, user_id text not null, request_id text not null,
  action text not null, created_at timestamptz not null default now(),
  primary key(guild_id,request_id)
);
revoke all on public.royal_pix_keys, public.royal_pix_mutations from anon, authenticated;
grant select,insert,update on public.royal_pix_keys, public.royal_pix_mutations to service_role;

drop function if exists public.royal_upsert_pix_key(text,text,text,text,text,numeric,text);
create or replace function public.royal_upsert_pix_key(
  p_guild_id text, p_user_id text, p_pix_key text, p_holder text, p_city text,
  p_commission numeric, p_request_id text
) returns table(guild_id text,user_id text,pix_key text,pix_holder text,pix_city text,commission numeric,active boolean,registered_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.royal_pix_keys%rowtype;
begin
  if nullif(trim(p_guild_id),'') is null or nullif(trim(p_user_id),'') is null then raise exception 'Servidor e usuário são obrigatórios'; end if;
  if length(trim(p_pix_key)) < 3 or length(trim(p_pix_key)) > 200 then raise exception 'A chave PIX precisa ter entre 3 e 200 caracteres'; end if;
  if p_commission is null or p_commission < 0 or p_commission > 0.5 then raise exception 'Comissão inválida'; end if;
  if nullif(trim(p_request_id),'') is null then raise exception 'request_id obrigatório'; end if;
  insert into public.royal_pix_mutations(guild_id,user_id,request_id,action) values(p_guild_id,p_user_id,p_request_id,'upsert_pix') on conflict do nothing;
  insert into public.royal_pix_keys(guild_id,user_id,pix_key,pix_holder,pix_city,commission,active,registered_at,updated_at,last_request_id)
  values(trim(p_guild_id),trim(p_user_id),trim(p_pix_key),nullif(trim(p_holder),''),nullif(trim(p_city),''),p_commission,true,now(),now(),p_request_id)
  on conflict(guild_id,user_id) do update set pix_key=excluded.pix_key,pix_holder=excluded.pix_holder,pix_city=excluded.pix_city,commission=excluded.commission,active=true,updated_at=now(),last_request_id=excluded.last_request_id
  returning * into r;
  return query select r.guild_id,r.user_id,r.pix_key,r.pix_holder,r.pix_city,r.commission,r.active,r.registered_at,r.updated_at;
end $$;
grant execute on function public.royal_upsert_pix_key(text,text,text,text,text,numeric,text) to service_role;

-- Regras mínimas para impedir valores inválidos mesmo fora do bot.
alter table public.royal_pix_keys drop constraint if exists royal_pix_keys_commission_check;
alter table public.royal_pix_keys add constraint royal_pix_keys_commission_check check (commission >= 0 and commission <= 0.5);
alter table public.royal_pix_keys drop constraint if exists royal_pix_keys_key_check;
alter table public.royal_pix_keys add constraint royal_pix_keys_key_check check (length(trim(pix_key)) between 3 and 200);

-- Corrige o caminho de retry da compra: sempre busca o item e o perfil da própria compra.
create or replace function public.royal_buy_item(p_guild_id text,p_user_id text,p_item_id uuid,p_request_id text)
returns table(purchase_id uuid,item_name text,new_balance bigint,status text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.royal_shop_items%rowtype; r public.royal_profiles%rowtype; q public.royal_purchases%rowtype;
begin
 if nullif(trim(p_request_id),'') is null or length(trim(p_request_id)) < 8 then raise exception 'request_id inválido'; end if;
 select * into q from public.royal_purchases where guild_id=trim(p_guild_id) and request_id=p_request_id;
 if found then
   select * into i from public.royal_shop_items where id=q.item_id;
   select * into r from public.royal_profiles where guild_id=q.guild_id and user_id=q.user_id;
   return query select q.id,i.name,coalesce(r.coins,0),q.status;
   return;
 end if;
 select * into i from public.royal_shop_items where id=p_item_id and guild_id=trim(p_guild_id) and active for update;
 if not found then raise exception 'Item indisponível'; end if;
 insert into public.royal_profiles(guild_id,user_id) values(trim(p_guild_id),trim(p_user_id)) on conflict do nothing;
 select * into r from public.royal_profiles where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) for update;
 if r.coins<i.price then raise exception 'Saldo insuficiente'; end if;
 if i.stock is not null and i.stock<1 then raise exception 'Item sem estoque'; end if;
 update public.royal_profiles set coins=coins-i.price,updated_at=now() where guild_id=trim(p_guild_id) and user_id=trim(p_user_id);
 if i.stock is not null then update public.royal_shop_items set stock=stock-1,updated_at=now() where id=i.id; end if;
 insert into public.royal_purchases(guild_id,user_id,item_id,price,request_id) values(trim(p_guild_id),trim(p_user_id),i.id,i.price,p_request_id) returning * into q;
 insert into public.royal_inventory(guild_id,user_id,item_id,quantity) values(trim(p_guild_id),trim(p_user_id),i.id,1) on conflict(guild_id,user_id,item_id) do update set quantity=public.royal_inventory.quantity+1,updated_at=now();
 insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id) values(trim(p_guild_id),trim(p_user_id),'coins',-i.price,r.coins-i.price,'compra:'||i.slug,p_request_id);
 return query select q.id,i.name,r.coins-i.price,q.status;
end $$;
grant execute on function public.royal_buy_item(text,text,uuid,text) to service_role;
