# Controle Financeiro

Aplicação web (HTML/CSS/JS, **sem dependências** e sem build) com backend no
**Supabase (Postgres)** via REST (PostgREST). Funciona como PWA (offline
primeiro, com cache local e sincronização) e traz dashboard e relatórios.

- Lançamento rápido de entradas e saídas, com saldo por conta (Pix / Cartão e Dinheiro)
- Hero com o **caixa acumulado**: soma o mês aberto + todos os anteriores
  (o que sobra num mês continua no seguinte); o Dashboard segue mostrando os números do mês
- Extrato com filtros (tipo, categoria, conta, busca)
- Dashboard: barra de proporção entradas × saídas, KPIs do mês e comparativo com o anterior
- Cartão "Saídas líquidas por categoria": lista **todas** as categorias do mês, descontando as
  entradas da mesma categoria (um dízimo recebido e repassado à sede não conta como gasto)
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

- **Financeiro → ⬇️ Migrar tudo do Supabase**: grava todos os meses nas tabelas da aba `Página1`.
- **Financeiro → 📅 Migrar um mês…**: aceita `Agosto`, `2026-08` ou `Agosto 2026`.
- **Financeiro → 🔌 Testar conexão**: confere URL/chave e lista os meses do banco.
- Pelo editor: selecione `migrarDoSupabase` e clique ▶ Executar.
- Via URL (com o `Code.gs` no mesmo projeto):
  `/exec?key=cf-2026-k3x9pQ7mZt&action=migrar` (ou `&mes=Agosto`).

**Como os dados ficam na planilha** — template "120 Dias - Controle Financeiro
Geral", tudo na aba `Página1`, a partir da **linha 18** (a 17 é o cabeçalho):

```
ENTRADAS  B Data · C Valor Bruto · D Custo (fica em branco)
SAÍDAS    J Data · K Descrição · L Categoria · M Valor · N Observação (= conta)
E / F / G = Lucro Bruto, Dízimo (10%) e Valor Líquido  → FÓRMULAS do template
C3 / F3 / J3 = totais de entradas, de saídas e saldo   → FÓRMULAS do template
```

- O template não tem Descrição/Categoria/Conta nas ENTRADAS; para não perder
  dado, elas são gravadas à direita, em `O:P:Q` (`MIG_EXTRAS` — apague ou oculte
  essas colunas se não quiser).
- `E`, `F` e `G` nunca são escritas: quem calcula lucro, dízimo e valor líquido é
  o próprio template. Os blocos **CONTROLE DA ESTADIA** e **PAINEL DE PROGRESSO**
  (linhas 8-13) também não são tocados.
- Ordem: data e, no empate, `num` (a "linha" estável do banco). Como tudo fica na
  mesma aba, isole um mês filtrando a coluna Data.
- **Idempotente**: as tabelas (linha 18 em diante) são limpas e regravadas — rode
  quantas vezes quiser, sem duplicar nem deixar linhas órfãs. A leitura é paginada
  (1000 registros por requisição) e um mês com problema não impede os outros.
- Se a aba de destino não tiver o cabeçalho do template (`Data` em B17 e J17), a
  migração para com erro em vez de escrever no lugar errado.
- `MIG_ABA_POR_MES = true` muda o comportamento: cria **uma aba por mês**, copiada
  de `Página1`, e grava cada mês na sua aba.
- Para trocar o destino sem editar o código, salve a propriedade do script
  `SPREADSHEET_ID` (Configurações do projeto → Propriedades do script).
- ⚠️ Como as tabelas são regravadas, **edite pelo app**, não direto na planilha.

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
│   ├── test-grafico.js       # cartão por categoria: líquido de entradas, sem corte
│   ├── test-persistencia.js  # cache não guarda lançamento não confirmado
│   ├── test-cache.js         # 2ª abertura renderiza do cache sem servidor
│   ├── test-migracao.js      # migração Supabase ➜ Sheets (APIs simuladas)
│   └── deploy-apps-script.sh # [legado] redeploy do Apps Script
├── .github/workflows/
│   └── ci.yml            # CI: roda os 6 testes a cada push
└── README.md
```

## Testes e CI

Só Node, sem dependências:

```bash
node scripts/test-backend.js
node scripts/test-frontend.js
node scripts/test-grafico.js
node scripts/test-persistencia.js
node scripts/test-cache.js
node scripts/test-migracao.js
```

O GitHub Actions (`.github/workflows/ci.yml`) roda os seis em todo
`push`/`pull request`.

