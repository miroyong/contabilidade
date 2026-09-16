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
    'meses-list','aviso-mes','btn-novo-fab','filtro-tipo','filtro-categoria','filtro-conta',
    'filtro-busca','grafico','contador','lista','modal','modal-titulo','f-data',
    'f-descricao','f-categoria','f-conta','f-valor','dl-categorias','chips-conta',
    'btn-cancelar','btn-novo-mes','toast','form-lancamento','btn-salvar','sync-status',
    'insights','barra-dist','barra-entrada','barra-saida','barra-legenda','comparativo'];
  global.document = {
    getElementById: byId, querySelectorAll: () => [], querySelector: (sel) => makeEl(sel),
    documentElement: { dataset: {} }
  };
  global.window = { APP_CONFIG: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'chave' } };
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

const ROWS = [
  { num: 7, tipo: 'entrada', data: '2026-08-01', descricao: 'Salário', categoria: 'Salário', conta: 'Banco do Brasil', valor: 2500 },
  { num: 8, tipo: 'saida', data: '2026-08-02', descricao: 'Supermercado', categoria: 'Alimentação', conta: 'Cartão', valor: 500 }
];

// ---------- 1º load: servidor responde (cache fica quente) ----------
let fetchCount = 0;
const fetchOK = (url, opts) => {
  fetchCount++;
  const u = new URL(url);
  const table = (u.pathname.match(/\/rest\/v1\/(\w+)/) || [])[1] || '';
  const q = u.searchParams;
  const res = (payload, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300, status,
    text: () => Promise.resolve(payload == null ? '' : JSON.stringify(payload))
  });
  if (table === 'meses') return Promise.resolve(res(q.has('id') ? [{ id: 'Agosto' }] : [{ id: 'Agosto' }]));
  if (table === 'lancamentos') {
    if (q.get('select') === 'categoria,conta') return Promise.resolve(res([{ categoria: 'Salário', conta: 'Banco do Brasil' }]));
    return Promise.resolve(res(((q.get('mes_id') || '').replace(/^eq\./, '') === 'Agosto') ? ROWS : []));
  }
  return Promise.resolve(res([]));
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
