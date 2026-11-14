# ORG Royal AP — Bot Discord v2

Bot Discord.js v14 para filas e apostas de Free Fire, mediação, rankings, economia, roleta e lojinha. O SQLite continua sendo usado apenas para compatibilidade operacional das filas e módulos legados; os dados essenciais da economia, inventário, roleta, convites, PIX, partidas espelhadas e auditoria persistem no Supabase/PostgreSQL.

## O que mudou

- Sistema antigo de atendimento removido completamente: arquivos, comandos, handlers, custom IDs, configurações e testes.
- Migração `supabase/migrations/202611140002_royal_ap_core.sql` com constraints, índices, RLS/grants mínimos e RPCs atômicas para giro e compra.
- `/roleta painel` e `/roleta girar`, com consumo idempotente de giros e prêmio ponderado.
- `/lojinha listar`, `/lojinha comprar item:<ID>` e `/inventario`.
- Produtos e prêmios são editáveis diretamente nas tabelas `royal_shop_items` e `royal_roulette_prizes`.
- Convites gravados com a relação correta entre convidador e convidado, incluindo espelhamento no Supabase.
- `scripts/migrar-supabase.js` para exportar dados existentes sem apagar o SQLite.

## Instalação

1. Use Node.js 22+ e execute `npm install`.
2. Copie `.env.example` para `.env` e configure `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. No SQL Editor do Supabase, aplique as migrações em ordem:
   - `supabase/migrations/202611140001_discord_features.sql`
   - `supabase/migrations/202611140002_royal_ap_core.sql`
4. Faça um backup do `DATABASE_PATH` e execute `npm run migrate:supabase` para sincronizar perfis, convites, partidas e PIX.
5. Execute `npm run commands:sync` ou deixe o bot sincronizar os comandos no evento `ready`.
6. Inicie com `npm start`.

A chave `SUPABASE_SERVICE_ROLE_KEY` é somente server-side. Nunca envie essa variável ao Discord, ao cliente ou ao GitHub. O ZIP de distribuição deve ser criado sem `.env`, `node_modules`, bancos locais e artefatos antigos.

## Configurando prêmios e loja

Para adicionar prêmio à roleta:

```sql
insert into public.royal_roulette_prizes
  (guild_id, name, reward_type, reward_value, weight)
values
  ('ID_DO_SERVIDOR', '50 Coins', 'coins', '50', 60),
  ('ID_DO_SERVIDOR', 'Giro bônus', 'spins', '1', 25),
  ('ID_DO_SERVIDOR', 'Cargo VIP', 'role', 'ID_DO_CARGO', 15);
```

Para adicionar produto:

```sql
insert into public.royal_shop_items
  (guild_id, slug, name, description, price, reward_type, reward_value, stock)
values
  ('ID_DO_SERVIDOR', 'acai', 'Copão de Açaí', 'Resgate físico com a ADM', 500, 'physical', 'acai-copao', null);
```

`reward_type` aceita `coins`, `spins`, `role`, `physical` e `pix`. PIX e prêmios físicos ficam registrados no inventário/histórico para pagamento ou entrega pela ADM. Compras e giros usam `request_id` derivado do ID da interação, evitando duplicidade em retries.

## Testes e operação

- `npm test` executa os testes offline e verifica que não restaram tabelas, comandos ou arquivos do atendimento legado.
- `npm run migrate:supabase` é idempotente e não remove registros do SQLite.
- `npm run commands:sync` publica a lista atual e remove comandos remotos obsoletos conforme a resposta da API do Discord.
- `npm start` abre também o health check HTTP para Railway/Render.

O bot exige o **Server Members Intent** para rastrear convites. A detecção por diferença de usos é tratada como observação; convites simultâneos ou indisponíveis são registrados sem inventar um convidador.
