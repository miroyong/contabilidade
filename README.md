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

## Passo 1 — Instalar o Apps Script (1 vez)

1. Abra a planilha:
   https://docs.google.com/spreadsheets/d/1jp7hBdUXn5ZmgxVM8UwZFqLB7B4mT8Irmm3EYGwM9Ns
2. Menu **Extensões → Apps Script**
3. Apague o conteúdo e cole todo o arquivo `apps-script/Code.gs`
4. Clique em **Implantar → Nova implantação**
   - Tipo: **Aplicativo da web**
   - Descrição: `controle financeiro`
   - **Executar como:** `Eu`
   - **Quem tem acesso:** `Qualquer pessoa`
   - Clique em **Implantar** e autorize (a tela de permissão pode avisar que o
     app não é verificado — escolha "Avançado → Acessar ...")
5. Copie a **URL do aplicativo da web** (termina em `/exec`)

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

```bash
cd ~/contabilidade
git init && git add -A && git commit -m "Controle financeiro"
gh repo create contabilidade --public --source . --push
gh api -X POST repos/miroyong/contabilidade/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```

O site fica em: https://miroyong.github.io/contabilidade/

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
