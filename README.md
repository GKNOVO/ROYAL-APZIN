# ORG Royal AP — Bot Discord v4

Bot Discord.js v14 para filas e apostas de Free Fire, mediação, economia, roleta e lojinha. Na v4, PIX, carteira (moedas e giros), compras, roleta, inventário e rankings de perfis usam o Supabase como fonte de verdade. O dispatcher deduplica interações Discord e os helpers evitam uma segunda resposta inicial quando a API retorna 40060.

## O que mudou na v4

- `InteractionCreate` deduplica por ID antes de qualquer operação assíncrona; o botão PIX abre o modal como primeira resposta e revalida autorização no submit.
- Respostas Discord centralizadas usam `reply` uma única vez e, se o Discord indicar 40060, passam para `followUp` em vez de tentar outro ACK inicial.
- Registro e consulta de PIX, comissão, titular, cidade e autorização continuam exclusivamente no Supabase. O envio de PIX para uma sala lê a chave do Supabase e não grava mais um snapshot em SQLite; as cópias antigas de partidas/auditoria são higienizadas.
- Ajustes de coins/giros/estatísticas, transferências, roleta e compras usam RPCs atômicas com `request_id` idempotente e ledger remoto.
- `/perfil`, `/verp`, `/ranking` e o botão de ranking consultam perfis Supabase; resultados de partidas também atualizam os rankings remotos, com retry idempotente por ID de partida.
- Compras que concedem coins/giros creditam o perfil; resgates PIX/físicos ficam com status `pending`.
- Entregas de cargos da roleta/loja também ficam pendentes no Supabase até a atribuição do Discord ser confirmada; falhas não são descartadas silenciosamente.
- A migração v4 revoga execução pública das RPCs `SECURITY DEFINER`; somente `service_role` pode chamá-las.

## Instalação e atualização

1. Use Node.js 22+ e execute `npm install`.
2. Copie `.env.example` para `.env` e configure `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
3. No SQL Editor do Supabase, aplique as migrações nesta ordem:
   - `supabase/migrations/202611140001_discord_features.sql`
   - `supabase/migrations/202611140002_royal_ap_core.sql`
   - `supabase/migrations/202611150001_supabase_source_of_truth.sql`
   - `supabase/migrations/202611150002_economy_source_of_truth.sql`
4. Faça backup do banco local atual e execute `npm run migrate:supabase` antes de iniciar o bot v4. O backfill usa uma RPC idempotente para importar valores locais em perfis ausentes/zerados, preserva dados remotos não conflitantes e **aborta sem sobrescrever** quando o mesmo perfil tem valores locais/remotos diferentes; reconcilie esses casos manualmente e execute novamente. Após todas as gravações remotas, limpa chaves PIX locais antigas e snapshots/auditoria.
5. Execute `npm run commands:sync` ou deixe o bot sincronizar os comandos no evento `ready`.
6. Inicie com `npm start`.

`SUPABASE_SERVICE_ROLE_KEY` é segredo exclusivo do servidor. Nunca a envie ao Discord, ao cliente ou ao GitHub. O ZIP de distribuição não deve conter `.env`, `node_modules`, bancos locais ou arquivos de credenciais.

## Persistência: limites explícitos

PIX, saldo, giros, roleta, loja, inventário e estatísticas usadas nos rankings são persistidos no Supabase; não há fallback econômico em SQLite. Filas, estado operacional das partidas (canais/mensagens, pagamento, sala e sessão Nix), painéis, plantão, blacklist, telagem e alguns logs/configurações continuam em SQLite. `DATABASE_PATH` permanece necessário para esses módulos. Não remova o volume/backup SQLite até concluir uma migração de cutover específica para o fluxo operacional de partidas.

O backfill é para transição. Não o use como sincronização contínua: após o corte, novas alterações econômicas são feitas somente pelas RPCs Supabase, e um arquivo SQLite antigo não deve ser tratado como autoridade para esses valores.

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

Os produtos podem conceder coins, giros, cargos, resgates físicos ou PIX. Compras e giros usam IDs de interação como chaves de idempotência; estoque, saldo, inventário e ledger são processados pelo Supabase.

## Testes e operação

- `npm test` executa testes offline, incluindo a proteção contra 40060 e verificações estáticas das rotas econômicas Supabase.
- `npm run migrate:supabase` exporta o estado legado sem apagar o banco, reconcilia perfis sem sobrescrever conflitos e remove cópias locais de PIX somente depois de confirmar o backfill.
- `npm run commands:sync` publica a lista atual e remove comandos remotos obsoletos conforme a resposta da API do Discord.
- `npm start` abre também o health check HTTP para Railway/Render.

O bot exige o **Server Members Intent** para rastrear convites. A detecção por diferença de usos é tratada como observação; convites simultâneos ou indisponíveis são registrados sem inventar um convidador.
