// ============================================================
// Teste da migração Supabase ➜ Google Sheets (template TEO)
// Uso: node scripts/test-migracao.js
//
// Roda apps-script/MigrarSupabase.gs num contexto V8 (mesma engine do Apps
// Script) com UrlFetchApp/SpreadsheetApp simulados — nada real é tocado.
//
// Layout testado (template "120 Dias - Controle Financeiro Geral"):
//   linha 17 = cabeçalho · lançamentos a partir da linha 18
//   ENTRADAS  B:D (Data, Valor Bruto, Custo)      → extras em O:P:Q
//   SAÍDAS    J:N (Data, Descrição, Categoria, Valor, Observação)
//   E/F/G (Lucro Bruto, Dízimo, Valor Líquido) são fórmulas: nunca são tocadas
// Padrão: tudo na aba "Página1" (MIG_ABA_POR_MES = false).
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PLANILHA_DESTINO = '1WTL4V2AGx_jj84_rKU3Y18tGXgeN4dT9-ciYc0an_dA';
const MODELO = 'Página1';
const LINHA_DADOS = 18;
const FORMULA_LUCRO = '=ARRAYFORMULA(SE(C18:C="";"";C18:C-D18:D))';

// --------------------------------------------------- planilha falsa (grade)
const formatos = []; // registros de setNumberFormat: { aba, a1, fmt }

function colNum(letras) {
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function parseA1(a1) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  if (!m) throw new Error('endereço inválido: ' + a1);
  const c1 = colNum(m[1]), r1 = Number(m[2]);
  const c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
  return { r: r1, c: c1, nr: r2 - r1 + 1, nc: c2 - c1 + 1 };
}
function colLetra(n) {
  let s = '';
  while (n > 0) { const resto = (n - 1) % 26; s = String.fromCharCode(65 + resto) + s; n = (n - 1 - resto) / 26; }
  return s;
}

let copias = 0;
function makeSheet(nome, planilha) {
  const cells = new Map(); // "r,c" -> valor
  const key = (r, c) => r + ',' + c;
  const sh = {
    _cells: cells,
    getName: () => nome,
    setName(n) {
      planilha._abas.delete(nome);
      nome = n;
      planilha._abas.set(nome, sh);
      return sh;
    },
    getLastRow() {
      let max = 0;
      cells.forEach((v, k) => {
        if (v !== '' && v !== null && v !== undefined) max = Math.max(max, Number(k.split(',')[0]));
      });
      return max;
    },
    getRange(a, b, c, d) {
      const p = typeof a === 'string' ? parseA1(a) : { r: a, c: b, nr: c || 1, nc: d || 1 };
      const rng = {
        _r: p.r, _c: p.c, _nr: p.nr, _nc: p.nc,
        getA1: () => colLetra(p.c) + p.r +
          (p.nr > 1 || p.nc > 1 ? ':' + colLetra(p.c + p.nc - 1) + (p.r + p.nr - 1) : ''),
        getValue() { return this.getValues()[0][0]; },
        getValues() {
          const out = [];
          for (let i = 0; i < p.nr; i++) {
            const linha = [];
            for (let j = 0; j < p.nc; j++) {
              const v = cells.get(key(p.r + i, p.c + j));
              linha.push(v === undefined ? null : v);
            }
            out.push(linha);
          }
          return out;
        },
        setValues(matriz) {
          matriz.forEach((linha, i) => linha.forEach((v, j) => cells.set(key(p.r + i, p.c + j), v)));
          return rng;
        },
        setValue(v) { return rng.setValues([[v]]); },
        setFormula(f) { return rng.setValues([[f]]); },
        clearContent() {
          for (let i = 0; i < p.nr; i++) for (let j = 0; j < p.nc; j++) cells.delete(key(p.r + i, p.c + j));
          return rng;
        },
        setNumberFormat(f) { formatos.push({ aba: nome, a1: rng.getA1(), fmt: f }); return rng; },
        setFontWeight() { return rng; },
        setBackground() { return rng; },
        merge() { return rng; }
      };
      return rng;
    },
    setColumnWidth() {},
    setColumnWidths() {},
    copyTo(destino) {
      const copia = makeSheet(nome + ' (cópia ' + (++copias) + ')', destino);
      cells.forEach((v, k) => copia._cells.set(k, v));
      destino._abas.set(copia.getName(), copia);
      return copia;
    }
  };
  return sh;
}
function makeSpreadsheet(nome) {
  const abas = new Map();
  return {
    getName: () => nome || 'Planilha de teste',
    getSheetByName: (n) => abas.get(n) || null,
    insertSheet(n) { const sh = makeSheet(n, ss); abas.set(n, sh); return sh; },
    getSheets: () => Array.from(abas.values()),
    _abas: abas
  };
}
const limparAbas = () => Array.from(ss._abas.keys()).forEach((n) => ss._abas.delete(n));

// ------------------------------------------------- template (aba de destino)
/** Monta a aba com os blocos do template "120 Dias - Controle Financeiro Geral". */
function montarTemplate(nome) {
  const sh = ss.insertSheet(nome);
  sh.getRange('B1').setValue('120 Dias - Controle Financeiro Geral');
  sh.getRange('C3').setFormula('=SOMA(G18:G)');
  sh.getRange('F3').setFormula('=SOMA(M18:M)');
  sh.getRange('J3').setFormula('=C3-F3');
  sh.getRange('B4').setValue('ENTRADAS');
  sh.getRange('B8').setValue('CONTROLE DA ESTADIA');
  sh.getRange('J8').setValue('PAINEL DE PROGRESSO GERAL');
  sh.getRange('B9').setValue('Mês');
  sh.getRange('B10').setValue('1º mês');
  sh.getRange('B13').setValue('4º mês');
  sh.getRange('J10').setValue('Passagens');
  sh.getRange('M13').setFormula('=MÁXIMO(0;MÍNIMO(SE(K13=0;0;L13/K13);1))');
  sh.getRange('B16').setValue('ENTRADAS');
  sh.getRange('J16').setValue('SAÍDAS');
  // cabeçalho das tabelas (linha 17)
  sh.getRange('B17').setValue('Data');
  sh.getRange('J17').setValue('Data');
  sh.getRange('C17').setValue('Valor Bruto');
  sh.getRange('D17').setValue('Custo');
  sh.getRange('E17').setValue('Lucro Bruto');
  sh.getRange('F17').setValue('Dízimo (10%)');
  sh.getRange('G17').setValue('Valor Líquido');
  sh.getRange('K17').setValue('Descrição');
  sh.getRange('L17').setValue('Categoria');
  sh.getRange('M17').setValue('Valor');
  sh.getRange('N17').setValue('Observação');
  // fórmulas automáticas da 1ª linha de dados
  sh.getRange('E18').setFormula(FORMULA_LUCRO);
  sh.getRange('F18').setFormula('=ARRAYFORMULA(SE(E18:E="";"";E18:E*10%))');
  sh.getRange('G18').setFormula('=ARRAYFORMULA(SE(E18:E="";"";E18:E-F18:F))');
  return sh;
}

// ------------------------------------------ UrlFetchApp falso (PostgREST)
const SUPABASE = {
  meses: ['2025-08', '2026-07', '2026-08'],
  lancamentos: {
    '2025-08': [
      { num: 1, tipo: 'entrada', data: '2025-08-10', descricao: 'Freela', categoria: 'Extra', conta: 'Pix', valor: 300 }
    ],
    '2026-07': [
      { num: 1, tipo: 'saida', data: '2026-07-03', descricao: 'Aluguel', categoria: 'Moradia', conta: 'Banco', valor: 1200 }
    ],
    // `num` propositalmente fora de ordem alfabética: prova que o desempate usa o num
    '2026-08': [
      { num: 3, tipo: 'entrada', data: '2026-08-20', descricao: 'Reembolso', categoria: 'Extra', conta: 'Pix', valor: 80.5 },
      { num: 1, tipo: 'entrada', data: '2026-08-05', descricao: 'Salário', categoria: 'Salário', conta: 'Banco do Brasil', valor: 2500 },
      { num: 2, tipo: 'saida', data: '2026-08-01', descricao: 'Supermercado', categoria: 'Alimentação', conta: 'Cartão', valor: 500 },
      { num: 4, tipo: 'saida', data: '2026-08-01', descricao: 'Farmácia', categoria: 'Saúde', conta: 'Cartão', valor: 120 },
      { num: 5, tipo: 'entrada', data: '2026-08-20', descricao: 'Ajuste', categoria: 'Extra', conta: 'Pix', valor: 12 }
    ]
  }
};
const FIXTURE = JSON.parse(JSON.stringify(SUPABASE)); // cópia limpa do fixture
const restaurarFixture = () => {
  SUPABASE.meses = FIXTURE.meses.slice();
  SUPABASE.lancamentos = JSON.parse(JSON.stringify(FIXTURE.lancamentos));
};

let falhaHttp = null; // { codigo, corpo, tabela? } força um erro
const requisicoes = [];

function resposta(codigo, corpo) {
  return { getResponseCode: () => codigo, getContentText: () => corpo };
}

const UrlFetchApp = {
  fetch(url, opts) {
    requisicoes.push({ url, opts });
    const [base, query = ''] = url.split('?');
    const tabela = base.split('/rest/v1/')[1];
    if (falhaHttp && (!falhaHttp.tabela || falhaHttp.tabela === tabela)) {
      return resposta(falhaHttp.codigo, falhaHttp.corpo);
    }
    if (tabela === 'meses') {
      return resposta(200, JSON.stringify(SUPABASE.meses.map((id) => ({ id }))));
    }
    if (tabela === 'lancamentos') {
      const m = /mes_id=eq\.([^&]+)/.exec(query);
      const mesId = m ? decodeURIComponent(m[1]) : '';
      let rows = (SUPABASE.lancamentos[mesId] || []).slice()
        .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.num - b.num));
      const range = opts && opts.headers && opts.headers.Range;
      if (range) {
        const [ini, fim] = range.split('-').map(Number);
        rows = rows.slice(ini, fim + 1);
      }
      return resposta(200, JSON.stringify(rows));
    }
    return resposta(404, JSON.stringify({ message: 'tabela desconhecida: ' + tabela }));
  }
};

// ------------------------------------------------------- contexto Apps Script
const ss = makeSpreadsheet();
const logs = [];
let abertaCom = null;   // id passado para SpreadsheetApp.openById
let propriedades = {};  // Propriedades do script simuladas
const ctx = {
  UrlFetchApp,
  SpreadsheetApp: {
    openById: (id) => { abertaCom = id; return ss; },
    getActiveSpreadsheet: () => ss
  },
  Logger: { log: (m) => logs.push(String(m)) },
  Date,
  Math,
  Object,
  Array,
  Number,
  String,
  JSON,
  isNaN,
  isFinite,
  parseFloat,
  encodeURIComponent,
  console
};
Object.defineProperty(ctx, 'PropertiesService', {
  configurable: true,
  get: () => ({
    getScriptProperties: () => ({ getProperty: (k) => (k in propriedades ? propriedades[k] : null) })
  })
});
vm.createContext(ctx);
const fonte = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'MigrarSupabase.gs'), 'utf8');
vm.runInContext(fonte, ctx); // só o script de migração: sem Code.gs

montarTemplate(MODELO);

const sheetDe = (aba) => {
  const sh = ss.getSheetByName(aba);
  assert.ok(sh, 'aba não encontrada: ' + aba);
  return sh;
};
const cell = (aba, a1) => sheetDe(aba).getRange(a1).getValue();
const ultimaLinha = (aba) => sheetDe(aba).getLastRow();
const YMD = (d) => d instanceof Date
  ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  : d;
// valores criados dentro do contexto vm têm protótipos de outro realm,
// então a comparação profunda é feita via JSON
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg || '');

// --------------------------------------------------------- destino
assert.strictEqual(ctx.MIG_SPREADSHEET_ID, PLANILHA_DESTINO);
assert.strictEqual(ctx.migPlanilha(), ss);
assert.strictEqual(abertaCom, PLANILHA_DESTINO, 'deve abrir a planilha de destino');
assert.strictEqual(ctx.migNomePlanilha(ss), 'Planilha de teste');

// Propriedade do script sobrepõe a constante (troca de destino sem editar código)
propriedades = { SPREADSHEET_ID: 'outra-planilha' };
assert.strictEqual(ctx.migPlanilha(), ss);
assert.strictEqual(abertaCom, 'outra-planilha');
propriedades = {};

// sem constante → usa a planilha ativa
const destinoOriginal = ctx.MIG_SPREADSHEET_ID;
abertaCom = null;
ctx.MIG_SPREADSHEET_ID = '';
assert.strictEqual(ctx.migPlanilha(), ss);
assert.strictEqual(abertaCom, null); // não passou por openById
ctx.MIG_SPREADSHEET_ID = destinoOriginal;
assert.strictEqual(ctx.migPlanilha(), ss);
assert.strictEqual(abertaCom, PLANILHA_DESTINO);

// ------------------------------------------------------------ lógica pura
assert.strictEqual(ctx.MIG_ABA_MODELO, MODELO);
assert.strictEqual(ctx.MIG_LINHA_DADOS, LINHA_DADOS); // 18 — não herda o Code.gs
assert.strictEqual(ctx.MIG_ABA_POR_MES, false);       // padrão: tudo em Página1
assert.strictEqual(ctx.migPartesMes('2026-13'), null);
assert.strictEqual(ctx.migNumeroMes('dez'), 12);
assert.strictEqual(ctx.migChaveMes('Agosto 2026'), '2026-08');
assert.strictEqual(ctx.migNomeAba('Agosto', {}), 'Agosto');

const bancoAtual = ['Agosto', 'Setembro'];
eq(ctx.migResolverMeses(bancoAtual, 'Agosto').ids, ['Agosto']);
eq(ctx.migResolverMeses(bancoAtual, 'agosto 2026').ids, ['Agosto']); // banco sem ano
eq(ctx.migResolverMeses(bancoAtual, 'set').ids, ['Setembro']);
eq(ctx.migResolverMeses(bancoAtual, '').ids, bancoAtual);            // sem filtro = todos
assert.ok(/Meses disponíveis: Agosto, Setembro/.test(ctx.migResolverMeses(bancoAtual, 'Outubro').erro));
assert.ok(/mais de um mês/.test(ctx.migResolverMeses(['2025-08', '2026-08'], 'Agosto').erro));

assert.strictEqual(ctx.migValor('abc'), 0);
assert.strictEqual(ctx.migTexto('  Mercado  ', 120), 'Mercado');
assert.strictEqual(ctx.migTexto('x'.repeat(130), 120).length, 120);
assert.strictEqual(ctx.migBRL(1234.5), 'R$ 1.234,50');
assert.strictEqual(YMD(ctx.migData('2026-08-05')), '2026-08-05');
assert.strictEqual(ctx.migData(''), null);
assert.strictEqual(ctx.migSoma([{ valor: 1.5 }, { valor: '2.25' }]), 3.75);

// ordenação: data → num → descrição → valor
const ordenados = ctx.migOrdenar([
  { data: '2026-08-20', num: 5, descricao: 'Ajuste', valor: 12 },
  { data: '2026-08-05', num: 1, descricao: 'Salário', valor: 2500 },
  { data: '2026-08-20', num: 3, descricao: 'Reembolso', valor: 80.5 }
]).map((r) => r.descricao);
eq(ordenados, ['Salário', 'Reembolso', 'Ajuste']);

// ---------------------------------------------------- template (sanidade)
assert.strictEqual(ctx.migPareceTemplate(ss.getSheetByName(MODELO)), true);
assert.strictEqual(ctx.migPareceTemplate(ss.insertSheet('Vazia')), false);
ss._abas.delete('Vazia');

// sem a aba de destino → erro claro
limparAbas();
assert.throws(() => ctx.migrarDoSupabase(), /aba "Página1" não encontrada/);

// destino existe mas não tem o template → erro claro (não escreve em lugar errado)
ss.insertSheet(MODELO);
assert.throws(() => ctx.migrarDoSupabase(), /não tem as tabelas do template/);
assert.strictEqual(ultimaLinha(MODELO), 0, 'aba sem template não pode ser escrita');
limparAbas();
montarTemplate(MODELO);

// ------------------------------------------- migração completa (aba única)
formatos.length = 0;
const res = ctx.migrarDoSupabase();
assert.strictEqual(res.ok, true, JSON.stringify(res.erros));
assert.strictEqual(res.planilha, 'Planilha de teste');
eq(ss.getSheets().map((s) => s.getName()), [MODELO], 'não deve criar outras abas');
eq(res.meses.map((m) => m.aba), [MODELO, MODELO, MODELO]);
eq(res.meses.map((m) => m.mes), ['2025-08', '2026-07', '2026-08']);

// ENTRADAS em B:D a partir da linha 18, em ordem de data (meses juntos)
assert.strictEqual(YMD(cell(MODELO, 'B18')), '2025-08-10'); // Freela
assert.strictEqual(cell(MODELO, 'C18'), 300);
assert.strictEqual(cell(MODELO, 'D18'), '');                // Custo fica em branco
assert.strictEqual(YMD(cell(MODELO, 'B19')), '2026-08-05'); // Salário
assert.strictEqual(cell(MODELO, 'C19'), 2500);
assert.strictEqual(cell(MODELO, 'C20'), 80.5);              // Reembolso (num 3)
assert.strictEqual(cell(MODELO, 'C21'), 12);                // Ajuste (num 5)
assert.strictEqual(cell(MODELO, 'B22'), null);

// SAÍDAS em J:N
assert.strictEqual(YMD(cell(MODELO, 'J18')), '2026-07-03');
assert.strictEqual(cell(MODELO, 'K18'), 'Aluguel');
assert.strictEqual(cell(MODELO, 'L18'), 'Moradia');
assert.strictEqual(cell(MODELO, 'M18'), 1200);
assert.strictEqual(cell(MODELO, 'N18'), 'Banco');           // Observação = conta
assert.strictEqual(cell(MODELO, 'K19'), 'Supermercado');
assert.strictEqual(cell(MODELO, 'M19'), 500);
assert.strictEqual(cell(MODELO, 'K20'), 'Farmácia');
assert.strictEqual(cell(MODELO, 'M20'), 120);
assert.strictEqual(cell(MODELO, 'J21'), null);

// as colunas de fórmula do template continuam intactas
assert.strictEqual(cell(MODELO, 'E18'), FORMULA_LUCRO);
assert.strictEqual(cell(MODELO, 'F18'), '=ARRAYFORMULA(SE(E18:E="";"";E18:E*10%))');
assert.strictEqual(cell(MODELO, 'G18'), '=ARRAYFORMULA(SE(E18:E="";"";E18:E-F18:F))');
assert.strictEqual(cell(MODELO, 'C3'), '=SOMA(G18:G)');
assert.strictEqual(cell(MODELO, 'F3'), '=SOMA(M18:M)');
assert.strictEqual(cell(MODELO, 'J3'), '=C3-F3');
assert.strictEqual(cell(MODELO, 'M13'), '=MÁXIMO(0;MÍNIMO(SE(K13=0;0;L13/K13);1))');
assert.strictEqual(cell(MODELO, 'B17'), 'Data');
assert.strictEqual(cell(MODELO, 'B8'), 'CONTROLE DA ESTADIA'); // blocos manuais intactos

// extras das ENTRADAS (o template não tem Descrição/Categoria/Conta) em O:P:Q
assert.strictEqual(cell(MODELO, 'O18'), 'Freela');
assert.strictEqual(cell(MODELO, 'P18'), 'Extra');
assert.strictEqual(cell(MODELO, 'Q18'), 'Pix');
assert.strictEqual(cell(MODELO, 'O19'), 'Salário');
assert.strictEqual(cell(MODELO, 'Q19'), 'Banco do Brasil');
assert.strictEqual(cell(MODELO, 'O21'), 'Ajuste');
assert.strictEqual(cell(MODELO, 'O22'), null);

// relatório por mês
const ago = res.meses.find((m) => m.mes === '2026-08');
assert.strictEqual(ago.entradas, 3);
assert.strictEqual(ago.saidas, 2);
assert.strictEqual(ago.totalEntradas, 2592.5);
assert.strictEqual(ago.totalSaidas, 620);
assert.strictEqual(ago.balanco, 1972.5);
assert.strictEqual(ago.linhaInicial, LINHA_DADOS);
assert.strictEqual(ago.linhaFinal, LINHA_DADOS + 3); // 4 entradas > 3 saídas
assert.strictEqual(res.meses[1].entradas, 0);        // Julho só tem saída
assert.strictEqual(res.meses[1].saidas, 1);

// formatos aplicados nas faixas certas (nunca em E/F/G)
const fmt = {};
formatos.forEach((f) => { fmt[f.a1 + '|' + f.fmt] = (fmt[f.a1 + '|' + f.fmt] || 0) + 1; });
assert.ok(fmt['B18:B21|dd/mm'], 'datas das ENTRADAS em dd/mm');
assert.ok(fmt['J18:J21|dd/mm'], 'datas das SAÍDAS em dd/mm');
assert.ok(fmt['C18:D21|R$ #,##0.00'], 'valores das ENTRADAS em moeda');
assert.ok(fmt['M18:M21|R$ #,##0.00'], 'valores das SAÍDAS em moeda');
assert.ok(!Object.keys(fmt).some((k) => /^[EFG]1[89]/.test(k)), 'E/F/G não podem ser formatadas');

// ------------------------------------------------------ idempotência (2x)
const antes = ultimaLinha(MODELO);
assert.strictEqual(antes, LINHA_DADOS + 3);
ctx.migrarDoSupabase();
assert.strictEqual(ultimaLinha(MODELO), antes, 'não deve duplicar linhas');
assert.strictEqual(cell(MODELO, 'K18'), 'Aluguel');
assert.strictEqual(cell(MODELO, 'B18'), cell(MODELO, 'B18'));
assert.strictEqual(cell(MODELO, 'E18'), FORMULA_LUCRO);

// o que saiu do banco também sai da planilha (linha órfã é removida)
sheetDe(MODELO).getRange('B22').setValue('2025-01-31');
sheetDe(MODELO).getRange('K22').setValue('lançamento antigo');
assert.strictEqual(ultimaLinha(MODELO), LINHA_DADOS + 4);
ctx.migrarDoSupabase();
assert.strictEqual(ultimaLinha(MODELO), LINHA_DADOS + 3, 'linha órfã deve ser limpa');
assert.strictEqual(cell(MODELO, 'K22'), null);
assert.strictEqual(cell(MODELO, 'B22'), null);

// ------------------------------------------------------- filtro de um mês
const soJulho = ctx.migrarDoSupabase('2026-07');
assert.strictEqual(soJulho.meses.length, 1);
assert.strictEqual(soJulho.meses[0].mes, '2026-07');
assert.strictEqual(cell(MODELO, 'B18'), null);      // nada de entrada em julho
assert.strictEqual(cell(MODELO, 'K18'), 'Aluguel');
assert.strictEqual(cell(MODELO, 'K19'), null);      // só 1 saída

// ------------------------------------- ids no formato real do banco (nomes)
SUPABASE.meses = ['Agosto', 'Setembro'];
SUPABASE.lancamentos = {
  Agosto: [
    { num: 1, tipo: 'entrada', data: '2026-08-05', descricao: 'Venda chaveiros', categoria: 'Arrecadação', conta: 'Pix', valor: 1000 },
    { num: 2, tipo: 'saida', data: '2026-08-06', descricao: 'Dízimo', categoria: 'Dízimo', conta: 'Pix', valor: 100 }
  ],
  Setembro: [
    { num: 1, tipo: 'saida', data: '2026-09-02', descricao: 'Aluguel', categoria: 'Moradia', conta: 'Físico', valor: 1500 }
  ]
};
const rNomes = ctx.migrarDoSupabase();
assert.strictEqual(rNomes.ok, true, JSON.stringify(rNomes.erros));
eq(rNomes.meses.map((m) => m.aba), [MODELO, MODELO]);
assert.strictEqual(cell(MODELO, 'C18'), 1000);
assert.strictEqual(cell(MODELO, 'O18'), 'Venda chaveiros');
assert.strictEqual(cell(MODELO, 'K18'), 'Dízimo');       // 06/08 antes de 02/09
assert.strictEqual(cell(MODELO, 'K19'), 'Aluguel');
assert.strictEqual(cell(MODELO, 'N19'), 'Físico');
assert.strictEqual(cell(MODELO, 'K20'), null);

// filtros pelo nome (o banco não guarda o ano)
assert.strictEqual(ctx.migrarDoSupabase('setembro 2026').meses[0].mes, 'Setembro');
assert.strictEqual(ctx.migrarDoSupabase('ago').meses[0].mes, 'Agosto');
assert.throws(() => ctx.migrarDoSupabase('Outubro'),
  /Nenhum mês do banco corresponde a "Outubro"\. Meses disponíveis: Agosto, Setembro\./);

// -------------------- ids misturados (nome + AAAA-MM) somando na mesma aba
SUPABASE.meses = ['Agosto', '2026-08'];
SUPABASE.lancamentos['2026-08'] = SUPABASE.lancamentos['Agosto'];
const mistos = ctx.migrarDoSupabase();
assert.strictEqual(mistos.ok, true, JSON.stringify(mistos.erros));
eq(mistos.meses.map((m) => m.entradas), [1, 1]);   // dois ids, cada um com 1 entrada
assert.strictEqual(cell(MODELO, 'C18'), 1000);
assert.strictEqual(cell(MODELO, 'C19'), 1000);     // as duas entradas convivem na aba

// ----------------------- modo opcional: uma aba por mês (MIG_ABA_POR_MES)
ctx.MIG_ABA_POR_MES = true;
limparAbas();
montarTemplate(MODELO);
restaurarFixture();

// aba que já existe e não é do template → erro, sem escrever nela
ss.insertSheet('Julho');
const comAbaRuim = ctx.migrarDoSupabase();
assert.strictEqual(comAbaRuim.ok, false);
assert.strictEqual(comAbaRuim.erros.length, 1);
assert.ok(/não tem as tabelas do template/.test(comAbaRuim.erros[0]), comAbaRuim.erros[0]);
assert.strictEqual(ultimaLinha('Julho'), 0, 'aba estranha não pode ser escrita');
assert.strictEqual(ss.getSheetByName('Agosto 2026').getLastRow(), LINHA_DADOS + 2, 'os outros meses migram');
ss._abas.delete('Julho');

const porMes = ctx.migrarDoSupabase();
assert.strictEqual(porMes.ok, true, JSON.stringify(porMes.erros));
eq(porMes.meses.map((m) => m.aba), ['Agosto 2025', 'Julho', 'Agosto 2026']);
eq(porMes.meses.map((m) => m.criada), [false, true, false]);
eq(ss.getSheets().map((s) => s.getName()), [MODELO, 'Agosto 2025', 'Agosto 2026', 'Julho']);

// a cópia leva o template inteiro (cabeçalho, fórmulas, blocos)
assert.strictEqual(cell('Julho', 'B1'), '120 Dias - Controle Financeiro Geral');
assert.strictEqual(cell('Julho', 'B17'), 'Data');
assert.strictEqual(cell('Julho', 'E18'), FORMULA_LUCRO);
assert.strictEqual(cell('Julho', 'C3'), '=SOMA(G18:G)');
assert.strictEqual(YMD(cell('Julho', 'J18')), '2026-07-03');
assert.strictEqual(cell('Julho', 'B18'), null);        // mês só com saída
assert.strictEqual(cell('Agosto 2026', 'C18'), 2500);
assert.strictEqual(cell('Agosto 2026', 'K18'), 'Supermercado');

// a aba de destino fica intacta (sem dados)
assert.strictEqual(ultimaLinha(MODELO), LINHA_DADOS);
assert.strictEqual(cell(MODELO, 'B18'), null);
assert.strictEqual(cell(MODELO, 'J18'), null);

// dois ids que cairiam na MESMA aba → erro explícito, em vez de sobrescrever
SUPABASE.meses = ['2026-08', 'Agosto 2026'];
const colisao = ctx.migrarDoSupabase();
assert.strictEqual(colisao.ok, false);
assert.strictEqual(colisao.erros.length, 1);
assert.ok(/seria usada também por "2026-08"/.test(colisao.erros[0]), colisao.erros[0]);

// volta ao padrão (aba única)
ctx.MIG_ABA_POR_MES = false;
limparAbas();
montarTemplate(MODELO);
restaurarFixture();

// ------------------------------------------------ erros do Supabase (401)
falhaHttp = { codigo: 401, corpo: JSON.stringify({ message: 'Invalid API key' }) };
assert.throws(() => ctx.migrarDoSupabase(), /Supabase HTTP 401 — Invalid API key/);
assert.throws(() => ctx.testarSupabase(), /Supabase HTTP 401 — Invalid API key/);
// falha só ao ler os lançamentos: coletada por mês, sem derrubar os outros
falhaHttp = { tabela: 'lancamentos', codigo: 500, corpo: JSON.stringify({ message: 'boom' }) };
const comErro = ctx.migrarDoSupabase();
assert.strictEqual(comErro.ok, false);
assert.strictEqual(comErro.meses.length, 0);
assert.strictEqual(comErro.erros.length, SUPABASE.meses.length);
assert.ok(/Supabase HTTP 500 — boom/.test(comErro.erros[0]), comErro.erros[0]);
falhaHttp = null;

// --------------------------------------------------- paginação (>1000 linhas)
const paginado = [];
for (let i = 1; i <= 1500; i++) {
  paginado.push({ num: i, tipo: 'entrada', data: '2026-05-01', descricao: 'P' + i, categoria: '', conta: '', valor: 1 });
}
SUPABASE.meses = ['2026-05'];
SUPABASE.lancamentos = { '2026-05': paginado };
const antesPag = requisicoes.length;
ctx.migrarDoSupabase('2026-05');
const paginas = requisicoes.slice(antesPag).filter((r) => /lancamentos/.test(r.url));
assert.strictEqual(paginas.length, 2, 'deveria paginar em 2 requisições (1000 + 500)');
assert.strictEqual(paginas[0].opts.headers.Range, '0-999');
assert.strictEqual(paginas[1].opts.headers.Range, '1000-1999');
assert.strictEqual(ultimaLinha(MODELO), LINHA_DADOS + 1499);

// ------------------------------------------------------ testarSupabase()
eq(ctx.testarSupabase().meses, ['2026-05']);

// ------------------------------------------- ação 'migrar' no roteador HTTP
const codeGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
vm.runInContext(codeGs, ctx); // agora no mesmo contexto: Code.gs + MigrarSupabase.gs
assert.strictEqual(typeof ctx.acaoMigrar, 'function');
const viaHttp = ctx.processar({ action: 'migrar', key: ctx.APP_KEY, mes: '2026-05' });
assert.strictEqual(viaHttp.ok, true);
assert.strictEqual(viaHttp.meses[0].aba, MODELO);
assert.strictEqual(ctx.processar({ action: 'migrar', key: 'errada' }).erro, 'Chave de acesso inválida.');

console.log('✅ scripts/test-migracao.js — todos os testes passaram');
