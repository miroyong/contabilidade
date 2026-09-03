-- ============================================================
-- CONTROLE FINANCEIRO (app principal, branch main) — schema Supabase
--
-- JÁ APLICADO no projeto via migrations (SQL Editor / MCP).
-- Este arquivo documenta o estado final. Idempotente.
--
-- Modelo de contrato do app:
--   meses.id   = nome da aba (ex.: 'Agosto')  -> colunas por mês
--   lancamentos.num = "linha" numérica estável que o app usa como id
-- ============================================================

create table if not exists public.meses (
  id text primary key,          -- ex.: 'Agosto', 'Setembro'
  criado_em timestamptz not null default now()
);

create table if not exists public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  num bigserial,                -- "linha" estável usada pelo app (editar/excluir)
  mes_id text not null references public.meses(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  data date not null,
  descricao text not null check (char_length(descricao) between 1 and 120),
  categoria text not null default '' check (char_length(categoria) <= 120),
  conta text not null default '' check (char_length(conta) <= 120),
  valor numeric(12, 2) not null check (valor > 0),
  criado_em timestamptz not null default now()
);

create unique index if not exists idx_lancamentos_num  on public.lancamentos (num);
create index if not exists idx_lancamentos_mes   on public.lancamentos (mes_id);
create index if not exists idx_lancamentos_data  on public.lancamentos (data);
create index if not exists idx_lancamentos_tipo  on public.lancamentos (tipo);

-- Permissões do app pessoal (anon). Para travar de verdade depois,
-- troque as policies por autenticação (ex.: auth.uid() = dono).
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
