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
  → **Lançar tudo** (grava entradas de venda e saídas de custo/dízimo/alim/transp).
- **Dashboard**: barra de proporção, KPIs e comparativo vs mês anterior.
- **Offline**: a 2ª abertura renderiza do cache local; as ações confirmam só
  quando o servidor responde (sem "fantasma" de lançamento).

## Migrando da planilha Google (legado)

A versão anterior gravava numa planilha via Apps Script. O `apps-script/`
continua no repositório **só como referência**. Para reaproveitar dados antigos,
exporte as abas como CSV e importe no Table Editor do Supabase
(`meses` = abas, `lancamentos` = linhas com `mes_id`, `tipo`, etc.).

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
├── scripts/
│   ├── test-backend.js       # lógica pura do Code.gs (legado)
│   ├── test-frontend.js      # smoke test com PostgREST mockado
│   ├── test-persistencia.js  # cache não guarda lançamento não confirmado
│   ├── test-cache.js         # 2ª abertura renderiza do cache sem servidor
│   └── deploy-apps-script.sh # [legado] redeploy do Apps Script
├── .github/workflows/
│   └── ci.yml            # CI: roda os 4 testes a cada push
└── README.md
```

## Testes e CI

Só Node, sem dependências:

```bash
node scripts/test-backend.js
node scripts/test-frontend.js
node scripts/test-persistencia.js
node scripts/test-cache.js
```

O GitHub Actions (`.github/workflows/ci.yml`) roda os quatro em todo
`push`/`pull request`.

