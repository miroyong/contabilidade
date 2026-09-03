# Controle Financeiro 💰

Aplicação web simples (HTML/CSS/JS, **sem dependências** e sem build) com
backend no **Supabase (Postgres)**. Lançamentos, meses, totais e gráficos
ficam no banco, acessados direto do navegador via REST (PostgREST).

- Lançamento rápido de entradas e saídas
- Extrato com filtros (tipo, categoria, conta, busca)
- Resumo automático: totais, balanço e gráfico de saídas por categoria
- Editar e excluir lançamentos
- Meses criados sob demanda (sem necessidade de "aba" na planilha)

## Como funciona

```
App web (GitHub Pages) ── fetch /rest/v1 (PostgREST) ──▶ Supabase (Postgres)
```

O navegador fala direto com a API REST do Supabase usando a chave pública
**anon**. O schema está em `supabase/schema.sql`:

- **`meses`** — `id "YYYY-MM"` (ex.: `2026-08`), criado pelo usuário
- **`lancamentos`** — uma linha por lançamento:
  `tipo` (entrada/saida), `data`, `descricao`, `categoria`, `conta`, `valor`

## Passo 1 — Criar o banco (1 vez)

1. No [Supabase Dashboard](https://supabase.com/dashboard), crie/abra o projeto.
2. **SQL Editor** → cole o conteúdo de `supabase/schema.sql` → **Run**.
   Cria as tabelas, índices e políticas RLS (é idempotente).
3. Em **Project Settings → API**, copie:
   - **Project URL** (ex.: `https://abcdefgh.supabase.co`)
   - **anon public** (a chave `anon` — ela é pública mesmo; a proteção real
     é o RLS, que pode ser apertado para exigir login depois)

## Passo 2 — Configurar o site

Edite `config.js` e preencha:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://SEU_PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "sua-chave-anon-publica"
};
```

## Passo 3 — Publicar no GitHub Pages

```bash
gh repo create contabilidade --public --source . --push
gh api -X POST repos/miroyong/contabilidade/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```

O site fica em: https://miroyong.github.io/contabilidade/

## Uso

- **＋ Novo lançamento**: escolha Entrada/Saída, preencha e Salvar.
  Valor aceita `1.234,56` ou `1234.56`.
- **Chips de mês**: alternam entre os meses (id `YYYY-MM`, rótulo em pt-BR).
- **＋ (criar mês)**: cria um mês — digite ex.: `Setembro` ou `Setembro 2026`
  (sem ano, usa o ano corrente).
- **✏️ / 🗑️**: editar ou excluir um lançamento (identificado por `uuid`).
- Os totais do app são calculados a partir dos lançamentos carregados.

## Migrando da planilha Google (legado)

A versão antiga usava Google Sheets + Apps Script. O `apps-script/Code.gs`
continua no repositório **só como referência** (não é mais usado). Para
reaproveitar os dados: exporte cada aba do mês como CSV e importe no
Table Editor do Supabase, ou use os `INSERT`s de exemplo no fim de
`supabase/schema.sql`.

## Estrutura do projeto

```
contabilidade/
├── index.html            # página principal
├── style.css             # estilo (mobile-first)
├── app.js                # lógica do app (fala com Supabase via fetch)
├── config.js             # SUPABASE_URL + SUPABASE_ANON_KEY (PREENCHER)
├── supabase/
│   └── schema.sql        # tabelas meses/lancamentos + RLS (rodar no SQL Editor)
├── apps-script/
│   └── Code.gs           # [legado] backend antigo do Google Sheets (não usar)
├── scripts/
│   ├── test-backend.js   # testes da lógica pura do Code.gs (legado)
│   └── test-frontend.js  # smoke test do app.js com PostgREST mockado
├── .github/workflows/
│   └── ci.yml            # CI: roda os testes a cada push
└── README.md
```

## Testes e CI

Os testes não precisam de dependências — só Node:

```bash
node scripts/test-backend.js    # lógica pura do Code.gs (legado)
node scripts/test-frontend.js   # carrega o app com PostgREST mockado e checa o render
```

O GitHub Actions (`.github/workflows/ci.yml`) roda os dois automaticamente em
todo `push`/`pull request`.

