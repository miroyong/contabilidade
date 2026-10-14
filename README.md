# Controle Financeiro

Aplicação web (HTML/CSS/JS, **sem dependências** e sem build) com backend no
**Supabase (Postgres)** via REST (PostgREST). Funciona como PWA (offline
primeiro, com cache local e sincronização) e traz dashboard e relatórios.

- Lançamento rápido de entradas e saídas, com saldo por conta (Pix / Cartão e Dinheiro)
- Hero com o **caixa acumulado**: soma o mês aberto + todos os anteriores
  (o que sobra num mês continua no seguinte); o Dashboard segue mostrando os números do mês
- Extrato com filtros (tipo, categoria, conta, busca)
- Dashboard: barra de proporção entradas × saídas, KPIs do mês e comparativo com o anterior
- Ações por lançamento (⋯): editar, marcar "pago/enviado" em despesas (Dízimo/Custos) e excluir
- Aba Arrecadação (Chaveiros/Brownie): calcula venda/custo/dízimo/alimentação/transporte e lança tudo
- PWA: instala no celular, abre offline e sincroniza quando volta

## Como funciona

```
App web (PWA) ── fetch /rest/v1 (PostgREST) ──▶ Supabase (Postgres)
```

O navegador fala direto com a API REST do Supabase usando a chave pública
**anon**. O contrato do app é simples — meses por nome (ex.: `Agosto`) e cada
lançamento tem `tipo`, `data`, `descricao`, `categoria`, `conta`, `valor`
(a coluna `num` do banco vira a "linha" que o app usa para editar/excluir).

Como a ordem dos meses é a de criação (`criado_em`), o caixa exibido no topo é o
**acumulado até o mês aberto**: uma consulta por mês (em paralelo, para não bater
no teto de linhas do PostgREST) somando entradas, saídas e o saldo de Pix e
Dinheiro. O total acumulado fica no cache local do mês, então abre offline.

Schema documentado em `supabase/schema.sql` (tabelas `meses` e `lancamentos`
+ RLS).

## Passo 1 — Criar o banco (1 vez)

1. No [Supabase Dashboard](https://supabase.com/dashboard), crie/abra o projeto.
2. **SQL Editor** → cole o conteúdo de `supabase/schema.sql` → **Run**.
3. Em **Project Settings → API**, copie **Project URL** e a chave **anon public**.

## Passo 2 — Configurar o site

Edite `config.js` e preencha:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://SEU_PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "sua-chave-anon-publica"
};
```

> A chave anon é pública mesmo — a proteção real é o RLS (que depois pode ser
> apertado para exigir login).

## Passo 3 — Publicar no GitHub Pages

O site está publicado em: https://miroyong.github.io/contabilidade/

Após mudanças:

```bash
git add -A && git commit -m "..." && git push
```

O Pages atualiza sozinho (~1 min). O service worker usa `?v=` e cache versionado
— **suba a versão** (`index.html` + `service-worker.js`) quando trocar os
assets para forçar atualização nos dispositivos.

## Uso

- **＋ Novo lançamento**: escolha Entrada/Saída, preencha e Salvar.
  Valor aceita `1.234,56` ou `1234.56`.
- **Chips de mês**: alternam entre os meses. **＋ (criar mês)** cria um novo.
- **⋯** (na linha do lançamento): abre as ações — editar, marcar pago/enviado ou excluir.
- **Chaveiros / Brownie**: alterna o tipo de arrecadação dentro da aba **Arrecadação**.
- **Arrecadação**: informe quantos levou/voltou e os valores do dia → **Calcular**
  → **Lançar tudo** (grava só as entradas de venda e a saída de dízimo; o custo do
  material entra no dízimo, mas alimentação, transporte e custo não viram saída).
- **Dashboard**: barra de proporção, KPIs e comparativo vs mês anterior.
- **Offline**: a 2ª abertura renderiza do cache local; as ações confirmam só
  quando o servidor responde (sem "fantasma" de lançamento).

## Espelho no Google Sheets (Supabase ➜ planilha)

Os dados do Supabase podem ser copiados para esta planilha:

https://docs.google.com/spreadsheets/d/1WTL4V2AGx_jj84_rKU3Y18tGXgeN4dT9-ciYc0an_dA

Quem faz isso é o `apps-script/MigrarSupabase.gs`. É um **espelho de leitura**:
o Supabase continua sendo a fonte da verdade (a planilha é regravada a cada
execução).

**Instalação (1 vez)**

1. Abra a planilha de destino → **Extensões → Apps Script**.
2. **➕ → Script**, nome `MigrarSupabase`, e cole `apps-script/MigrarSupabase.gs`.
3. Salve e **recarregue a planilha**: aparece o menu **Financeiro**.

**Uso**

- **Financeiro → ⬇️ Migrar tudo do Supabase**: cria/atualiza uma aba por mês.
- **Financeiro → 📅 Migrar um mês…**: aceita `Agosto`, `2026-08` ou `Agosto 2026`.
- **Financeiro → 🔌 Testar conexão**: confere URL/chave e lista os meses do banco.
- Pelo editor: selecione `migrarDoSupabase` e clique ▶ Executar.
- Via URL (com o `Code.gs` no mesmo projeto):
  `/exec?key=cf-2026-k3x9pQ7mZt&action=migrar` (ou `&mes=Agosto`).

**Como os dados ficam na planilha** (mesmo layout do `Code.gs`):

```
linha 6  = cabeçalho · lançamentos a partir da linha 7
A:E      = ENTRADAS (Data, Descrição, Categoria, Conta, Valor)
G:K      = SAÍDAS   (mesma ordem) · F = coluna separadora
C4 / I4  = totais · C1 = balanço (fórmulas recalculadas)
```

- Nome da aba = `meses.id` do banco (`Agosto`); se o mesmo mês existir em 2+
  anos, vira `Agosto 2025` / `Agosto 2026` (ajustável em `MIG_FORMATO_ABA`).
- A marca `✓` de pago/enviado vem dentro da própria Descrição.
- Ordem: data e, no empate, `num` (a "linha" estável do banco).
- As fórmulas `=SUM(E7:E…)`/`=SUM(K7:K…)` são **esticadas** quando o mês passa de
  93 lançamentos (o range do `Code.gs` ia só até a linha 100).
- **Idempotente**: o bloco de lançamentos da aba é limpo e regravado — pode rodar
  quantas vezes quiser, sem duplicar nem deixar linhas órfãs. A leitura é paginada
  (1000 registros por requisição) e um mês com problema não impede os outros.
- Para trocar o destino sem editar o código, salve a propriedade do script
  `SPREADSHEET_ID` (Configurações do projeto → Propriedades do script).
- ⚠️ Como a planilha é regravada, **edite pelo app**, não direto na planilha.

## Estrutura do projeto

```
contabilidade/
├── index.html            # página principal (PWA)
├── style.css             # estilo (mobile-first, claro/escuro)
├── app.js                # lógica do app (fala com Supabase via fetch)
├── config.js             # SUPABASE_URL + SUPABASE_ANON_KEY (PREENCHER)
├── manifest.webmanifest  # PWA
├── service-worker.js     # cache do app shell (não intercepta a API)
├── icons/                # ícones do PWA
├── supabase/
│   └── schema.sql        # tabelas meses/lancamentos + RLS (documentação)
├── apps-script/          # [legado] backend antigo da planilha (não usar)
│   ├── Code.gs               # API da planilha (/exec)
│   └── MigrarSupabase.gs     # espelho Supabase ➜ planilha (menu "Financeiro")
├── scripts/
│   ├── test-backend.js       # lógica pura do Code.gs (legado)
│   ├── test-frontend.js      # smoke test com PostgREST mockado
│   ├── test-persistencia.js  # cache não guarda lançamento não confirmado
│   ├── test-cache.js         # 2ª abertura renderiza do cache sem servidor
│   ├── test-migracao.js      # migração Supabase ➜ Sheets (APIs simuladas)
│   └── deploy-apps-script.sh # [legado] redeploy do Apps Script
├── .github/workflows/
│   └── ci.yml            # CI: roda os 5 testes a cada push
└── README.md
```

## Testes e CI

Só Node, sem dependências:

```bash
node scripts/test-backend.js
node scripts/test-frontend.js
node scripts/test-persistencia.js
node scripts/test-cache.js
node scripts/test-migracao.js
```

O GitHub Actions (`.github/workflows/ci.yml`) roda os cinco em todo
`push`/`pull request`.

