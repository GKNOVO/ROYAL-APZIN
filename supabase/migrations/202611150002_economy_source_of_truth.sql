-- Royal AP v4: fonte de verdade Supabase para carteira, giros, resultados e rankings.
-- Aplicar após 202611150001_supabase_source_of_truth.sql.

create table if not exists public.royal_economy_requests (
  guild_id text not null,
  request_id text not null,
  operation text not null,
  user_id text,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (guild_id, request_id)
);

create table if not exists public.royal_match_stats_applied (
  guild_id text not null,
  match_id text not null,
  winner_time integer not null,
  stake bigint not null,
  reason text,
  players jsonb not null,
  created_at timestamptz not null default now(),
  primary key (guild_id, match_id)
);

create table if not exists public.royal_reward_deliveries (
  guild_id text not null,
  request_id text not null,
  user_id text not null,
  reward_type text not null check (reward_type = 'role'),
  reward_value text not null,
  status text not null default 'pending' check (status in ('pending','delivered')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (guild_id, request_id)
);

revoke all on public.royal_economy_requests, public.royal_match_stats_applied, public.royal_reward_deliveries from anon, authenticated;
grant select, insert, update on public.royal_economy_requests to service_role;
grant select, insert on public.royal_match_stats_applied to service_role;
grant select, insert, update on public.royal_reward_deliveries to service_role;

-- Toda mutação de perfil é serializada por request_id e grava extrato de coins/spins.
create or replace function public.royal_adjust_profile(
  p_guild_id text,
  p_user_id text,
  p_deltas jsonb,
  p_reason text,
  p_actor_id text,
  p_request_id text
) returns table(coins bigint, spins bigint, wins bigint, losses bigint, wos bigint, apostado bigint, ganho bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  existing public.royal_economy_requests%rowtype;
  d_coins bigint := coalesce((p_deltas->>'coins')::bigint, 0);
  d_spins bigint := coalesce((p_deltas->>'spins')::bigint, 0);
  d_wins bigint := coalesce((p_deltas->>'wins')::bigint, 0);
  d_losses bigint := coalesce((p_deltas->>'losses')::bigint, 0);
  d_wos bigint := coalesce((p_deltas->>'wos')::bigint, 0);
  d_apostado bigint := coalesce((p_deltas->>'apostado')::bigint, 0);
  d_ganho bigint := coalesce((p_deltas->>'ganho')::bigint, 0);
  r public.royal_profiles%rowtype;
  k text;
begin
  if nullif(trim(p_guild_id), '') is null or nullif(trim(p_user_id), '') is null then
    raise exception 'Servidor e usuário são obrigatórios';
  end if;
  if nullif(trim(p_request_id), '') is null then raise exception 'request_id obrigatório'; end if;
  for k in select jsonb_object_keys(coalesce(p_deltas, '{}'::jsonb)) loop
    if k not in ('coins','spins','wins','losses','wos','apostado','ganho') then
      raise exception 'Campo de perfil não permitido: %', k;
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(trim(p_guild_id)||':'||trim(p_request_id), 0));
  select * into existing from public.royal_economy_requests
   where guild_id=trim(p_guild_id) and request_id=trim(p_request_id);
  if found then
    if existing.operation <> 'adjust_profile' or existing.user_id <> trim(p_user_id) then
      raise exception 'request_id já utilizado em outra operação';
    end if;
    if existing.response->'deltas' is distinct from coalesce(p_deltas, '{}'::jsonb) then
      raise exception 'request_id reutilizado com ajustes diferentes';
    end if;
    return query select
      (existing.response->>'coins')::bigint, (existing.response->>'spins')::bigint,
      (existing.response->>'wins')::bigint, (existing.response->>'losses')::bigint,
      (existing.response->>'wos')::bigint, (existing.response->>'apostado')::bigint,
      (existing.response->>'ganho')::bigint;
    return;
  end if;

  insert into public.royal_economy_requests(guild_id,request_id,operation,user_id)
  values(trim(p_guild_id),trim(p_request_id),'adjust_profile',trim(p_user_id));
  insert into public.royal_profiles(guild_id,user_id) values(trim(p_guild_id),trim(p_user_id)) on conflict do nothing;
  select * into r from public.royal_profiles
   where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) for update;
  if r.coins+d_coins < 0 or r.spins+d_spins < 0 or r.wins+d_wins < 0 or
     r.losses+d_losses < 0 or r.wos+d_wos < 0 or r.apostado+d_apostado < 0 or r.ganho+d_ganho < 0 then
    raise exception 'O ajuste deixaria um saldo ou estatística abaixo de zero';
  end if;

  update public.royal_profiles set
    coins=r.coins+d_coins, spins=r.spins+d_spins, wins=r.wins+d_wins,
    losses=r.losses+d_losses, wos=r.wos+d_wos,
    apostado=r.apostado+d_apostado, ganho=r.ganho+d_ganho, updated_at=now()
  where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) returning * into r;

  if d_coins <> 0 then
    insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,actor_id,request_id)
    values(trim(p_guild_id),trim(p_user_id),'coins',d_coins,r.coins,coalesce(nullif(trim(p_reason),''),'ajuste'),p_actor_id,trim(p_request_id));
  end if;
  if d_spins <> 0 then
    insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,actor_id,request_id)
    values(trim(p_guild_id),trim(p_user_id),'spins',d_spins,r.spins,coalesce(nullif(trim(p_reason),''),'ajuste'),p_actor_id,trim(p_request_id));
  end if;
  update public.royal_economy_requests set response=jsonb_build_object(
    'coins',r.coins,'spins',r.spins,'wins',r.wins,'losses',r.losses,'wos',r.wos,
    'apostado',r.apostado,'ganho',r.ganho,'deltas',coalesce(p_deltas, '{}'::jsonb)
  ) where guild_id=trim(p_guild_id) and request_id=trim(p_request_id);
  return query select r.coins,r.spins,r.wins,r.losses,r.wos,r.apostado,r.ganho;
end $$;

-- Transferência atômica entre perfis, protegida contra replay e concorrência.
create or replace function public.royal_transfer_coins(
  p_guild_id text,
  p_from_user_id text,
  p_to_user_id text,
  p_amount bigint,
  p_actor_id text,
  p_reason text,
  p_request_id text
) returns table(from_balance bigint, to_balance bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  existing public.royal_economy_requests%rowtype;
  from_row public.royal_profiles%rowtype;
  to_row public.royal_profiles%rowtype;
begin
  if nullif(trim(p_guild_id),'') is null or nullif(trim(p_from_user_id),'') is null or nullif(trim(p_to_user_id),'') is null then
    raise exception 'Servidor e usuários são obrigatórios';
  end if;
  if trim(p_from_user_id)=trim(p_to_user_id) then raise exception 'Você não pode transferir para si mesmo'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Informe um valor maior que zero'; end if;
  if nullif(trim(p_request_id),'') is null then raise exception 'request_id obrigatório'; end if;

  perform pg_advisory_xact_lock(hashtextextended(trim(p_guild_id)||':'||trim(p_request_id), 0));
  select * into existing from public.royal_economy_requests
   where guild_id=trim(p_guild_id) and request_id=trim(p_request_id);
  if found then
    if existing.operation <> 'transfer_coins' or existing.user_id <> trim(p_from_user_id) then
      raise exception 'request_id já utilizado em outra operação';
    end if;
    if existing.response->>'to_user_id' is distinct from trim(p_to_user_id) or
       existing.response->>'amount' is distinct from p_amount::text then
      raise exception 'request_id reutilizado com destino/valor diferentes';
    end if;
    return query select (existing.response->>'from_balance')::bigint,(existing.response->>'to_balance')::bigint;
    return;
  end if;

  insert into public.royal_economy_requests(guild_id,request_id,operation,user_id)
  values(trim(p_guild_id),trim(p_request_id),'transfer_coins',trim(p_from_user_id));
  insert into public.royal_profiles(guild_id,user_id) values(trim(p_guild_id),trim(p_from_user_id)) on conflict do nothing;
  insert into public.royal_profiles(guild_id,user_id) values(trim(p_guild_id),trim(p_to_user_id)) on conflict do nothing;
  perform 1 from public.royal_profiles
   where guild_id=trim(p_guild_id) and user_id in (trim(p_from_user_id),trim(p_to_user_id))
   order by user_id for update;
  select * into from_row from public.royal_profiles where guild_id=trim(p_guild_id) and user_id=trim(p_from_user_id);
  select * into to_row from public.royal_profiles where guild_id=trim(p_guild_id) and user_id=trim(p_to_user_id);
  if from_row.coins < p_amount then raise exception 'Saldo insuficiente'; end if;

  update public.royal_profiles set coins=coins-p_amount,updated_at=now()
   where guild_id=trim(p_guild_id) and user_id=trim(p_from_user_id) returning * into from_row;
  update public.royal_profiles set coins=coins+p_amount,updated_at=now()
   where guild_id=trim(p_guild_id) and user_id=trim(p_to_user_id) returning * into to_row;
  insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,actor_id,request_id)
  values
   (trim(p_guild_id),trim(p_from_user_id),'coins',-p_amount,from_row.coins,coalesce(nullif(trim(p_reason),''),'transferência'),p_actor_id,trim(p_request_id)||':from'),
   (trim(p_guild_id),trim(p_to_user_id),'coins',p_amount,to_row.coins,coalesce(nullif(trim(p_reason),''),'transferência'),p_actor_id,trim(p_request_id)||':to');
  update public.royal_economy_requests set response=jsonb_build_object(
    'from_balance',from_row.coins,'to_balance',to_row.coins,
    'to_user_id',trim(p_to_user_id),'amount',p_amount
  ) where guild_id=trim(p_guild_id) and request_id=trim(p_request_id);
  return query select from_row.coins,to_row.coins;
end $$;

-- Ranking de vitórias/derrotas é atualizado junto com o resultado remoto, uma só vez por partida.
create or replace function public.royal_apply_match_result(
  p_guild_id text,
  p_match_id text,
  p_winner_time integer,
  p_stake bigint,
  p_reason text,
  p_players jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare player jsonb; uid text; team_no integer; r public.royal_profiles%rowtype; existing public.royal_match_stats_applied%rowtype;
begin
  if nullif(trim(p_guild_id),'') is null or nullif(trim(p_match_id),'') is null then raise exception 'Servidor e partida são obrigatórios'; end if;
  if p_winner_time is null or p_winner_time not in (1,2) then raise exception 'Time vencedor inválido'; end if;
  if p_stake is null or p_stake < 0 then raise exception 'Aposta inválida'; end if;
  if jsonb_typeof(p_players) <> 'array' or jsonb_array_length(p_players)=0 then raise exception 'Lista de jogadores inválida'; end if;

  perform pg_advisory_xact_lock(hashtextextended(trim(p_guild_id)||':match:'||trim(p_match_id), 0));
  select * into existing from public.royal_match_stats_applied where guild_id=trim(p_guild_id) and match_id=trim(p_match_id);
  if found then
    if existing.winner_time is distinct from p_winner_time or existing.stake is distinct from p_stake or
       existing.reason is distinct from p_reason or existing.players is distinct from p_players then
      raise exception 'partida já registrada com resultado diferente';
    end if;
    return true;
  end if;

  insert into public.royal_match_stats_applied(guild_id,match_id,winner_time,stake,reason,players)
  values(trim(p_guild_id),trim(p_match_id),p_winner_time,p_stake,p_reason,p_players);
  for player in select value from jsonb_array_elements(p_players) loop
    uid := nullif(trim(player->>'user_id'),'');
    team_no := (player->>'team')::integer;
    if uid is null or team_no is null or team_no not in (1,2) then raise exception 'Jogador ou time inválido no resultado'; end if;
    insert into public.royal_profiles(guild_id,user_id) values(trim(p_guild_id),uid) on conflict do nothing;
    select * into r from public.royal_profiles where guild_id=trim(p_guild_id) and user_id=uid for update;
    if team_no=p_winner_time then
      update public.royal_profiles set wins=wins+1,apostado=apostado+p_stake,ganho=ganho+p_stake,updated_at=now()
       where guild_id=trim(p_guild_id) and user_id=uid;
    else
      update public.royal_profiles set losses=losses+1,apostado=apostado+p_stake,
        wos=wos+case when p_reason='wo' then 1 else 0 end,updated_at=now()
       where guild_id=trim(p_guild_id) and user_id=uid;
    end if;
  end loop;
  return true;
end $$;

-- Roleta: lock da request, débito e crédito de prêmios de carteira ficam atômicos.
create or replace function public.royal_spin(p_guild_id text,p_user_id text,p_request_id text)
returns table(spin_id uuid, prize_id uuid, prize_name text, reward_type text, reward_value text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.royal_roulette_prizes%rowtype; total integer; pick integer; acc integer := 0; r public.royal_profiles%rowtype; new_balance bigint; existing record; affected integer;
begin
 if nullif(trim(p_request_id),'') is null or length(trim(p_request_id)) < 8 then raise exception 'request_id inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(trim(p_guild_id)||':spin:'||trim(p_request_id), 0));
 select s.id as spin_id,s.user_id as spin_user_id,p0.id as prize_id,p0.name as prize_name,p0.reward_type,p0.reward_value
 into existing from public.royal_roulette_spins s join public.royal_roulette_prizes p0 on p0.id=s.prize_id
 where s.guild_id=trim(p_guild_id) and s.request_id=trim(p_request_id);
 if found then
   if existing.spin_user_id <> trim(p_user_id) then raise exception 'request_id pertence a outro usuário'; end if;
   return query select existing.spin_id,existing.prize_id,existing.prize_name,existing.reward_type,existing.reward_value;
   return;
 end if;
 insert into public.royal_profiles(guild_id,user_id) values(trim(p_guild_id),trim(p_user_id)) on conflict do nothing;
 select * into r from public.royal_profiles where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) for update;
 if r.spins < 1 then raise exception 'Você não possui giros disponíveis'; end if;
 select coalesce(sum(weight),0) into total from public.royal_roulette_prizes where guild_id=trim(p_guild_id) and active;
 if total=0 then raise exception 'A roleta ainda não foi configurada'; end if;
 pick := floor(random()*total)::integer+1;
 for p in select * from public.royal_roulette_prizes where guild_id=trim(p_guild_id) and active order by id loop acc:=acc+p.weight; exit when acc>=pick; end loop;
 update public.royal_profiles set spins=spins-1,updated_at=now() where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) returning * into r;
 insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id)
 values(trim(p_guild_id),trim(p_user_id),'spins',-1,r.spins,'roleta',trim(p_request_id)||':debit');
 insert into public.royal_roulette_spins(guild_id,user_id,prize_id,request_id) values(trim(p_guild_id),trim(p_user_id),p.id,trim(p_request_id));
 if p.reward_type='coins' then
   update public.royal_profiles set coins=coins+(p.reward_value::bigint),updated_at=now() where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) returning coins into new_balance;
   insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id) values(trim(p_guild_id),trim(p_user_id),'coins',p.reward_value::bigint,new_balance,'prêmio roleta',trim(p_request_id)||':reward');
 elsif p.reward_type='spins' then
   update public.royal_profiles set spins=spins+(p.reward_value::bigint),updated_at=now() where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) returning spins into new_balance;
   insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id) values(trim(p_guild_id),trim(p_user_id),'spins',p.reward_value::bigint,new_balance,'prêmio roleta',trim(p_request_id)||':reward');
 elsif p.reward_type='shop_item' then
   insert into public.royal_inventory(guild_id,user_id,item_id,quantity)
   select trim(p_guild_id),trim(p_user_id),i.id,1 from public.royal_shop_items i
    where i.id=p.reward_value::uuid and i.guild_id=trim(p_guild_id) and i.active
   on conflict(guild_id,user_id,item_id) do update set quantity=public.royal_inventory.quantity+1,updated_at=now();
   get diagnostics affected = row_count;
   if affected=0 then raise exception 'Item de prêmio da roleta não existe ou está inativo'; end if;
 elsif p.reward_type='role' then
   insert into public.royal_reward_deliveries(guild_id,request_id,user_id,reward_type,reward_value)
   values(trim(p_guild_id),trim(p_request_id),trim(p_user_id),'role',p.reward_value);
 end if;
 return query select s.id,p.id,p.name,p.reward_type,p.reward_value from public.royal_roulette_spins s join public.royal_roulette_prizes p on p.id=s.prize_id where s.guild_id=trim(p_guild_id) and s.request_id=trim(p_request_id);
end $$;

-- Compra de loja: estoque, débito, recompensa, inventário e compra são transacionais.
create or replace function public.royal_buy_item(p_guild_id text,p_user_id text,p_item_id uuid,p_request_id text)
returns table(purchase_id uuid,item_name text,new_balance bigint,status text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.royal_shop_items%rowtype; r public.royal_profiles%rowtype; q public.royal_purchases%rowtype; already record; reward_amount bigint; new_balance_value bigint; purchase_status text;
begin
 if nullif(trim(p_request_id),'') is null or length(trim(p_request_id))<8 then raise exception 'request_id inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(trim(p_guild_id)||':buy:'||trim(p_request_id),0));
 select q0.id as purchase_id,i0.name as item_name,r0.coins as new_balance,q0.status,q0.user_id,q0.item_id
 into already from public.royal_purchases q0
 join public.royal_shop_items i0 on i0.id=q0.item_id
 join public.royal_profiles r0 on r0.guild_id=q0.guild_id and r0.user_id=q0.user_id
 where q0.guild_id=trim(p_guild_id) and q0.request_id=trim(p_request_id);
 if found then
   if already.user_id <> trim(p_user_id) or already.item_id <> p_item_id then
     raise exception 'request_id reutilizado para outro usuário ou item';
   end if;
   return query select already.purchase_id,already.item_name,already.new_balance,already.status;
   return;
 end if;
 select * into i from public.royal_shop_items where id=p_item_id and guild_id=trim(p_guild_id) and active for update;
 if not found then raise exception 'Item indisponível'; end if;
 insert into public.royal_profiles(guild_id,user_id) values(trim(p_guild_id),trim(p_user_id)) on conflict do nothing;
 select * into r from public.royal_profiles where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) for update;
 if r.coins<i.price then raise exception 'Saldo insuficiente'; end if;
 if i.stock is not null and i.stock<1 then raise exception 'Item sem estoque'; end if;
 update public.royal_profiles set coins=coins-i.price,updated_at=now() where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) returning * into r;
 if i.stock is not null then update public.royal_shop_items set stock=stock-1,updated_at=now() where id=i.id; end if;
 purchase_status := case when i.reward_type in ('pix','physical','role') then 'pending' else 'completed' end;
 insert into public.royal_purchases(guild_id,user_id,item_id,price,request_id,status)
 values(trim(p_guild_id),trim(p_user_id),i.id,i.price,trim(p_request_id),purchase_status) returning * into q;
 insert into public.royal_inventory(guild_id,user_id,item_id,quantity)
 values(trim(p_guild_id),trim(p_user_id),i.id,1)
 on conflict(guild_id,user_id,item_id) do update set quantity=public.royal_inventory.quantity+1,updated_at=now();
 insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id)
 values(trim(p_guild_id),trim(p_user_id),'coins',-i.price,r.coins,'compra:'||i.slug,trim(p_request_id)||':debit');
 if i.reward_type in ('coins','spins') then
   reward_amount := i.reward_value::bigint;
   if reward_amount < 0 then raise exception 'Recompensa de saldo inválida'; end if;
   if i.reward_type='coins' then
     update public.royal_profiles set coins=coins+reward_amount,updated_at=now() where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) returning coins into new_balance_value;
     insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id) values(trim(p_guild_id),trim(p_user_id),'coins',reward_amount,new_balance_value,'recompensa loja:'||i.slug,trim(p_request_id)||':reward');
   else
     update public.royal_profiles set spins=spins+reward_amount,updated_at=now() where guild_id=trim(p_guild_id) and user_id=trim(p_user_id) returning spins into new_balance_value;
     insert into public.royal_wallet_ledger(guild_id,user_id,asset,amount,balance_after,reason,request_id) values(trim(p_guild_id),trim(p_user_id),'spins',reward_amount,new_balance_value,'recompensa loja:'||i.slug,trim(p_request_id)||':reward');
   end if;
   select * into r from public.royal_profiles where guild_id=trim(p_guild_id) and user_id=trim(p_user_id);
 end if;
 return query select q.id,i.name,r.coins,q.status;
end $$;

create or replace function public.royal_mark_reward_delivered(p_guild_id text,p_request_id text,p_user_id text)
returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.royal_reward_deliveries set status='delivered',delivered_at=now()
   where guild_id=trim(p_guild_id) and request_id=trim(p_request_id) and user_id=trim(p_user_id) and status='pending';
  if found then return true; end if;
  if exists(select 1 from public.royal_reward_deliveries where guild_id=trim(p_guild_id) and request_id=trim(p_request_id) and user_id=trim(p_user_id) and status='delivered') then return true; end if;
  raise exception 'Entrega de prêmio pendente não encontrada';
end $$;

create or replace function public.royal_mark_purchase_delivered(p_guild_id text,p_purchase_id uuid,p_user_id text)
returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.royal_purchases q set status='delivered'
   from public.royal_shop_items i
   where q.item_id=i.id and q.id=p_purchase_id and q.guild_id=trim(p_guild_id)
     and q.user_id=trim(p_user_id) and i.reward_type='role' and q.status='pending';
  if found then return true; end if;
  if exists(select 1 from public.royal_purchases where id=p_purchase_id and guild_id=trim(p_guild_id) and user_id=trim(p_user_id) and status='delivered') then return true; end if;
  raise exception 'Compra de cargo pendente não encontrada';
end $$;

create or replace function public.royal_invite_ranking(p_guild_id text,p_limit integer default 10)
returns table(user_id text,total bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  select inviter_user_id,count(*)::bigint as total
    from public.royal_invites
   where guild_id=trim(p_guild_id) and inviter_user_id is not null
   group by inviter_user_id
   order by count(*) desc,inviter_user_id asc
   limit greatest(1,least(coalesce(p_limit,10),100))
$$;

-- Não deixar as funções SECURITY DEFINER publicamente executáveis por padrão.
revoke execute on function public.royal_adjust_profile(text,text,jsonb,text,text,text) from public, anon, authenticated;
revoke execute on function public.royal_transfer_coins(text,text,text,bigint,text,text,text) from public, anon, authenticated;
revoke execute on function public.royal_apply_match_result(text,text,integer,bigint,text,jsonb) from public, anon, authenticated;
revoke execute on function public.royal_spin(text,text,text) from public, anon, authenticated;
revoke execute on function public.royal_buy_item(text,text,uuid,text) from public, anon, authenticated;
revoke execute on function public.royal_invite_ranking(text,integer) from public, anon, authenticated;
revoke execute on function public.royal_mark_reward_delivered(text,text,text) from public, anon, authenticated;
revoke execute on function public.royal_mark_purchase_delivered(text,uuid,text) from public, anon, authenticated;
revoke execute on function public.royal_upsert_pix_key(text,text,text,text,text,numeric,text) from public, anon, authenticated;
grant execute on function public.royal_adjust_profile(text,text,jsonb,text,text,text) to service_role;
grant execute on function public.royal_transfer_coins(text,text,text,bigint,text,text,text) to service_role;
grant execute on function public.royal_apply_match_result(text,text,integer,bigint,text,jsonb) to service_role;
grant execute on function public.royal_spin(text,text,text) to service_role;
grant execute on function public.royal_buy_item(text,text,uuid,text) to service_role;
grant execute on function public.royal_invite_ranking(text,integer) to service_role;
grant execute on function public.royal_mark_reward_delivered(text,text,text) to service_role;
grant execute on function public.royal_mark_purchase_delivered(text,uuid,text) to service_role;
grant execute on function public.royal_upsert_pix_key(text,text,text,text,text,numeric,text) to service_role;
