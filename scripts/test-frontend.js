// ============================================================
// Smoke test do front-end (app.js) com DOM mockado.
// Uso: node scripts/test-frontend.js
// Valida: carregamento, render do saldo/meses/gráfico/lista.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

// ---------- DOM mock mínimo ----------
function makeEl(id) {
  const el = {
    id, hidden: false, innerHTML: '', value: '', className: '',
    dataset: {}, style: {}, open: false, _timer: null, _tc: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
  // textContent do DOM real converte qualquer valor para string
  Object.defineProperty(el, 'textContent', {
    get() { return this._tc; },
    set(v) { this._tc = String(v); }
  });
  return el;
}

const els = {};
const byId = (id) => (els[id] || (els[id] = makeEl(id)));
const ids = ['aviso-config', 'saldo-mes', 'saldo-valor', 'saldo-entradas', 'saldo-saidas',
  'meses-list', 'aviso-mes', 'btn-novo', 'filtro-tipo', 'filtro-categoria', 'filtro-conta',
  'filtro-busca', 'grafico', 'contador', 'lista', 'modal', 'modal-titulo', 'f-data',
  'f-descricao', 'f-categoria', 'f-conta', 'f-valor', 'dl-categorias', 'dl-contas',
  'btn-cancelar', 'btn-novo-mes', 'toast', 'form-lancamento', 'btn-salvar'];

global.document = {
  getElementById: byId,
  querySelectorAll: () => [],
  querySelector: (sel) => makeEl(sel),
  documentElement: { dataset: {} },
};
global.window = { APP_CONFIG: { APPS_SCRIPT_URL: 'https://mock/exec', APP_KEY: 'cf-2026-k3x9pQ7mZt' } };
global.window.matchMedia = () => ({ matches: false });
const memStore = {};
global.localStorage = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; }
};
global.requestAnimationFrame = (fn) => fn();
global.confirm = () => true;
global.prompt = () => 'Setembro';
global.Intl = Intl;

// ---------- fetch mock: responde como o Apps Script ----------
const LANCAMENTOS = {
  ok: true, existe: true, mes: 'Agosto',
  entradas: [
    { linha: 7, data: '2026-08-01', descricao: 'Salário', categoria: 'Salário', conta: 'Banco do Brasil', valor: 2500 },
    { linha: 9, data: '2026-08-15', descricao: 'Freela', categoria: 'Serviços', conta: 'Nubank', valor: 300 }
  ],
  saidas: [
    { linha: 7, data: '2026-08-02', descricao: 'Supermercado', categoria: 'Alimentação', conta: 'Cartão de Crédito', valor: 500 },
    { linha: 8, data: '2026-08-10', descricao: 'Aluguel', categoria: 'Moradia', conta: 'Banco do Brasil', valor: 1200 }
  ],
  totais: { entradas: 2800, saidas: 1700, balanco: 1100 }
};
const MESES = { ok: true, meses: ['Agosto', 'Setembro'], mesAtual: 'Agosto' };
const OPCOES = { ok: true, categorias: ['Salário', 'Serviços', 'Alimentação', 'Moradia'], contas: ['Banco do Brasil', 'Nubank', 'Cartão de Crédito'] };

global.fetch = (url, opts) => {
  const corpo = JSON.parse(opts.body);
  let res;
  if (corpo.action === 'meses') res = MESES;
  else if (corpo.action === 'opcoes') res = OPCOES;
  else if (corpo.action === 'lancamentos') res = LANCAMENTOS;
  else res = { ok: true };
  return Promise.resolve({ json: () => Promise.resolve(res) });
};

// ---------- carrega e executa o app ----------
global.window.APP_CONFIG = global.window.APP_CONFIG;
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
eval(appJs);

// ---------- verifica o resultado ----------
const assert = require('assert');
const norm = (s) => String(s).replace(/\u00A0/g, ' '); // NBSP → espaço normal

setTimeout(() => {
  assert.strictEqual(els['saldo-mes'].textContent, 'Agosto', 'mês selecionado');
  assert.strictEqual(norm(els['saldo-valor'].textContent), 'R$ 1.100,00', 'balanço formatado');
  assert.ok(els['saldo-valor'].className.includes('positivo'), 'classe positivo');
  assert.strictEqual(norm(els['saldo-entradas'].textContent), 'R$ 2.800,00', 'total entradas');
  assert.strictEqual(norm(els['saldo-saidas'].textContent), 'R$ 1.700,00', 'total saídas');

  const mesesHtml = els['meses-list'].innerHTML;
  assert.ok(mesesHtml.includes('Agosto') && mesesHtml.includes('Setembro'), 'chips de mês');
  assert.ok(mesesHtml.includes('chip ativo'), 'chip ativo marcado');

  const graficoHtml = norm(els['grafico'].innerHTML);
  assert.ok(graficoHtml.includes('Moradia') && graficoHtml.includes('R$ 1.200,00'), 'gráfico por categoria');

  const listaHtml = norm(els['lista'].innerHTML);
  assert.ok(listaHtml.includes('Supermercado') && listaHtml.includes('Salário'), 'lista de lançamentos');
  assert.ok(listaHtml.includes('data-edit') && listaHtml.includes('data-del'), 'ações editar/excluir');
  assert.strictEqual(els['contador'].textContent, '4', 'contador de lançamentos');

  // dashboard: pizza + insights renderizados
  const pizzaHtml = els['pizza-grafico'].innerHTML;
  assert.ok(pizzaHtml.includes('pizza-centro') && pizzaHtml.includes('%'), 'pizza renderizada');
  const insightsHtml = els['insights'].innerHTML;
  assert.ok(insightsHtml.includes('insight'), 'insights renderizados');
  assert.ok(insightsHtml.includes('Comprometimento'), 'insight de comprometimento');

  // tema: claro por padrão no mock
  assert.strictEqual(global.document.documentElement.dataset.tema, 'claro', 'tema claro default');

  console.log('✔ SMOKE TEST DO FRONT-END PASSOU (inclui dashboard e tema)');
  process.exit(0);
}, 300);
