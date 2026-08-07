# Controle Financeiro 💰

Aplicação web simples (HTML/CSS/JS, sem dependências) que lê e grava lançamentos
diretamente na sua planilha Google de contabilidade.

- Lançamento rápido de entradas e saídas (grava na aba do mês)
- Extrato com filtros (tipo, categoria, conta, busca)
- Resumo automático: totais, balanço e gráfico de saídas por categoria
- Editar e excluir lançamentos
- Criação de novas abas de mês com a mesma estrutura da planilha

## Como funciona

```
App web (GitHub Pages)  ──▶  Google Apps Script (Web App)  ──▶  Sua planilha
```

O navegador chama o Apps Script via fetch (JSON). O script lê/escreve nas abas
mensais (Agosto, Setembro, …). Cada aba tem duas tabelas lado a lado:

- ENTRADAS: colunas A–E (Data, Descrição, Categoria, Conta, Valor)
- SAÍDAS:   colunas G–K (Data, Descrição, Categoria, Conta, Valor)

## Passo 1 — Apps Script (JÁ FEITO ✅)

O backend já está implantado via API do Google Apps Script:

- **Projeto (standalone):** ControleFinanceiro
  https://script.google.com/home/projects/1CHsIJJSQMh4a6XpnuIjvCwYlqMnStq00m5DjSfUFVcMYpASDaLkUBOwS/edit
- **URL do web app (no config.js):**
  https://script.google.com/macros/s/AKfycbyAVntpjaF3tfUJ0Rw__8wP7Ry6-nCRvPjQmdd6nTu1fxIsRy9E2n7kqXlB2pcetUbX/exec
- **Config:** Executar como: Eu · Quem tem acesso: Qualquer pessoa
- A autorização pública foi ativada em Implantar → Gerenciar implantações → ✏️ → Nova versão

> ⚠️ **Depois de mudar o `apps-script/Code.gs`**, é preciso publicar uma nova
> versão e redeploy (o /exec serve a versão fixada). Duas opções:
>
> 1. Pela UI (simples): editor do script → Implantar → Gerenciar implantações →
>    ✏️ → Nova versão → Implantar
> 2. Via API (como foi feito): ver `scripts/deploy-apps-script.sh`

## Passo 2 — Configurar o site

Edite `config.js` e preencha:

```js
window.APP_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/SEU_ID/exec",
  APP_KEY: "cf-2026-k3x9pQ7mZt"
};
```

A `APP_KEY` deve ser igual ao `APP_KEY` do `Code.gs` (é uma proteção simples
contra uso indevido da URL pública — pode trocar nos dois lugares).

> ⚠️ Depois de **mudar qualquer coisa no Code.gs**, vá em
> Implantar → Gerenciar implantações → ✏️ (lápis) → **Nova versão** → Implantar.
> O `/exec` serve a versão fixada no deploy — rodar pelo editor não publica.

## Passo 3 — Publicar no GitHub Pages

O site **já está publicado** em: https://miroyong.github.io/contabilidade/

Depois de preencher o `config.js` (Passo 2), envie a atualização:

```bash
cd ~/contabilidade
git add config.js && git commit -m "Configura URL do Apps Script" && git push
```

O GitHub Pages atualiza automaticamente (leva ~1 min).

> Se quiser recriar o repo do zero (não recomendado — já existe):
> ```bash
> gh repo create contabilidade --public --source . --push
> gh api -X POST repos/miroyong/contabilidade/pages \
>   -f 'source[branch]=main' -f 'source[path]=/'
> ```

## Uso

- **＋ Novo lançamento**: escolha Entrada/Saída, preencha e Salvar.
  Data aceita dd/mm/aaaa; valor aceita `1.234,56` ou `1234.56`.
- **Chips de mês**: alternam entre as abas da planilha.
- **＋ (criar mês)**: cria uma nova aba com títulos, cabeçalhos e fórmulas
  iguais às existentes (BALANÇO, TOTAIS, formatação).
- **✏️ / 🗑️**: editar ou excluir um lançamento.
- Os totais mostrados no app são calculados a partir dos lançamentos; a
  planilha mantém as próprias fórmulas (BALANÇO, TOTAL DE ENTRADAS/SAÍDAS).

## Estrutura do projeto

```
contabilidade/
├── index.html        # página principal
├── style.css         # estilo (mobile-first)
├── app.js            # lógica do app
├── config.js         # URL do Apps Script + chave (PREENCHER)
├── apps-script/
│   └── Code.gs       # backend a colar na planilha
└── README.md
```
