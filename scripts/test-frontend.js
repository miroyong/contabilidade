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
const ids = ['aviso-config', 'saldo-mes', 'saldo-escopo', 'saldo-valor', 'saldo-entradas', 'saldo-saidas',
  'saldo-pix', 'saldo-fisico', 'btn-planilha', 'btn-tema',
  'meses-list', 'aviso-mes', 'btn-novo-fab', 'filtro-tipo', 'filtro-categoria', 'filtro-conta',
  'filtro-busca', 'grafico', 'contador', 'lista', 'modal', 'modal-titulo', 'f-data',
  'f-descricao', 'f-categoria', 'f-conta', 'f-valor', 'dl-categorias', 'chips-conta',
  'btn-cancelar', 'btn-novo-mes', 'toast', 'form-lancamento', 'btn-salvar',
  'barra-dist', 'barra-entrada', 'barra-saida', 'barra-legenda', 'insights', 'comparativo'];

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
  { num: 10, tipo: 'entrada', data: d(1), descricao: 'Salário', categoria: 'Salário', conta: 'Pix / Cartão', valor: 2500 },
  { num: 20, tipo: 'entrada', data: d(15), descricao: 'Freela', categoria: 'Serviços', conta: 'Físico', valor: 300 },
  { num: 30, tipo: 'saida', data: d(2), descricao: 'Dízimo (venda de chaveiros)', categoria: 'Dízimo', conta: 'Pix', valor: 500 },
  { num: 40, tipo: 'saida', data: d(10), descricao: 'Aluguel', categoria: 'Moradia', conta: 'Físico', valor: 1200 }
];
// mês anterior: usado no comparativo e no caixa acumulado (400 de sobra em caixa)
const PREV_ROWS = [
  { num: 1, tipo: 'entrada', data: '2026-01-05', descricao: 'Salário anterior', categoria: 'Salário', conta: 'Pix / Cartão', valor: 1000 },
  { num: 2, tipo: 'entrada', data: '2026-01-06', descricao: 'Venda anterior', categoria: 'Serviços', conta: 'Dinheiro', valor: 200 },
  { num: 3, tipo: 'saida', data: '2026-01-07', descricao: 'Mercado anterior', categoria: 'Alimentação', conta: 'Físico', valor: 700 },
  { num: 4, tipo: 'saida', data: '2026-01-08', descricao: 'Dízimo anterior', categoria: 'Dízimo', conta: 'Pix', valor: 100 }
];
// o que o servidor devolve para o mês vigente (cresce quando incluirPosts = true)
const CUR_ROWS = ROWS.slice();
let incluirPosts = false;
const OP_ROWS = [
  { categoria: 'Salário', conta: 'Pix / Cartão' }, { categoria: 'Serviços', conta: 'Físico' },
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
    // ordem de criação (criado_em.asc), como o servidor devolve
    return Promise.resolve(okJson([{ id: prevName }, { id: curName }]));
  }
  if (table === 'lancamentos') {
    if (q.get('select') === 'categoria,conta') return Promise.resolve(okJson(OP_ROWS));
    const mes = (q.get('mes_id') || '').replace(/^eq\./, '');
    if (method === 'POST') {
      const body = JSON.parse((opts && opts.body) || '{}');
      POSTS.push(body);
      if (incluirPosts) CUR_ROWS.push({ num: 500 + POSTS.length, ...body });
      return Promise.resolve(okJson([{ ...ROWS[0], num: 99 }], 201));
    }
    if (method === 'PATCH' || method === 'DELETE') return Promise.resolve(okJson(null, 204));
    if (mes === curName) return Promise.resolve(okJson(CUR_ROWS));
    if (mes === prevName) return Promise.resolve(okJson(PREV_ROWS));
    return Promise.resolve(okJson([]));
  }
  return Promise.resolve(okJson([]));
};

// ---------- carrega e executa o app ----------
global.window.APP_CONFIG = global.window.APP_CONFIG;
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
// pré-carga: "levou" já salvo em localStorage (estoque do mosquetão do dia anterior)
memStore['cf_chaLevou'] = JSON.stringify({ '3d': 30, '2d': 20, 'ab': 5 });
eval(appJs);

// ---------- verifica o resultado ----------
const assert = require('assert');
const norm = (s) => String(s).replace(/\u00A0/g, ' '); // NBSP → espaço normal

setTimeout(() => {
  assert.strictEqual(els['saldo-mes'].textContent, curName, 'mês selecionado');
  // hero = CAIXA ACUMULADO (mês anterior + vigente), não só o mês aberto
  assert.strictEqual(els['saldo-escopo'].textContent, 'Caixa acumulado até ', 'rótulo do hero avisa que é acumulado');
  assert.strictEqual(norm(els['saldo-valor'].textContent), 'R$ 1.500,00', 'caixa acumulado (400 do mês anterior + 1100)');
  assert.ok(els['saldo-valor'].className.includes('positivo'), 'classe positivo');
  assert.strictEqual(norm(els['saldo-entradas'].textContent), 'R$ 4.000,00', 'entradas acumuladas (2800+1200)');
  assert.strictEqual(norm(els['saldo-saidas'].textContent), 'R$ 2.500,00', 'saídas acumuladas (1700+800)');

  // balanço por conta também acumulado (Pix / Dinheiro); Total só no saldo-valor em cima
  assert.strictEqual(norm(els['saldo-pix'].textContent), 'R$ 2.900,00', 'Pix acumulado (2000+900)');
  assert.strictEqual(norm(els['saldo-fisico'].textContent), '-R$ 1.400,00', 'Dinheiro acumulado (-900-500)');
  assert.ok(els['saldo-fisico'].className.includes('negativo'), 'caixa negativo');
  assert.ok(els['saldo-pix'].className.includes('positivo'), 'Pix positivo');
  // invariantes do hero: Total = Entradas - Saídas = Pix + Dinheiro
  assert.strictEqual(1500, 4000 - 2500, 'invariante entradas - saídas');
  assert.strictEqual(1500, 2900 - 1400, 'invariante Pix + Dinheiro');

  // Conta: somente os botões Pix / Cartão e Dinheiro; filtro preserva legado
  assert.ok(appJs.includes("montar(boxConta, ['Pix / Cartão', 'Dinheiro'])"),
    'botões de Conta limitados a Pix / Cartão e Dinheiro');
  assert.ok(els['filtro-conta'].innerHTML.includes('"Pix"') && els['filtro-conta'].innerHTML.includes('"Dinheiro"'),
    'filtro Conta com os nomes canônicos Pix/Dinheiro');
  assert.ok(!els['filtro-conta'].innerHTML.includes('"Físico"'),
    'conta legada "Físico" não vira opção separada (cai no balde Dinheiro)');
  assert.ok(!els['filtro-conta'].innerHTML.includes('Cartão de Crédito'), 'filtro sem contas legado');

  // filtro por balde: "Dinheiro" alcança o legado "Físico"; "Pix" alcança "Pix / Cartão"
  els['filtro-tipo'].value = 'todos';
  const filtrarConta = (v) => { els['filtro-conta'].value = v; els['filtro-conta']._cb['change'](); };
  filtrarConta('Dinheiro');
  assert.strictEqual(els['contador'].textContent, '2', 'filtro Dinheiro pega os lançamentos de caixa (legado Físico)');
  assert.ok(!norm(els['lista'].innerHTML).includes('Salário'), 'filtro Dinheiro esconde os lançamentos Pix');
  filtrarConta('Pix');
  assert.ok(norm(els['lista'].innerHTML).includes('Salário') &&
    norm(els['lista'].innerHTML).includes('Dízimo'), 'filtro Pix pega "Pix / Cartão" + Pix');
  filtrarConta(''); // limpa para os demais asserts
  assert.strictEqual(els['contador'].textContent, '4', 'sem filtro de conta a lista volta ao total');

  const mesesHtml = els['meses-list'].innerHTML;
  assert.ok(mesesHtml.includes(curName) && mesesHtml.includes(prevName), 'chips de mês');
  assert.ok(mesesHtml.includes('chip ativo'), 'chip ativo marcado');

  const graficoHtml = norm(els['grafico'].innerHTML);
  assert.ok(graficoHtml.includes('Moradia') && graficoHtml.includes('R$ 1.200,00'), 'gráfico por categoria');

  const listaHtml = norm(els['lista'].innerHTML);
  assert.ok(listaHtml.includes('Dízimo (venda de chaveiros)') && listaHtml.includes('Aluguel') && listaHtml.includes('Salário'), 'lista de lançamentos');
  assert.ok(listaHtml.includes('data-mais'), 'cada lançamento tem botão de ações (⋯)');
  assert.ok(indexHtml.includes('id="modal-acoes"') && indexHtml.includes('data-acao="editar"') &&
    indexHtml.includes('data-acao="excluir"'), 'folha de ações tem editar/excluir');
  assert.strictEqual(els['contador'].textContent, '4', 'contador de lançamentos');

  // dashboard: barra de proporção + KPIs DO MÊS (o acumulado fica só no hero)
  // entradas 2500+300 = 2800 · saídas 500+1200 = 1700 → 62% / 38%
  assert.strictEqual(els['barra-entrada'].style.width, '62%', 'barra marca a fatia de entradas');
  assert.strictEqual(els['barra-saida'].style.width, '38%', 'barra marca a fatia de saídas');
  const legendaHtml = norm(els['barra-legenda'].innerHTML);
  assert.ok(legendaHtml.includes('62%') && legendaHtml.includes('38%'),
    'legenda repete as porcentagens em texto');
  const resumoHtml = norm(els['insights'].innerHTML);
  assert.ok(resumoHtml.includes('kpi-rot') && resumoHtml.includes('Categoria top'),
    'KPIs do resumo renderizados');
  assert.ok(resumoHtml.includes('Comprometimento') && resumoHtml.includes('Média diária'),
    'KPIs trazem comprometimento e média diária');
  assert.ok(/Maior saída<\/span><span class="kpi-val">Aluguel<\/span>[\s\S]*R\$ 1\.200,00/.test(resumoHtml),
    'maior saída usa o lançamento de maior valor');
  assert.ok(resumoHtml.includes('Moradia') && resumoHtml.includes('71%'),
    'categoria top do mês com sua participação nas saídas');
  assert.strictEqual(els['insights'].hidden, false, 'grid de KPIs visível com dados');

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
  // (5) caixa acumulado: o hero soma todos os meses até o vigente
  assert.ok(appJs.includes("case 'acumulado':") && appJs.includes('function sbAcumulado(meses)'),
    'ação "acumulado" existe no adaptador e no cliente');
  assert.ok(appJs.includes('state.meses.slice(0, idx + 1)'),
    'acumula do primeiro mês até o vigente (state.meses vem em ordem de criação)');
  assert.ok(appJs.includes("select=tipo,conta,valor&mes_id=eq."),
    'soma o caixa com uma consulta por mês (evita o teto de linhas do PostgREST)');
  assert.ok(appJs.includes('acumulado: state.acumulado') && appJs.includes('state.acumulado = c.acumulado || null'),
    'cache local guarda e relê o acumulado (renderiza offline na hora)');
  assert.ok(appJs.includes("'Caixa acumulado até '") && appJs.includes("'Balanço · '"),
    'rótulo do hero alterna entre acumulado e balanço do mês');
  assert.ok(indexHtml.includes('id="saldo-escopo"'), 'hero tem o rótulo de escopo (#saldo-escopo)');
  assert.ok(!appJs.includes('state.meses.sort()'),
    'meses mantêm a ordem de criação (sort alfabético trocaria a ordem do acumulado)');
  // (4) visualizar() (troca de aba) preservada após remoção do bloco Pix
  assert.ok(/function visualizar\(viz\)/.test(appJs) && appJs.includes("visualizar('fin')"),
    'visualizar() preservada e chamada no boot');

  // ===== contas: um balde para Pix e outro para o caixa (Dinheiro/Físico) =====
  assert.ok(appJs.includes("var CONTAS = ['Pix', 'Dinheiro'];"),
    'CONTAS usa os nomes canônicos atuais (Pix / Dinheiro)');
  assert.ok(appJs.includes("if (s.indexOf('dinheiro') >= 0) return 'Físico';"),
    'contaChave reconhece "Dinheiro" e joga no balde de caixa (Físico)');
  assert.ok(/var k = contaChave\(l\.conta\);\s*var fk = contaChave\(f\.conta\);\s*if \(fk \? k !== fk : l\.conta !== f\.conta\) return false;/.test(appJs),
    'filtro de conta compara pelo balde (contaChave) nos dois lados');
  assert.ok(appJs.includes('var k = contaChave(c) || c;'),
    'contasOpcoes converte conta conhecida no balde canônico (sem duplicar)');
  assert.ok(/<span class="saldo-item-nome">Dinheiro<\/span>\s*<span class="saldo-item-valor" id="saldo-fisico">/.test(indexHtml),
    'hero: célula do caixa se chama Dinheiro (id saldo-fisico preservado)');

  // ===== dashboard enxuto: barra de proporção + KPIs (sem rosca nem caixas) =====
  assert.ok(!appJs.includes('pizza-grafico') && !appJs.includes('pizza-centro') &&
    !appJs.includes('conic-gradient'), 'rosca do dashboard removida do JS');
  assert.ok(!indexHtml.includes('pizza') && indexHtml.includes('id="barra-dist"') &&
    indexHtml.includes('aria-hidden="true"'), 'HTML do dashboard tem só barra decorativa + KPIs');
  assert.ok(appJs.includes('function renderBarra') && appJs.includes('function renderKpis') &&
    appJs.includes('renderBarra(totE, totS)'), 'render do resumo (barra + KPIs) presente');
  assert.ok(appJs.includes('Sem movimentos neste mês.'), 'estado vazio da barra tem texto próprio');
  assert.ok(appJs.includes('box.hidden = !html.length'), 'grid de KPIs se esconde sem dados');
  assert.ok(!appJs.includes('Balanço negativo'), 'aviso de balanço negativo não duplica o hero');

  // ===== UI sem emojis: só ícones SVG de traço fino =====
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  const semCheck = (s) => s.replace(/✓/g, ''); // ✓ é a marca de pago/enviado (dado + legenda), não emoji
  assert.ok(!EMOJI.test(semCheck(indexHtml)), 'index.html sem emojis');
  assert.ok(!EMOJI.test(semCheck(appJs)), 'app.js sem emojis');
  assert.ok(!EMOJI.test(semCheck(styleCss)), 'style.css sem emojis');
  assert.ok(appJs.includes('var ICO = {') && appJs.includes('btn.innerHTML = t === \'escuro\' ? ICO.sol : ICO.lua'),
    'ícones de tema são SVG (ICO.sol / ICO.lua)');
  assert.ok(styleCss.includes('.icone {') && styleCss.includes('stroke: currentColor'),
    'classe .icone define os SVGs de traço fino');

  // ===== verificação do toggle "pago/enviado ✓" (só despesas Dízimo/Custos) =====
  const linhaDizimo = listaHtml.slice(listaHtml.indexOf('Dízimo (venda de chaveiros)'), listaHtml.indexOf('Dízimo (venda de chaveiros)') + 300);
  const linhaAluguel = listaHtml.slice(listaHtml.indexOf('Aluguel'), listaHtml.indexOf('Aluguel') + 300);
  assert.ok(linhaDizimo.includes('data-mais'), 'despesa Dízimo tem botão de ações (⋯)');
  assert.ok(!listaHtml.includes('data-pago') && !listaHtml.includes('data-edit'),
    'a linha do extrato não tem mais 1-3 botões soltos (ações na folha)');
  assert.ok(appJs.includes('temTogglePago(item)') && indexHtml.includes('id="acao-pago"'),
    'toggle pago/enviado vive na folha de ações');
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
  // (b) funcional: a receita do dia inclui a alimentação (Pix + Físico + Alimentação)
  //     e o lucro líquido desconta dízimo + alimentação + transporte
  byId('cha-nome').value = 'Joana';
  byId('cha-levou-3d').value = 30; byId('cha-levou-2d').value = 0; byId('cha-levou-ab').value = 0;
  byId('cha-voltou-3d').value = 4; byId('cha-voltou-2d').value = 0; byId('cha-voltou-ab').value = 0;
  byId('cha-pix').value = '320,00'; byId('cha-fisico').value = '200,00';
  byId('cha-alimentacao').value = '50,00'; byId('cha-transporte').value = '20,00';
  byId('cha-calcular')._cb['click']();
  const resumoCha = norm(byId('cha-resumo').innerHTML);
  // 26 vendidos * custo 5 = 130; total do dia = 320 + 200 + 50 (alimentação) = 570;
  // lucro bruto = 570 - 130 = 440; dízimo = 10% de 440 = 44;
  // líquido = 440 - 44 - 50 - 20 = 326
  assert.ok(/ALIMENTAÇÃO/.test(resumoCha), 'resumo chaveiros mostra Alimentação');
  assert.ok(/TRANSPORTE/.test(resumoCha), 'resumo chaveiros mostra Transporte');
  const totDia = (resumoCha.match(/TOTAL DO DIA[\s\S]*?linha-val[^0-9]*([\d.,]+)/) || [])[1];
  assert.strictEqual(totDia, '570,00', 'total do dia 570 (320 + 200 + alimentação 50)');
  assert.ok(/TOTAL DO DIA[\s\S]*?Alimentação R\$ 50,00/.test(resumoCha),
    'detalhe do Total do Dia inclui a Alimentação');
  assert.ok(appJs.includes('function chaReceitaDia') && appJs.includes('chaDetTotalDia'),
    'total do dia centralizado em chaReceitaDia/chaDetTotalDia');
  const lucroB = (resumoCha.match(/LUCRO BRUTO[^0-9]*([\d.,]+)/) || [])[1];
  const lique = (resumoCha.match(/LÍQUIDO[^0-9]*([\d.,]+)/) || [])[1];
  assert.strictEqual(lucroB, '440,00', 'lucro bruto 440 (570-130)');
  assert.strictEqual(lique, '326,00', 'líquido 326 (440-dízimo44-alim50-transp20)');

  // ===== regressão: a arrecadação vai para o mês da data, não para a aba aberta =====
  // troca a aba aberta para um mês diferente do mês de hoje (mês anterior)
  global.prompt = () => prevName;
  byId('btn-novo-mes')._cb['click']();
  setTimeout(() => {
    assert.strictEqual(els['saldo-mes'].textContent, prevName,
      'aba trocada para ' + prevName + ' (diferente do mês de hoje)');
    // primeiro mês da lista: acumulado = só ele mesmo (400 de sobra)
    assert.strictEqual(norm(els['saldo-valor'].textContent), 'R$ 400,00',
      'acumulado até o 1º mês não inclui meses posteriores');

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
      assert.strictEqual(norm(els['saldo-valor'].textContent), 'R$ 1.500,00',
        'hero volta ao acumulado do mês vigente');

      // ===== extrato paginado + botão flutuante (evita rolar centenas de itens) =====
      assert.ok(appJs.includes('var visiveis = todos.slice(0, state.limiteLista)'),
        'extrato renderiza só state.limiteLista lançamentos');
      assert.ok(appJs.includes('data-ver-mais') && appJs.includes('data-ver-menos'),
        'extrato tem "mostrar todos" / "mostrar menos" quando a lista é maior');
      assert.ok(/state\.limiteLista = LISTA_INICIAL/.test(appJs),
        'trocar filtro/busca volta a lista ao começo');
      assert.ok(appJs.includes('novoLancamento') && appJs.includes("$('btn-novo-fab')"),
        'botão flutuante é o único CTA de novo lançamento');
      assert.ok(appJs.includes("$('btn-novo-fab').hidden = (viz === 'cha')"),
        'botão flutuante some na aba Arrecadação');
      assert.ok(!indexHtml.includes('id="btn-novo"') && !/['"]btn-novo['"]/.test(appJs),
        'barra fixa "#btn-novo" removida do HTML e do JS (só resta o botão circular)');

      // ===== ao gravar no mês aberto, o caixa acumulado se atualiza sozinho =====
      incluirPosts = true;
      byId('f-data').value = d(3);
      byId('f-descricao').value = 'Compra teste';
      byId('f-categoria').value = 'Moradia';
      byId('f-conta').value = 'Dinheiro';
      byId('f-valor').value = '100';
      byId('form-lancamento')._cb['submit']({ preventDefault() {} });
      setTimeout(() => {
        const b = POSTS[POSTS.length - 1];
        assert.ok(b && b.descricao === 'Compra teste', 'lançamento de teste enviado (' + JSON.stringify(b) + ')');
        const esperado = b.tipo === 'saida' ? 'R$ 1.400,00' : 'R$ 1.600,00';
        assert.strictEqual(norm(els['saldo-valor'].textContent), esperado,
          'hero recarrega o caixa acumulado depois de gravar no mês aberto (era R$ 1.500,00)');
        assert.ok(JSON.parse(memStore['cf_lan_' + curName]).acumulado,
          'cache do mês guarda o acumulado atualizado');

        console.log('✔ SMOKE TEST DO FRONT-END PASSOU (inclui dashboard, tema, estático e mês da arrecadação)');
        process.exit(0);
      }, 300);
    }, 250);
  }, 250);
}, 300);
