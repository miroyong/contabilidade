-- ============================================================
-- CONTROLE FINANCEIRO — schema Supabase (Postgres)
--
-- COMO USAR:
--   Dashboard do Supabase → SQL Editor → cole este arquivo → Run.
--   (Idempotente: pode rodar de novo sem quebrar.)
--
-- MODELO:
--   meses(id "YYYY-MM")  → 1..N  lancamentos
--   Substitui as "abas de mês" da planilha (Agosto, Setembro...).
--   Cada lançamento: tipo (entrada/saida), data, descrição,
--   categoria, conta, valor.
-- ============================================================

-- ---------------------------------------------------------------- tabelas
create table if not exists public.meses (
  id text primary key check (id ~ '^\d{4}-(0[1-9]|1[0-2])$'), -- ex.: '2026-08'
  criado_em timestamptz not null default now()
);

create table if not exists public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  mes_id text not null references public.meses(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  data date not null,
  descricao text not null check (char_length(descricao) between 1 and 120),
  categoria text not null default '' check (char_length(categoria) <= 120),
  conta text not null default '' check (char_length(conta) <= 120),
  valor numeric(12, 2) not null check (valor > 0),
  criado_em timestamptz not null default now()
);

create index if not exists idx_lancamentos_mes   on public.lancamentos (mes_id);
create index if not exists idx_lancamentos_data  on public.lancamentos (data);
create index if not exists idx_lancamentos_tipo  on public.lancamentos (tipo);

-- ------------------------------------------------------------- permissões
-- App pessoal: as tabelas ficam acessíveis via anon (mesma exposição da
-- antiga APP_KEY no config.js). Para travar de verdade, troque as policies
-- por autenticação (ex.: auth.uid() = dono) — ver comentário no fim.
alter table public.meses enable row level security;
alter table public.lancamentos enable row level security;

drop policy if exists "meses_anon_all" on public.meses;
create policy "meses_anon_all" on public.meses
  for all to anon using (true) with check (true);

drop policy if exists "lancamentos_anon_all" on public.lancamentos;
create policy "lancamentos_anon_all" on public.lancamentos
  for all to anon using (true) with check (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.meses to anon;
grant select, insert, update, delete on public.lancamentos to anon;

-- ============================================================
-- Opcional — migrar dados da planilha Google
-- ============================================================
-- Exporte as abas como CSV e importe no Dashboard (Table Editor → Import),
-- ou use uma migration assim por mês (ex.: Agosto/2026):
--
-- insert into public.meses (id) values ('2026-08') on conflict do nothing;
-- insert into public.lancamentos (mes_id, tipo, data, descricao, categoria, conta, valor)
-- select '2026-08', 'entrada', to_date('05/08/2026', 'DD/MM/YYYY'), 'Salário',
--        'Salário', 'Banco do Brasil', 2500.00;

-- ============================================================
-- Opcional — endurecer para "somente o dono"
-- ============================================================
-- Se você adicionar Supabase Auth, crie a coluna user_id e troque as policies:
--   alter table public.lancamentos add column user_id uuid default auth.uid();
--   drop policy "lancamentos_anon_all" on public.lancamentos;
--   create policy "lancamentos_dono" on public.lancamentos
--     for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
--   (o mesmo para public.meses; e revoke o acesso do anon acima)
