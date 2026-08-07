// ============================================================
// Teste da lógica pura do backend (apps-script/Code.gs)
// Uso: node scripts/test-backend.js
// Simula o que o Google Apps Script faz (mesma engine V8).
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

// --- parseValor ---------------------------------------------------------
assert.strictEqual(ctx.parseValor('R$ 1.234,56'), 1234.56);
assert.strictEqual(ctx.parseValor('50,00'), 50);
assert.strictEqual(ctx.parseValor('50.00'), 50);
assert.strictEqual(ctx.parseValor(50), 50);
assert.strictEqual(ctx.parseValor(''), 0);

// --- parseData / fmtData (datas criadas DENTRO do contexto, como no runtime) --
const d = ctx.parseData('2026-08-05');
assert.strictEqual(d.getFullYear(), 2026);
assert.strictEqual(d.getMonth(), 7);
assert.strictEqual(d.getDate(), 5);
assert.strictEqual(ctx.fmtData(d), '2026-08-05');
assert.strictEqual(ctx.fmtData('x'), 'x');
assert.strictEqual(ctx.fmtData(null), '');

// --- montar / linhaPreenchida --------------------------------------------
eq(ctx.montar([ctx.parseData('2026-08-05'), 'Salário', 'Salário', 'Banco do Brasil', 50], 7),
   { linha: 7, data: '2026-08-05', descricao: 'Salário', categoria: 'Salário', conta: 'Banco do Brasil', valor: 50 });
assert.strictEqual(ctx.linhaPreenchida(['', '', '', '', '']), false);
assert.strictEqual(ctx.linhaPreenchida(['', 'x', '', '', '']), true);
assert.strictEqual(ctx.linhaPreenchida([null, null, null, null, null]), false); // null = vazia

// --- acharLinhaLivre (mock fiel: célula vazia = null, getRange devolve n linhas)
function mockSh(vals) {
  return {
    getLastRow: () => 6 + vals.length,
    getRange: (r, c, n) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push([vals[i] === undefined ? null : vals[i]]);
      return { getValues: () => out };
    }
  };
}
assert.strictEqual(ctx.acharLinhaLivre(mockSh(['x', '', '', '']), 1), 8); // 1ª vazia após a 7
assert.strictEqual(ctx.acharLinhaLivre(mockSh(['x', 'y', 'z']), 1), 10); // todas cheias → lastRow+1
assert.strictEqual(ctx.acharLinhaLivre(mockSh([]), 1), 7);               // aba vazia → linha 7

// --- zerarTotais ----------------------------------------------------------
eq(ctx.zerarTotais(), { entradas: 0, saidas: 0, balanco: 0 });

// --- acaoLancamentos ------------------------------------------------------
const ent = [ctx.parseData('2026-08-01'), 'Salário', 'Salário', 'Banco do Brasil', 50];
const sai = [ctx.parseData('2026-08-01'), 'Supermercado', 'Alimentação', 'Cartão de Crédito', 500];
const plan = {
  getSheetByName: (n) => n === 'Agosto' ? {
    getLastRow: () => 7,
    getRange: (r, c, nrows) => {
      const linhas = Array.from({ length: nrows }, (_, i) => i + r);
      return { getValues: () => linhas.map(ln => ln === 7 ? (c === 1 ? ent : sai) : ['', '', '', '', '']) };
    }
  } : null
};
const res = ctx.acaoLancamentos(plan, 'Agosto');
assert.strictEqual(res.ok, true);
assert.strictEqual(res.entradas.length, 1);
assert.strictEqual(res.entradas[0].descricao, 'Salário');
assert.strictEqual(res.saidas.length, 1);
assert.strictEqual(res.totais.entradas, 50);
assert.strictEqual(res.totais.saidas, 500);
assert.strictEqual(res.totais.balanco, -450);
const resVazio = ctx.acaoLancamentos(plan, 'Janeiro');
assert.strictEqual(resVazio.existe, false);
assert.strictEqual(resVazio.totais.balanco, 0);

// --- acaoOpcoes -----------------------------------------------------------
const opPlan = {
  getSheets: () => [{
    getLastRow: () => 7,
    getRange: (r, c, nrows) => ({ getValues: () => [
      [ctx.parseData('2026-08-01'), 'Salário', 'Salário', 'Banco do Brasil', 50,
       '', ctx.parseData('2026-08-01'), 'Mercado', 'Alimentação', 'Cartão de Crédito', 500]
    ] })
  }]
};
eq(ctx.acaoOpcoes(opPlan),
   { ok: true, categorias: ['Alimentação', 'Salário'], contas: ['Banco do Brasil', 'Cartão de Crédito'] });

// --- roteador: chave inválida ---------------------------------------------
eq(ctx.processar({ action: 'meses', key: 'errada' }), { ok: false, erro: 'Chave de acesso inválida.' });

console.log('✔ TODOS OS TESTES PASSARAM (backend lógica pura)');
