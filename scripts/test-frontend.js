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
};
global.window = { APP_CONFIG: { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'chave-anon' } };
global.requestAnimationFrame = (fn) => fn();
global.confirm = () => true;
global.prompt = () => 'Setembro';
global.Intl = Intl;

// ---------- mês "corrente" (determinístico em qualquer data de execução) ----
const pad2 = (n) => ('0' + n).slice(-2);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const agora = new Date();
const ano = agora.getFullYear();
const mesNum = agora.getMonth() + 1;
const curId = ano + '-' + pad2(mesNum);
// segundo mês sempre no MESMO ano (evita sufixo "/ano" nos chips)
const outroMesNum = mesNum === 1 ? 2 : (mesNum === 12 ? 11 : mesNum + 1);
const outroId = ano + '-' + pad2(outroMesNum);
const curLabel = cap(agora.toLocaleDateString('pt-BR', { month: 'long' }));
const outroLabel = cap(new Date(ano, outroMesNum - 1, 1).toLocaleDateString('pt-BR', { month: 'long' }));

// ---------- fetch mock: responde como o PostgREST do Supabase --------------
const LANC = [
  { id: 'aaaa1111', tipo: 'entrada', data: curId + '-01', descricao: 'Salário', categoria: 'Salário', conta: 'Banco do Brasil', valor: 2500 },
  { id: 'bbbb2222', tipo: 'entrada', data: curId + '-15', descricao: 'Freela', categoria: 'Serviços', conta: 'Nubank', valor: 300 },
  { id: 'cccc3333', tipo: 'saida', data: curId + '-02', descricao: 'Supermercado', categoria: 'Alimentação', conta: 'Cartão de Crédito', valor: 500 },
  { id: 'dddd4444', tipo: 'saida', data: curId + '-10', descricao: 'Aluguel', categoria: 'Moradia', conta: 'Banco do Brasil', valor: 1200 }
];
const OP_ROWS = [
  { categoria: 'Salário', conta: 'Banco do Brasil' },
  { categoria: 'Serviços', conta: 'Nubank' },
  { categoria: 'Alimentação', conta: 'Cartão de Crédito' },
  { categoria: 'Moradia', conta: 'Banco do Brasil' }
];

function okJson(body) {
  return { ok: true, status: 200, text: () => Promise.resolve(body === null ? '' : JSON.stringify(body)) };
}

global.fetch = (url) => {
  const u = new URL(url);
  const table = (u.pathname.match(/\/rest\/v1\/(\w+)/) || [])[1] || '';
  const q = u.searchParams;
  if (table === 'meses') {
    if (q.has('id')) { // verificação de existência do mês
      const id = q.get('id').replace(/^eq\./, '');
      return Promise.resolve(okJson(id === curId ? [{ id: curId }] : []));
    }
    return Promise.resolve(okJson([{ id: curId }, { id: outroId }])); // order=id.desc
  }
  if (table === 'lancamentos') {
    if (q.get('select') === 'categoria,conta') return Promise.resolve(okJson(OP_ROWS));
    const mes = (q.get('mes_id') || '').replace(/^eq\./, '');
    return Promise.resolve(okJson(mes === curId ? LANC : []));
  }
  return Promise.resolve(okJson([]));
};

// ---------- carrega e executa o app ----------
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
eval(appJs);

// ---------- verifica o resultado ----------
const assert = require('assert');
const norm = (s) => String(s).replace(/\u00A0/g, ' '); // NBSP → espaço normal

setTimeout(() => {
  assert.strictEqual(els['saldo-mes'].textContent, curLabel, 'mês selecionado');
  assert.strictEqual(norm(els['saldo-valor'].textContent), 'R$ 1.100,00', 'balanço formatado');
  assert.ok(els['saldo-valor'].className.includes('positivo'), 'classe positivo');
  assert.strictEqual(norm(els['saldo-entradas'].textContent), 'R$ 2.800,00', 'total entradas');
  assert.strictEqual(norm(els['saldo-saidas'].textContent), 'R$ 1.700,00', 'total saídas');

  const mesesHtml = els['meses-list'].innerHTML;
  assert.ok(mesesHtml.includes(curLabel) && mesesHtml.includes(outroLabel), 'chips de mês');
  assert.ok(mesesHtml.includes('chip ativo'), 'chip ativo marcado');

  const graficoHtml = norm(els['grafico'].innerHTML);
  assert.ok(graficoHtml.includes('Moradia') && graficoHtml.includes('R$ 1.200,00'), 'gráfico por categoria');

  const listaHtml = norm(els['lista'].innerHTML);
  assert.ok(listaHtml.includes('Supermercado') && listaHtml.includes('Salário'), 'lista de lançamentos');
  assert.ok(listaHtml.includes('data-edit') && listaHtml.includes('data-del'), 'ações editar/excluir');
  assert.strictEqual(els['contador'].textContent, '4', 'contador de lançamentos');

  console.log('✔ SMOKE TEST DO FRONT-END PASSOU (carregou e renderizou saldo/meses/gráfico/lista via Supabase)');
  process.exit(0);
}, 300);
