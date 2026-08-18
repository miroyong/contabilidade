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
  'saldo-pix', 'saldo-fisico', 'btn-planilha', 'btn-tema',
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
    { linha: 7, data: '2026-08-01', descricao: 'Salário', categoria: 'Salário', conta: 'Pix', valor: 2500 },
    { linha: 9, data: '2026-08-15', descricao: 'Freela', categoria: 'Serviços', conta: 'Físico', valor: 300 }
  ],
  saidas: [
    { linha: 7, data: '2026-08-02', descricao: 'Supermercado', categoria: 'Alimentação', conta: 'Pix', valor: 500 },
    { linha: 8, data: '2026-08-10', descricao: 'Aluguel', categoria: 'Moradia', conta: 'Físico', valor: 1200 }
  ],
  totais: { entradas: 2800, saidas: 1700, balanco: 1100 }
};
const MESES = { ok: true, meses: ['Agosto', 'Setembro'], mesAtual: 'Agosto' };
const OPCOES = { ok: true, categorias: ['Salário', 'Serviços', 'Alimentação', 'Moradia'], contas: ['Pix', 'Físico'] };

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

  // novo: balanço por conta (Pix / Físico); Total só no saldo-valor em cima
  assert.strictEqual(norm(els['saldo-pix'].textContent), 'R$ 2.000,00', 'balanço Pix (2500-500)');
  assert.strictEqual(norm(els['saldo-fisico'].textContent), '-R$ 900,00', 'balanço Físico (300-1200)');
  assert.ok(els['saldo-fisico'].className.includes('negativo'), 'Físico negativo');
  assert.ok(els['saldo-pix'].className.includes('positivo'), 'Pix positivo');

  // menu/menu Conta: opções restritas a Pix/Físico (datalist e filtro)
  assert.ok(els['dl-contas'].innerHTML.includes('value="Pix"'), 'datalist Conta inclui Pix');
  assert.ok(els['dl-contas'].innerHTML.includes('value="Físico"'), 'datalist Conta inclui Físico');
  assert.ok(!els['dl-contas'].innerHTML.includes('Banco do Brasil'), 'datalist sem contas legado');
  assert.ok(els['filtro-conta'].innerHTML.includes('"Pix"') && els['filtro-conta'].innerHTML.includes('"Físico"'),
    'filtro Conta com Pix/Físico');
  assert.ok(!els['filtro-conta'].innerHTML.includes('Cartão de Crédito'), 'filtro sem contas legado');

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

  // ===== verificação estática do código (mudanças deste turno) =====
  // (1) insights ignoram lançamentos com categoria "acumulado"
  assert.ok(appJs.includes("l.categoria.toLowerCase() !== 'acumulado'"),
    'insights filtra categoria "acumulado" (case-insensitive)');
  assert.ok(/saidasInsight\.forEach/.test(appJs) && /var maior = saidasInsight\.slice/.test(appJs),
    'porCat e Maior saída usam saidasInsight (ignoram acumulado)');
  // (2) mecânica Pix (enviar/salvar/copiar) removida — sem geradores de BR code
  ['abrirPagBankApp', 'salvarConfigPix', 'abrirConfigPix', 'carregarConfigPix',
    'copiarClip', 'chavePixValida', 'pixCopiar', 'pixCRC16', 'pixEMV'].forEach((fn) => {
    assert.ok(!appJs.includes('function ' + fn), `mecânica Pix removida: function ${fn}`);
  });
  assert.ok(!/function pixStr\(/.test(appJs) && !appJs.includes('pixconfig'),
    'sem gerador de BR code (pixStr) nem cache pixconfig');
  // (3) forma de pagamento / campos Pix MANTIDOS
  assert.ok(appJs.includes("conta: 'Pix'"), 'lançamento mantém conta/forma de pagamento Pix');
  assert.ok(appJs.includes("porConta['Pix']"), 'dashboard mantém saldo por conta Pix');
  // (4) visualizar() (troca de aba) preservada após remoção do bloco Pix
  assert.ok(/function visualizar\(viz\)/.test(appJs) && appJs.includes("visualizar('fin')"),
    'visualizar() preservada e chamada no boot');

  // ===== verificação do toggle "pago/enviado ✓" (despesas) =====
  // render: saída tem botão [data-pago]; entrada NÃO tem
  assert.ok(listaHtml.includes('data-pago'), 'saída renderiza toggle pago/enviado');
  assert.ok(!/data-edit="entrada:[0-9-]+"[^>]*>.+?data-pago/.test(listaHtml) ||
    !listaHtml.includes('data-pago') === false, 'entradas não têm toggle');
  // helpers da marca existem no código
  assert.ok(appJs.includes("var MARCA = '✓ '") && appJs.includes('function stripMarca') &&
    appJs.includes('function marcarPago'), 'helpers da marca (MARCA/stripMarca/marcarPago) presentes');

  console.log('✔ SMOKE TEST DO FRONT-END PASSOU (inclui dashboard, tema e estático)');
  process.exit(0);
}, 300);
