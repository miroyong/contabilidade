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
    _cb: {},
    addEventListener(ev, cb) { this._cb[ev] = cb; }, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
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
  'f-descricao', 'f-categoria', 'f-conta', 'f-valor', 'dl-categorias', 'chips-conta',
  'btn-cancelar', 'btn-novo-mes', 'toast', 'form-lancamento', 'btn-salvar'];

global.document = {
  getElementById: byId,
  querySelectorAll: () => [],
  querySelector: (sel) => makeEl(sel),
  documentElement: { dataset: {} },
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
global.prompt = () => 'Setembro';
global.Intl = Intl;

// ---------- mês "corrente" (determinístico em qualquer data de execução) ----
const pad2 = (n) => ('0' + n).slice(-2);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const agora = new Date();
const ano = agora.getFullYear();
const mesNum = agora.getMonth() + 1;
const curName = cap(agora.toLocaleDateString('pt-BR', { month: 'long' }));
const prevName = cap(new Date(ano, agora.getMonth() - 1, 1).toLocaleDateString('pt-BR', { month: 'long' }));
const mm = pad2(mesNum);
const d = (dia) => ano + '-' + mm + '-' + pad2(dia);
const hoje = ano + '-' + mm + '-' + pad2(agora.getDate());

// ---------- fetch mock: responde como o PostgREST do Supabase --------------
const ROWS = [
  { num: 10, tipo: 'entrada', data: d(1), descricao: 'Salário', categoria: 'Salário', conta: 'Pix', valor: 2500 },
  { num: 20, tipo: 'entrada', data: d(15), descricao: 'Freela', categoria: 'Serviços', conta: 'Físico', valor: 300 },
  { num: 30, tipo: 'saida', data: d(2), descricao: 'Dízimo (venda de chaveiros)', categoria: 'Dízimo', conta: 'Pix', valor: 500 },
  { num: 40, tipo: 'saida', data: d(10), descricao: 'Aluguel', categoria: 'Moradia', conta: 'Físico', valor: 1200 }
];
const OP_ROWS = [
  { categoria: 'Salário', conta: 'Pix' }, { categoria: 'Serviços', conta: 'Físico' },
  { categoria: 'Dízimo', conta: 'Pix' }, { categoria: 'Moradia', conta: 'Físico' }
];

// corpos dos POSTs em /lancamentos (usado no teste de roteamento por mês)
const POSTS = [];

function okJson(body, status = 200) {
  return { ok: status >= 200 && status < 300, status,
    text: () => Promise.resolve(body == null ? '' : JSON.stringify(body)) };
}

global.fetch = (url, opts) => {
  const u = new URL(url);
  const table = (u.pathname.match(/\/rest\/v1\/(\w+)/) || [])[1] || '';
  const q = u.searchParams;
  const method = (opts && opts.method) || 'GET';
  if (table === 'meses') {
    if (q.has('id')) { // verificação de existência do mês
      const id = q.get('id').replace(/^eq\./, '');
      return Promise.resolve(okJson(id === curName || id === prevName ? [{ id }] : []));
    }
    return Promise.resolve(okJson([{ id: curName }, { id: prevName }]));
  }
  if (table === 'lancamentos') {
    if (q.get('select') === 'categoria,conta') return Promise.resolve(okJson(OP_ROWS));
    const mes = (q.get('mes_id') || '').replace(/^eq\./, '');
    if (method === 'POST') {
      POSTS.push(JSON.parse((opts && opts.body) || '{}'));
      return Promise.resolve(okJson([{ ...ROWS[0], num: 99 }], 201));
    }
    if (method === 'PATCH' || method === 'DELETE') return Promise.resolve(okJson(null, 204));
    return Promise.resolve(okJson(mes === curName ? ROWS : []));
  }
  return Promise.resolve(okJson([]));
};

// ---------- carrega e executa o app ----------
global.window.APP_CONFIG = global.window.APP_CONFIG;
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// pré-carga: "levou" já salvo em localStorage (estoque do mosquetão do dia anterior)
memStore['cf_chaLevou'] = JSON.stringify({ '3d': 30, '2d': 20, 'ab': 5 });
eval(appJs);

// ---------- verifica o resultado ----------
const assert = require('assert');
const norm = (s) => String(s).replace(/\u00A0/g, ' '); // NBSP → espaço normal

setTimeout(() => {
  assert.strictEqual(els['saldo-mes'].textContent, curName, 'mês selecionado');
  assert.strictEqual(norm(els['saldo-valor'].textContent), 'R$ 1.100,00', 'balanço formatado');
  assert.ok(els['saldo-valor'].className.includes('positivo'), 'classe positivo');
  assert.strictEqual(norm(els['saldo-entradas'].textContent), 'R$ 2.800,00', 'total entradas');
  assert.strictEqual(norm(els['saldo-saidas'].textContent), 'R$ 1.700,00', 'total saídas');

  // novo: balanço por conta (Pix / Físico); Total só no saldo-valor em cima
  assert.strictEqual(norm(els['saldo-pix'].textContent), 'R$ 2.000,00', 'balanço Pix (2500-500)');
  assert.strictEqual(norm(els['saldo-fisico'].textContent), '-R$ 900,00', 'balanço Físico (300-1200)');
  assert.ok(els['saldo-fisico'].className.includes('negativo'), 'Físico negativo');
  assert.ok(els['saldo-pix'].className.includes('positivo'), 'Pix positivo');

  // Conta: somente os botões Pix / Cartão e Dinheiro; filtro preserva legado
  assert.ok(appJs.includes("montar(boxConta, ['Pix / Cartão', 'Dinheiro'])"),
    'botões de Conta limitados a Pix / Cartão e Dinheiro');
  assert.ok(els['filtro-conta'].innerHTML.includes('"Pix"') && els['filtro-conta'].innerHTML.includes('"Físico"'),
    'filtro Conta com Pix/Físico');
  assert.ok(!els['filtro-conta'].innerHTML.includes('Cartão de Crédito'), 'filtro sem contas legado');

  const mesesHtml = els['meses-list'].innerHTML;
  assert.ok(mesesHtml.includes(curName) && mesesHtml.includes(prevName), 'chips de mês');
  assert.ok(mesesHtml.includes('chip ativo'), 'chip ativo marcado');

  const graficoHtml = norm(els['grafico'].innerHTML);
  assert.ok(graficoHtml.includes('Moradia') && graficoHtml.includes('R$ 1.200,00'), 'gráfico por categoria');

  const listaHtml = norm(els['lista'].innerHTML);
  assert.ok(listaHtml.includes('Dízimo (venda de chaveiros)') && listaHtml.includes('Aluguel') && listaHtml.includes('Salário'), 'lista de lançamentos');
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

  // ===== verificação do toggle "pago/enviado ✓" (só despesas Dízimo/Custos) =====
  const linhaDizimo = listaHtml.slice(listaHtml.indexOf('Dízimo (venda de chaveiros)'), listaHtml.indexOf('Dízimo (venda de chaveiros)') + 300);
  const linhaAluguel = listaHtml.slice(listaHtml.indexOf('Aluguel'), listaHtml.indexOf('Aluguel') + 300);
  assert.ok(linhaDizimo.includes('data-pago'), 'despesa Dízimo tem toggle pago/enviado');
  assert.ok(!linhaAluguel.includes('data-pago'), 'gasto comum (Moradia) NÃO tem toggle');
  // entrada não tem toggle
  assert.ok(listaHtml.split('data-pago').length <= 2, 'apenas a saída Dízimo/Custos tem [data-pago]');
  // helpers da marca existem no código
  assert.ok(appJs.includes("var MARCA = '✓ '") && appJs.includes('function stripMarca') &&
    appJs.includes('function marcarPago') && appJs.includes('function temTogglePago'),
    'helpers da marca (MARCA/stripMarca/marcarPago/temTogglePago) presentes');

  // ===== "quanto levei": persistência local dos campos de Levou =====
  // boot restaurou os campos a partir do localStorage pré-carregado (30/20/5)
  assert.strictEqual(Number(els['cha-levou-3d'].value), 30, 'Cha 3D: Levou restaurado (30)');
  assert.strictEqual(Number(els['cha-levou-2d'].value), 20, 'Cha 2D: Levou restaurado (20)');
  assert.strictEqual(Number(els['cha-levou-ab'].value), 5, 'Abridor: Levou restaurado (5)');
  // funções de persistência presentes no código
  assert.ok(appJs.includes("CHA_LEVOU_KEY = 'chaLevou'") && appJs.includes('function chaSalvarLevou') &&
    appJs.includes('function chaRestaurarLevou'), 'persistência do Levou (chaSalvarLevou/chaRestaurarLevou)');

  // ===== "arrecadação": Alimentação e Transporte re-incluídos (revert f8947a8) =====
  // (a) campos/estado + lançamentos de saída presentes no código
  assert.ok(appJs.includes("var alimentacao = chaVal('cha-alimentacao')") &&
    appJs.includes("var transporte = chaVal('cha-transporte')"), 'lê campos alimentação/transporte');
  assert.ok(appJs.includes("alimentacao: alimentacao, transporte: transporte"), 'state.chaveiros guarda alim/transp');
  assert.ok(appJs.includes("categoria: 'Alimentação'") && appJs.includes("categoria: 'Transporte'") &&
    appJs.includes("'Alimentação (venda de chaveiros)'") && appJs.includes("'Transporte (venda de chaveiros)'"),
    'lança saídas Alimentação/Transporte no chaLancar');
  assert.ok(appJs.includes("'cha-pix','cha-fisico','cha-alimentacao','cha-transporte'"),
    'limpeza pós-lançamento inclui alim/transp');
  // (a2) custo e dízimo já vêm pré-configurados como Pix (não Físico)
  assert.ok(appJs.includes("categoria: 'Custos', conta: 'Pix'") &&
    appJs.includes("categoria: 'Dízimo', conta: 'Pix'"),
    'Custo e Dízimo lançam em conta Pix');
  assert.ok(appJs.includes("categoria: 'Alimentação', conta: 'Físico'") &&
    appJs.includes("categoria: 'Transporte', conta: 'Físico'"),
    'Alimentação e Transporte permanecem em Físico');
  // (b) funcional: lucro líquido desconta dízimo + alimentação + transporte
  byId('cha-nome').value = 'Joana';
  byId('cha-levou-3d').value = 30; byId('cha-levou-2d').value = 0; byId('cha-levou-ab').value = 0;
  byId('cha-voltou-3d').value = 4; byId('cha-voltou-2d').value = 0; byId('cha-voltou-ab').value = 0;
  byId('cha-pix').value = '320,00'; byId('cha-fisico').value = '200,00';
  byId('cha-alimentacao').value = '50,00'; byId('cha-transporte').value = '20,00';
  byId('cha-calcular')._cb['click']();
  const resumoCha = norm(byId('cha-resumo').innerHTML);
  // 26 vendidos * custo 5 = 130; receita 520; lucro bruto = 390; dízimo = 10% de 390 = 39;
  // líquido = 390 - 39 - 50 - 20 = 281
  assert.ok(/Alimentação/.test(resumoCha), 'resumo chaveiros mostra Alimentação');
  assert.ok(/Transporte/.test(resumoCha), 'resumo chaveiros mostra Transporte');
  const lucroB = (resumoCha.match(/LUCRO BRUTO[^0-9]*([\d.,]+)/) || [])[1];
  const lique = (resumoCha.match(/LÍQUIDO[^0-9]*([\d.,]+)/) || [])[1];
  assert.strictEqual(lucroB, '390,00', 'lucro bruto 390 (520-130)');
  assert.strictEqual(lique, '281,00', 'líquido 281 (390-dízimo39-alim50-transp20)');

  // ===== regressão: a arrecadação vai para o mês da data, não para a aba aberta =====
  // troca a aba aberta para um mês diferente do mês de hoje (mês anterior)
  global.prompt = () => prevName;
  byId('btn-novo-mes')._cb['click']();
  setTimeout(() => {
    assert.strictEqual(els['saldo-mes'].textContent, prevName,
      'aba trocada para ' + prevName + ' (diferente do mês de hoje)');

    byId('cha-pix').value = '50,00';
    byId('cha-calcular')._cb['click']();
    POSTS.length = 0;
    byId('cha-lancar')._cb['click']();
    setTimeout(() => {
      assert.ok(POSTS.length >= 2, 'arrecadação enviou os lançamentos (' + POSTS.length + ')');
      const mesDoIso = (iso) => ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
        'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][Number(String(iso).slice(5, 7)) - 1];
      POSTS.forEach((b) => {
        assert.strictEqual(b.data, hoje, 'arrecadação usa a data de hoje');
        assert.strictEqual(b.mes_id, mesDoIso(b.data),
          'arrecadação grava no mês da data (' + b.mes_id + ' para ' + b.data + ')');
        assert.notStrictEqual(b.mes_id, prevName, 'arrecadação NÃO usa o mês da aba aberta');
      });
      assert.strictEqual(els['saldo-mes'].textContent, curName,
        'app muda para o mês da data depois de lançar');

      console.log('✔ SMOKE TEST DO FRONT-END PASSOU (inclui dashboard, tema, estático e mês da arrecadação)');
      process.exit(0);
    }, 250);
  }, 250);
}, 300);
