// ============================================================
// Teste do cache quente: 2ª abertura renderiza do localStorage
// sem depender do servidor (fetch que nunca resolve).
// Uso: node scripts/test-cache.js
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');

function makeEl(id) {
  const el = {
    id, hidden: false, innerHTML: '', value: '', className: '',
    dataset: {}, style: {}, open: false, _timer: null, _tc: '',
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._tc; },
    set(v) { this._tc = String(v); }
  });
  return el;
}

const memStore = {};
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setup(fetchFn) {
  const els = {};
  const byId = (id) => (els[id] || (els[id] = makeEl(id)));
  const ids = ['aviso-config','saldo-mes','saldo-valor','saldo-entradas','saldo-saidas',
    'meses-list','aviso-mes','btn-novo','filtro-tipo','filtro-categoria','filtro-conta',
    'filtro-busca','grafico','contador','lista','modal','modal-titulo','f-data',
    'f-descricao','f-categoria','f-conta','f-valor','dl-categorias','dl-contas',
    'btn-cancelar','btn-novo-mes','toast','form-lancamento','btn-salvar','sync-status'];
  global.document = {
    getElementById: byId, querySelectorAll: () => [], querySelector: (sel) => makeEl(sel),
    documentElement: { dataset: {} }
  };
  global.window = { APP_CONFIG: { APPS_SCRIPT_URL: 'https://mock/exec', APP_KEY: 'k' } };
  global.window.matchMedia = () => ({ matches: false });
  global.requestAnimationFrame = (fn) => fn();
  global.confirm = () => true;
  global.prompt = () => 'Setembro';
  global.localStorage = {
    getItem: (k) => (k in memStore ? memStore[k] : null),
    setItem: (k, v) => { memStore[k] = String(v); },
    removeItem: (k) => { delete memStore[k]; }
  };
  global.fetch = fetchFn;
  return els;
}

const LANCS = {
  ok: true, existe: true, mes: 'Agosto',
  entradas: [{ linha: 7, data: '2026-08-01', descricao: 'Salário', categoria: 'Salário', conta: 'Banco do Brasil', valor: 2500 }],
  saidas: [{ linha: 7, data: '2026-08-02', descricao: 'Supermercado', categoria: 'Alimentação', conta: 'Cartão', valor: 500 }],
  totais: { entradas: 2500, saidas: 500, balanco: 2000 }
};

// ---------- 1º load: servidor responde (cache fica quente) ----------
let fetchCount = 0;
const fetchOK = (url, opts) => {
  fetchCount++;
  const c = JSON.parse(opts.body);
  let r = c.action === 'meses' ? { ok: true, meses: ['Agosto'], mesAtual: 'Agosto' }
        : c.action === 'opcoes' ? { ok: true, categorias: ['Salário'], contas: ['Banco do Brasil'] }
        : LANCS;
  return Promise.resolve({ json: () => Promise.resolve(r) });
};

const assert = require('assert');
const els1 = setup(fetchOK);
eval(appJs);

setTimeout(() => {
  assert.strictEqual(els1['saldo-valor'].textContent.replace(/\u00A0/g, ' '), 'R$ 2.000,00', '1º load renderizou');
  assert.strictEqual(els1['sync-status'].hidden, true, 'indicador escondeu após sincronizar');
  assert.ok(memStore['cf_lan_Agosto'], 'cache do mês salvo');
  assert.ok(memStore['cf_meses'], 'cache de meses salvo');

  // ---------- 2º load: servidor "morto" (fetch nunca resolve) ----------
  const els2 = setup(() => new Promise(() => {})); // nunca resolve
  eval(appJs);

  setTimeout(() => {
    assert.strictEqual(
      els2['saldo-valor'].textContent.replace(/\u00A0/g, ' '),
      'R$ 2.000,00', '2º load renderizou DO CACHE sem servidor');
    assert.ok(els2['lista'].innerHTML.includes('Supermercado'), 'lista veio do cache');
    assert.strictEqual(els2['sync-status'].textContent, 'carregando…',
      'indicador ativo aguardando o servidor (comportamento correto)');
    console.log('✔ CACHE QUENTE OK — 2ª abertura renderiza instantaneamente sem servidor');
    process.exit(0);
  }, 300);
}, 300);
