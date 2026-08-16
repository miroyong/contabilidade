// ============================================================
// Teste do fix de persistência (app.js salvarLancamento).
//
// Bug reportado: "às vezes, apesar de salvar, ao reabrir mostra
// o valor antigo". Causa: o cache local (localStorage cf_lan_*)
// era gravado ANTES de o servidor confirmar; se o POST falhava,
// o cache guardava um lançamento que o servidor não tinha. Ao
// reabrir, o app revalidava no servidor e sobrescrevia o cache
// com o valor antigo — o lançamento "salvo" sumia.
//
// Corrigido: o cache SÓ é gravado (e o sucesso só mostrado)
// DEPOIS de o servidor responder ok. Em falha, recarrega do
// servidor e o cache volta a refletir a verdade (sem fantasma).
//
// Uso: node scripts/test-persistencia.js
// Valida 2 cenários com o mesmo harness:
//   A) servidor NEGA o adicionar -> cache limpo, lista vazia
//   B) servidor ACEITA o adicionar -> cache com o item
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

function makeEl(id) {
  const el = {
    id, hidden: false, innerHTML: '', value: '', className: '', dataset: {},
    style: {}, open: false, _timer: null, _tc: '', _listeners: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    setAttribute() {}, removeAttribute() {}
  };
  Object.defineProperty(el, 'textContent', {
    get() { return this._tc; }, set(v) { this._tc = String(v); }
  });
  return el;
}

// re-executa todo o app com um mock de fetch configurável e retorna handles
function boot(failServer) {
  const els = {}, byId = (id) => (els[id] || (els[id] = makeEl(id)));
  const ids = ['aviso-config', 'saldo-mes', 'saldo-valor', 'saldo-entradas', 'saldo-saidas',
    'saldo-pix', 'saldo-fisico', 'btn-planilha', 'btn-tema', 'meses-list', 'aviso-mes',
    'btn-novo', 'filtro-tipo', 'filtro-categoria', 'filtro-conta', 'filtro-busca', 'grafico',
    'contador', 'lista', 'modal', 'modal-titulo', 'f-data', 'f-descricao', 'f-categoria',
    'f-conta', 'f-valor', 'dl-categorias', 'dl-contas', 'btn-cancelar', 'btn-novo-mes',
    'toast', 'form-lancamento', 'btn-salvar', 'pizza-grafico', 'insights', 'sync-status',
    'f-recorrente', 'f-recorrente-meses'];
  ids.forEach(i => byId(i));
  byId('f-recorrente').checked = false;
  global.document = {
    getElementById: byId,
    querySelectorAll: () => [],
    querySelector: (s) => { const el = makeEl(s); if (s === '.tipo-btn.ativo') el.dataset.tipo = 'saida'; return el; },
    documentElement: { dataset: {} }
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
  global.prompt = () => 'Agosto';
  global.Intl = Intl;

  global.fetch = (url, opts) => {
    const c = JSON.parse(opts.body);
    let r;
    if (c.action === 'meses') r = { ok: true, meses: ['Agosto'], mesAtual: 'Agosto' };
    else if (c.action === 'opcoes') r = { ok: true, categorias: [], contas: ['Pix', 'Físico'] };
    else if (c.action === 'lancamentos') r = { ok: true, existe: true, mes: 'Agosto', entradas: [], saidas: [], totais: {} };
    else if (c.action === 'adicionar') r = failServer ? { ok: false, erro: 'A aba não existe.' } : { ok: true, linha: 7 };
    else r = { ok: true };
    return Promise.resolve({ json: () => Promise.resolve(r) });
  };

  const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  eval(appJs);
  return { byId, memStore };
}

function submit(byId) {
  byId('f-data').value = '2026-08-05';
  byId('f-descricao').value = 'ITEM BUG';
  byId('f-categoria').value = 'Serviços';
  byId('f-conta').value = 'Pix';
  byId('f-valor').value = '100';
  const fns = byId('form-lancamento')._listeners['submit'] || [];
  assert.ok(fns.length, 'listener de submit registrado');
  fns.forEach(fn => fn({ preventDefault() {} }));
}
const cacheSaidasLen = (store) => { const c = JSON.parse(store['cf_lan_Agosto'] || 'null'); return c ? c.saidas.length : 0; };

// ---------- cena A: servidor rejeita ----------
const A = boot(true);
setTimeout(() => {
  assert.strictEqual(A.byId('saldo-mes').textContent, 'Agosto', 'A: mês carregado');
  assert.strictEqual(A.byId('contador').textContent, '0', 'A: contador inicial 0');

  submit(A.byId);
  const toastImediato = A.byId('toast').textContent;
  assert.ok(toastImediato.indexOf('Adicionado') < 0,
    'A: não confirma sucesso antes da resposta do servidor (toast="' + toastImediato + '")');

  setTimeout(() => {
    assert.strictEqual(cacheSaidasLen(A.memStore), 0,
      'A: após falha, cache não guarda o lançamento não confirmado');
    assert.ok(A.byId('lista').innerHTML.indexOf('ITEM BUG') < 0,
      'A: lista não mostra item que o servidor rejeitou');
    assert.strictEqual(A.byId('contador').textContent, '0', 'A: contador volta a 0');
    console.log('✔ CENA A (servidor nega): cache limpo, lista vazia, sem fantasma');

    // ---------- cena B: servidor aceita ----------
    const B = boot(false);
    setTimeout(() => {
      assert.strictEqual(B.byId('contador').textContent, '0', 'B: contador inicial 0');
      submit(B.byId);
      setTimeout(() => {
        assert.strictEqual(cacheSaidasLen(B.memStore), 1,
          'B: após sucesso, cache PERSISTE o lançamento');
        assert.ok(B.byId('lista').innerHTML.indexOf('ITEM BUG') >= 0,
          'B: lista mostra item salvo com sucesso');
        assert.strictEqual(B.byId('contador').textContent, '1', 'B: contador reflete item salvo');
        console.log('✔ CENA B (servidor aceita): cache persiste o item salvo');
        console.log('✔ TESTE DE PERSISTÊNCIA PASSOU (falha não gera fantasma, sucesso persiste)');
        process.exit(0);
      }, 400);
    }, 300);
  }, 400);
}, 300);
