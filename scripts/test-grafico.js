// ============================================================
// Cartão "Saídas líquidas por categoria" (app.js) com DOM/PostgREST mockados.
// Uso: node scripts/test-grafico.js
//
// Valida a regra do líquido por categoria:
//   • toda categoria com saída aparece (nada de corte nas 6 maiores);
//   • entradas da mesma categoria abatem as saídas (dízimo que só passou pelo
//     caixa, entrou e foi repassado à sede, não conta como gasto cheio);
//   • entradas maiores que as saídas zeram a barra (nunca valor negativo);
//   • categoria só com entradas (ex.: Salário) fica fora do cartão.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------- DOM mock mínimo (mesmo padrão dos outros testes) ----------
function makeEl(id) {
  const el = {
    id, hidden: false, innerHTML: '', value: '', className: '', disabled: false,
    dataset: {}, style: {}, open: false, _timer: null, _tc: '',
    classList: { add() {}, remove() {}, toggle() {} },
    _cb: {},
    addEventListener(ev, cb) { this._cb[ev] = cb; },
    focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._tc; },
    set(v) { this._tc = String(v); }
  });
  return el;
}
const els = {};
const byId = (id) => (els[id] || (els[id] = makeEl(id)));

global.document = {
  getElementById: byId,
  querySelectorAll: () => [],
  querySelector: (sel) => makeEl(sel),
  documentElement: { dataset: {} }
};
global.window = { APP_CONFIG: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'chave' } };
global.window.matchMedia = () => ({ matches: false });
const memStore = {};
global.localStorage = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; }
};
global.requestAnimationFrame = (fn) => fn();
global.confirm = () => true;
global.prompt = () => null;
global.Intl = Intl;

// ---------- mês corrente (determinístico em qualquer data) ----------
const pad2 = (n) => ('0' + n).slice(-2);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const agora = new Date();
const ano = agora.getFullYear();
const curName = cap(agora.toLocaleDateString('pt-BR', { month: 'long' }));
const mm = pad2(agora.getMonth() + 1);
const d = (dia) => ano + '-' + mm + '-' + pad2(dia);

// 9 categorias de saída + entradas que abatem 3 delas: os R$ 100 de dízimo
// recebidos numa arrecadação individual e repassados à sede (R$ 500 de saída)
// deixam a categoria em R$ 400, e o material ressarcido zera "Custos".
const ROWS = [
  // entradas: Salário não tem saída (fica fora do cartão)
  { num: 10, tipo: 'entrada', data: d(1), descricao: 'Salário', categoria: 'Salário', conta: 'Pix', valor: 5000 },
  { num: 11, tipo: 'entrada', data: d(2), descricao: 'Dízimo recebido (arrecadação individual)', categoria: 'Dízimo', conta: 'Pix', valor: 100 },
  { num: 12, tipo: 'entrada', data: d(3), descricao: 'Reembolso do plano', categoria: 'Saúde', conta: 'Pix', valor: 250 },
  { num: 13, tipo: 'entrada', data: d(4), descricao: 'Ressarcimento do material', categoria: 'Custos', conta: 'Dinheiro', valor: 400 },
  // saídas
  { num: 20, tipo: 'saida', data: d(5), descricao: 'Aluguel', categoria: 'Moradia', conta: 'Pix', valor: 1200 },
  { num: 21, tipo: 'saida', data: d(6), descricao: 'Mercado', categoria: 'Alimentação', conta: 'Dinheiro', valor: 900 },
  { num: 22, tipo: 'saida', data: d(7), descricao: 'Ônibus', categoria: 'Transporte', conta: 'Dinheiro', valor: 400 },
  { num: 23, tipo: 'saida', data: d(8), descricao: 'Consulta', categoria: 'Saúde', conta: 'Pix', valor: 600 },
  { num: 24, tipo: 'saida', data: d(9), descricao: 'Luz', categoria: 'Contas', conta: 'Pix', valor: 250 },
  { num: 25, tipo: 'saida', data: d(10), descricao: 'Escola', categoria: 'Educação', conta: 'Pix', valor: 220 },
  { num: 26, tipo: 'saida', data: d(11), descricao: 'Cinema', categoria: 'Lazer', conta: 'Dinheiro', valor: 120 },
  { num: 27, tipo: 'saida', data: d(12), descricao: 'Material do chaveiro', categoria: 'Custos', conta: 'Pix', valor: 300 },
  { num: 28, tipo: 'saida', data: d(13), descricao: 'Dízimo enviado à sede', categoria: 'Dízimo', conta: 'Pix', valor: 500 }
];

// líquido por categoria (saídas − entradas), do maior para o menor
const ESPERADO = [
  { nome: 'Moradia', valor: 'R$ 1.200,00' },
  { nome: 'Alimentação', valor: 'R$ 900,00' },
  { nome: 'Transporte', valor: 'R$ 400,00' },
  { nome: 'Dízimo', valor: 'R$ 400,00' },     // 500 de saída − 100 de entrada
  { nome: 'Saúde', valor: 'R$ 350,00' },      // 600 − 250
  { nome: 'Contas', valor: 'R$ 250,00' },
  { nome: 'Educação', valor: 'R$ 220,00' },
  { nome: 'Lazer', valor: 'R$ 120,00' },
  { nome: 'Custos', valor: 'R$ 0,00' }        // entradas (400) maiores que a saída (300)
];
const SOMA_LIQUIDA = 3840;   // 1200+900+400+400+350+250+220+120+0
const TOTAL_SAIDAS = 4490;   // saídas brutas do mês

// ---------- fetch mock (PostgREST) ----------
function okJson(body, status = 200) {
  return { ok: status >= 200 && status < 300, status,
    text: () => Promise.resolve(body == null ? '' : JSON.stringify(body)) };
}
global.fetch = (url, opts) => {
  const u = new URL(url);
  const table = (u.pathname.match(/\/rest\/v1\/(\w+)/) || [])[1] || '';
  const q = u.searchParams;
  if (table === 'meses') {
    if (q.has('id')) {
      const id = q.get('id').replace(/^eq\./, '');
      return Promise.resolve(okJson(id === curName ? [{ id }] : []));
    }
    return Promise.resolve(okJson([{ id: curName }]));
  }
  if (table === 'lancamentos') {
    if (q.get('select') === 'categoria,conta') {
      return Promise.resolve(okJson(ROWS.map((r) => ({ categoria: r.categoria, conta: r.conta }))));
    }
    return Promise.resolve(okJson(ROWS));
  }
  return Promise.resolve(okJson([]));
};

// ---------- carrega e executa o app ----------
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
eval(appJs);

// ---------- verificações ----------
const norm = (s) => String(s).replace(/\u00A0/g, ' ');
const brl = (s) => Number(String(s).replace(/[^\d,]/g, '').replace(',', '.'));
// cada barra do gráfico: <div class="barra-linha"> … title="Categoria" … barra-valor</div>
const lerBarras = (html) => norm(html).split('<div class="barra-linha">').slice(1).map((bloco) => ({
  nome: (bloco.match(/title="([^"]+)"/) || [])[1],
  valor: (bloco.match(/barra-valor">([^<]+)</) || [])[1]
}));

setTimeout(() => {
  const html = norm(els['grafico'].innerHTML);
  const barras = lerBarras(els['grafico'].innerHTML);

  // (1) nenhuma categoria fica de fora do cálculo final
  assert.deepStrictEqual(barras.map((b) => b.nome), ESPERADO.map((e) => e.nome),
    'gráfico lista todas as categorias do mês, em ordem decrescente (' +
    barras.map((b) => b.nome).join(', ') + ')');

  // (2) cada categoria com o líquido certo
  ESPERADO.forEach((e) => {
    const barra = barras.filter((b) => b.nome === e.nome)[0];
    assert.ok(barra, 'categoria ' + e.nome + ' aparece no gráfico');
    assert.strictEqual(barra.valor, e.valor, 'categoria ' + e.nome + ' vale ' + e.valor + ' (líquido)');
  });

  // (3) o dízimo repassado não aparece como gasto cheio
  assert.ok(!html.includes('R$ 500,00'),
    'dízimo de R$ 500 com R$ 100 recebidos não conta como R$ 500 de gasto');

  // (4) a soma das barras é saídas − entradas daquelas categorias
  const soma = barras.reduce((s, b) => s + brl(b.valor), 0);
  assert.strictEqual(soma, SOMA_LIQUIDA, 'soma das barras = saídas líquidas');
  assert.notStrictEqual(soma, TOTAL_SAIDAS, 'soma das barras desconta as entradas das categorias');

  // (5) categoria só com entrada (Salário) fica fora do cartão
  assert.ok(!html.includes('Salário'), 'categoria sem saída não entra no cartão');

  // (6) KPI "Categoria top" usa o mesmo líquido e a mesma base
  const kpis = norm(els['insights'].innerHTML);
  assert.ok(/Categoria top<\/span><span class="kpi-val">Moradia<\/span>[\s\S]*?R\$ 1\.200,00 · 31% do líquido/.test(kpis),
    'KPI usa o líquido e a base líquida (1200 de 3840 = 31%)');

  // (7) o líquido é calculado uma vez só e o gráfico não corta categorias
  assert.ok(appJs.includes('function abaterEntradas'), 'líquido centralizado em abaterEntradas');
  assert.ok(!appJs.includes('.slice(0, 6)'), 'gráfico não corta mais nas 6 maiores categorias');

  console.log('✔ TESTE DO GRÁFICO POR CATEGORIA PASSOU (líquido de entradas, sem corte)');
  process.exit(0);
}, 300);
