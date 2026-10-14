// ============================================================
// Teste da migração Supabase ➜ Google Sheets
// Uso: node scripts/test-migracao.js
//
// Roda apps-script/MigrarSupabase.gs dentro de um contexto V8 (mesma engine do
// Apps Script) com UrlFetchApp/SpreadsheetApp simulados — nenhuma requisição
// real nem planilha real são usadas.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PLANILHA_DESTINO = '1WTL4V2AGx_jj84_rKU3Y18tGXgeN4dT9-ciYc0an_dA';

// --------------------------------------------------- planilha falsa (grade)
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
function makeSheet(nome) {
  const cells = new Map(); // "r,c" -> valor
  const key = (r, c) => r + ',' + c;
  const sh = {
    getName: () => nome,
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
        setNumberFormat() { return rng; },
        setFontWeight() { return rng; },
        setBackground() { return rng; },
        merge() { return rng; }
      };
      return rng;
    },
    setColumnWidth() {},
    setColumnWidths() {}
  };
  return sh;
}
function makeSpreadsheet(nome) {
  const abas = new Map();
  return {
    getName: () => nome || 'Planilha de teste',
    getSheetByName: (n) => abas.get(n) || null,
    insertSheet(n) { const sh = makeSheet(n); abas.set(n, sh); return sh; },
    getSheets: () => Array.from(abas.values()),
    _abas: abas
  };
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
    // `num` propositalmente "fora de ordem" alfabética, para provar que a
    // ordenação usa o num (a "linha" estável do banco) quando há empate de data
    '2026-08': [
      { num: 3, tipo: 'entrada', data: '2026-08-20', descricao: 'Reembolso', categoria: 'Extra', conta: 'Pix', valor: 80.5 },
      { num: 1, tipo: 'entrada', data: '2026-08-05', descricao: 'Salário', categoria: 'Salário', conta: 'Banco do Brasil', valor: 2500 },
      { num: 2, tipo: 'saida', data: '2026-08-01', descricao: 'Supermercado', categoria: 'Alimentação', conta: 'Cartão', valor: 500 },
      { num: 4, tipo: 'saida', data: '2026-08-01', descricao: 'Farmácia', categoria: 'Saúde', conta: 'Cartão', valor: 120 },
      { num: 5, tipo: 'entrada', data: '2026-08-20', descricao: 'Ajuste', categoria: 'Extra', conta: 'Pix', valor: 12 }
    ]
  }
};
// cópia limpa do fixture, para restaurar depois de mexer nele nos testes
const FIXTURE = JSON.parse(JSON.stringify(SUPABASE));

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
let abertaCom = null;          // id passado para SpreadsheetApp.openById
let propriedades = {};         // Propriedades do script simuladas
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

const cell = (aba, a1) => {
  const sh = ss.getSheetByName(aba);
  assert.ok(sh, 'aba não encontrada: ' + aba);
  return sh.getRange(a1).getValues()[0][0];
};
const YMD = (d) => d instanceof Date
  ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  : d;
// valores criados dentro do contexto vm têm protótipos de outro realm,
// então a comparação profunda é feita via JSON
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// ------------------------------------------------- destino da migração
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
assert.strictEqual(ctx.migNomeAba('Agosto', {}), 'Agosto');   // id por nome (banco atual)
assert.strictEqual(ctx.migNomeAba('2026-08', { '08': { '2026': 1 } }), 'Agosto');
assert.strictEqual(ctx.migNomeAba('2026-08', { '08': { '2025': 1, '2026': 1 } }), 'Agosto 2026');
assert.strictEqual(ctx.migNomeAba('2026-01', {}), 'Janeiro');
assert.strictEqual(ctx.migNomeAba('2026-13', {}), '2026-13'); // não é mês → usa o id cru

eq(ctx.migPartesMes('2026-8'), { ano: '2026', mes: '08', numero: 8 });
eq(ctx.migPartesMes('Agosto 2026'), { ano: '2026', mes: '08', numero: 8 });
eq(ctx.migPartesMes('Agosto'), { ano: null, mes: '08', numero: 8 });
eq(ctx.migPartesMes('ago/2026'), { ano: '2026', mes: '08', numero: 8 });
eq(ctx.migPartesMes('março'), { ano: null, mes: '03', numero: 3 });
assert.strictEqual(ctx.migPartesMes('2026-13'), null);
assert.strictEqual(ctx.migPartesMes('Salário'), null);
assert.strictEqual(ctx.migNumeroMes('dez'), 12);
assert.strictEqual(ctx.migNumeroMes('qualquer'), null);
assert.strictEqual(ctx.migChaveMes('Agosto 2026'), '2026-08');
assert.strictEqual(ctx.migChaveMes('Agosto'), '08');

// resolução do filtro contra os meses que existem no banco
const bancoAtual = ['Agosto', 'Setembro'];
eq(ctx.migResolverMeses(bancoAtual, 'Agosto').ids, ['Agosto']);
eq(ctx.migResolverMeses(bancoAtual, 'agosto 2026').ids, ['Agosto']); // banco sem ano
eq(ctx.migResolverMeses(bancoAtual, 'set').ids, ['Setembro']);
eq(ctx.migResolverMeses(bancoAtual, '').ids, bancoAtual);            // sem filtro = todos
assert.ok(ctx.migResolverMeses(bancoAtual, 'Outubro').erro);
assert.ok(/Meses disponíveis: Agosto, Setembro/.test(ctx.migResolverMeses(bancoAtual, 'Outubro').erro));
assert.ok(/tabela meses está vazia/.test(ctx.migResolverMeses([], 'Agosto').erro));

const doisAnos = ['2025-08', '2026-08'];
eq(ctx.migResolverMeses(doisAnos, '2026-08').ids, ['2026-08']);
assert.ok(/mais de um mês/.test(ctx.migResolverMeses(doisAnos, 'Agosto').erro)); // precisa do ano

assert.strictEqual(ctx.migValor(12.5), 12.5);
assert.strictEqual(ctx.migValor('12.50'), 12.5);
assert.strictEqual(ctx.migValor('abc'), 0);
assert.strictEqual(ctx.migTexto('  Mercado  ', 120), 'Mercado');
assert.strictEqual(ctx.migTexto('x'.repeat(130), 120).length, 120);
assert.strictEqual(ctx.migBRL(1234.5), 'R$ 1.234,50');
assert.strictEqual(ctx.migBRL(-450), 'R$ -450,00');
assert.strictEqual(YMD(ctx.migData('2026-08-05')), '2026-08-05');
assert.strictEqual(ctx.migData(''), null);
assert.strictEqual(ctx.migData(null), null);
assert.strictEqual(ctx.migSoma([{ valor: 1.5 }, { valor: '2.25' }]), 3.75);

// ------------------------------------------------- migração completa (tudo)
requisicoes.length = 0;
const res = ctx.migrarDoSupabase();
assert.strictEqual(res.ok, true, 'esperava ok=true: ' + JSON.stringify(res.erros));
assert.strictEqual(res.erros.length, 0);
assert.strictEqual(res.planilha, 'Planilha de teste');
assert.strictEqual(abertaCom, PLANILHA_DESTINO);
eq(ss.getSheets().map((s) => s.getName()), ['Agosto 2025', 'Julho', 'Agosto 2026']);

// 2026-08 → 3 entradas (A7:A9) e 2 saídas (G7:G8), ordenadas por data e num
assert.strictEqual(YMD(cell('Agosto 2026', 'A7')), '2026-08-05');
assert.strictEqual(cell('Agosto 2026', 'B7'), 'Salário');
assert.strictEqual(cell('Agosto 2026', 'C7'), 'Salário');
assert.strictEqual(cell('Agosto 2026', 'D7'), 'Banco do Brasil');
assert.strictEqual(cell('Agosto 2026', 'E7'), 2500);
assert.strictEqual(cell('Agosto 2026', 'B8'), 'Reembolso');  // mesma data, num menor primeiro
assert.strictEqual(cell('Agosto 2026', 'B9'), 'Ajuste');
assert.strictEqual(YMD(cell('Agosto 2026', 'A9')), '2026-08-20');

assert.strictEqual(YMD(cell('Agosto 2026', 'G7')), '2026-08-01');
assert.strictEqual(cell('Agosto 2026', 'H7'), 'Supermercado'); // num 2 antes do num 4
assert.strictEqual(cell('Agosto 2026', 'H8'), 'Farmácia');
assert.strictEqual(cell('Agosto 2026', 'K8'), 120);
assert.strictEqual(YMD(cell('Agosto 2026', 'G8')), '2026-08-01');
assert.strictEqual(cell('Agosto 2026', 'A10'), null);          // nada sobrando
assert.strictEqual(cell('Agosto 2026', 'G9'), null);

// cabeçalho, coluna separadora e fórmulas
assert.strictEqual(cell('Agosto 2026', 'A5'), 'ENTRADAS');
assert.strictEqual(cell('Agosto 2026', 'G5'), 'SAÍDAS');
assert.strictEqual(cell('Agosto 2026', 'A6'), 'Data');
assert.strictEqual(cell('Agosto 2026', 'K6'), 'Valor');
assert.strictEqual(cell('Agosto 2026', 'F7'), null);           // coluna F é separadora
assert.strictEqual(cell('Agosto 2026', 'C4'), '=SUM(E7:E100)');
assert.strictEqual(cell('Agosto 2026', 'I4'), '=SUM(K7:K100)');
assert.strictEqual(cell('Agosto 2026', 'C1'), '=SUM(C4-I4)');
assert.strictEqual(cell('Agosto 2026', 'A1'), 'BALANÇO');

// totais do relatório
const ago = res.meses.find((m) => m.mes === '2026-08');
assert.strictEqual(ago.aba, 'Agosto 2026');
assert.strictEqual(ago.entradas, 3);
assert.strictEqual(ago.saidas, 2);
assert.strictEqual(ago.totalEntradas, 2592.5);
assert.strictEqual(ago.totalSaidas, 620);
assert.strictEqual(ago.balanco, 1972.5);

// anos diferentes → abas diferentes (não mistura 2025 com 2026)
assert.strictEqual(YMD(cell('Agosto 2025', 'A7')), '2025-08-10');
assert.strictEqual(cell('Agosto 2025', 'B7'), 'Freela');
assert.strictEqual(cell('Agosto 2025', 'G7'), null);
assert.strictEqual(cell('Julho', 'H7'), 'Aluguel');
assert.strictEqual(cell('Julho', 'K7'), 1200);

// ------------------------------------------------ idempotência (rodar 2x)
const antes = ss.getSheetByName('Agosto 2026').getLastRow();
assert.strictEqual(antes, 9);
ctx.migrarDoSupabase();
assert.strictEqual(ss.getSheetByName('Agosto 2026').getLastRow(), 9, 'não deve duplicar linhas');
assert.strictEqual(cell('Agosto 2026', 'B7'), 'Salário');

// a limpeza também remove lançamentos que saíram do banco
const shAgo = ss.getSheetByName('Agosto 2026');
shAgo.getRange('B10').setValue('lançamento antigo');
assert.strictEqual(shAgo.getLastRow(), 10);
ctx.migrarDoSupabase();
assert.strictEqual(shAgo.getLastRow(), 9, 'linha órfã na planilha deve ser removida');

// ------------------------------------------------------- filtro de um mês
ss._abas.delete('Agosto 2025');
const soUm = ctx.migrarDoSupabase('2026-07');
assert.strictEqual(soUm.meses.length, 1);
assert.strictEqual(soUm.meses[0].mes, '2026-07');
assert.strictEqual(soUm.meses[0].aba, 'Julho');
assert.strictEqual(ss.getSheetByName('Agosto 2025'), null, 'não deve recriar as outras abas');

// --------------------------------------------- mês com muitas linhas (>93)
// 105 linhas estouram o range original das fórmulas (=SUM(E7:E100))
const muitas = [];
for (let i = 1; i <= 105; i++) {
  muitas.push({ num: i, tipo: 'entrada',
    data: '2026-06-' + String((i % 28) + 1).padStart(2, '0'),
    descricao: 'Lançamento ' + i, categoria: 'Geral', conta: 'Banco', valor: i });
}
SUPABASE.meses.push('2026-06');
SUPABASE.lancamentos['2026-06'] = muitas;
ctx.migrarDoSupabase('2026-06');

// mesma ordenação do script: data, depois num
const ordenadas = muitas.slice().sort((a, b) => {
  if (a.data !== b.data) return a.data < b.data ? -1 : 1;
  return a.num - b.num;
});
const shJun = ss.getSheetByName('Junho');
assert.ok(shJun, 'aba Junho não criada');
assert.strictEqual(shJun.getLastRow(), 111);            // 105 linhas a partir da 7
assert.strictEqual(cell('Junho', 'B7'), ordenadas[0].descricao);
assert.strictEqual(cell('Junho', 'E7'), ordenadas[0].valor);
assert.strictEqual(YMD(cell('Junho', 'A7')), ordenadas[0].data);
assert.strictEqual(cell('Junho', 'B111'), ordenadas[104].descricao);
assert.strictEqual(cell('Junho', 'E111'), ordenadas[104].valor);
assert.strictEqual(cell('Junho', 'C4'), '=SUM(E7:E111)', 'fórmula deve acompanhar as linhas');
assert.strictEqual(cell('Junho', 'I4'), '=SUM(K7:K111)');
assert.strictEqual(cell('Junho', 'G7'), null);          // mês só tem entradas

// mês sem a coluna `num` (banco antigo) continua funcionando
SUPABASE.meses.push('2026-04');
SUPABASE.lancamentos['2026-04'] = [
  { tipo: 'saida', data: '2026-04-02', descricao: 'B', categoria: '', conta: '', valor: 2 },
  { tipo: 'saida', data: '2026-04-02', descricao: 'A', categoria: '', conta: '', valor: 1 }
];
ctx.migrarDoSupabase('2026-04');
assert.strictEqual(cell('Abril', 'H7'), 'A');  // sem num, cai na ordem alfabética
assert.strictEqual(cell('Abril', 'H8'), 'B');

// ------------------------------------------------ erros do Supabase (401)
falhaHttp = { codigo: 401, corpo: JSON.stringify({ message: 'Invalid API key' }) };
// a listagem dos meses acontece antes de tudo → erro propagado
assert.throws(() => ctx.migrarDoSupabase(), /Supabase HTTP 401 — Invalid API key/);
assert.throws(() => ctx.migrarDoSupabase('2026-08'), /Supabase HTTP 401 — Invalid API key/);
assert.throws(() => ctx.testarSupabase(), /Supabase HTTP 401 — Invalid API key/);

// falha só ao ler os lançamentos: é coletada por mês, sem derrubar os outros
falhaHttp = { tabela: 'lancamentos', codigo: 500, corpo: JSON.stringify({ message: 'boom' }) };
const comErro = ctx.migrarDoSupabase();
assert.strictEqual(comErro.ok, false);
assert.strictEqual(comErro.meses.length, 0);
assert.strictEqual(comErro.erros.length, SUPABASE.meses.length);
assert.ok(/Supabase HTTP 500 — boom/.test(comErro.erros[0]), comErro.erros[0]);
assert.ok(/^2025-08: /.test(comErro.erros[0]), comErro.erros[0]);
falhaHttp = null;

// --------------------------------------------------- paginação (>1000 linhas)
const paginado = [];
for (let i = 1; i <= 1500; i++) {
  paginado.push({ num: i, tipo: 'entrada', data: '2026-05-01', descricao: 'P' + i, categoria: '', conta: '', valor: 1 });
}
SUPABASE.meses.push('2026-05');
SUPABASE.lancamentos['2026-05'] = paginado;
const antesPag = requisicoes.length;
ctx.migrarDoSupabase('2026-05');
const paginas = requisicoes.slice(antesPag).filter((r) => /lancamentos/.test(r.url));
assert.strictEqual(paginas.length, 2, 'deveria paginar em 2 requisições (1000 + 500)');
assert.strictEqual(paginas[0].opts.headers.Range, '0-999');
assert.strictEqual(paginas[1].opts.headers.Range, '1000-1999');
assert.strictEqual(ss.getSheetByName('Maio').getLastRow(), 1506);

// -------------------------------- ids no formato real do banco (nomes de mês)
// em produção meses.id = 'Agosto' / 'Setembro' / 'Outubro'
SUPABASE.meses = ['Agosto', 'Setembro'];
SUPABASE.lancamentos = {
  Agosto: [
    { num: 1, tipo: 'entrada', data: '2026-08-05', descricao: 'Salário', categoria: 'Salário', conta: 'Banco', valor: 1000 },
    { num: 2, tipo: 'saida', data: '2026-08-06', descricao: 'Mercado', categoria: 'Alimentação', conta: 'Cartão', valor: 200 }
  ],
  Setembro: [
    { num: 1, tipo: 'saida', data: '2026-09-02', descricao: 'Aluguel', categoria: 'Moradia', conta: 'Banco', valor: 1500 }
  ]
};
const rNomes = ctx.migrarDoSupabase();
assert.strictEqual(rNomes.ok, true, JSON.stringify(rNomes.erros));
eq(rNomes.meses.map((m) => m.aba), ['Agosto', 'Setembro']);
eq(rNomes.meses.map((m) => m.mes), ['Agosto', 'Setembro']);
assert.strictEqual(rNomes.meses[0].balanco, 800);
assert.strictEqual(YMD(cell('Agosto', 'A7')), '2026-08-05');
assert.strictEqual(cell('Agosto', 'E7'), 1000);
assert.strictEqual(cell('Agosto', 'H7'), 'Mercado');
assert.strictEqual(cell('Setembro', 'H7'), 'Aluguel');
assert.strictEqual(cell('Setembro', 'A7'), null); // mês só com saída

// filtro pelo nome e por "nome + ano" (o banco não guarda o ano)
assert.strictEqual(ctx.migrarDoSupabase('Setembro').meses[0].aba, 'Setembro');
assert.strictEqual(ctx.migrarDoSupabase('setembro 2026').meses[0].mes, 'Setembro');
assert.strictEqual(ctx.migrarDoSupabase('ago').meses[0].mes, 'Agosto');
assert.throws(() => ctx.migrarDoSupabase('Outubro'),
  /Nenhum mês do banco corresponde a "Outubro"\. Meses disponíveis: Agosto, Setembro\./);
assert.throws(() => ctx.migrarDoSupabase('2026-13'), /Nenhum mês do banco corresponde a "2026-13"/);

// -------------------------------- ids misturados (nome + AAAA-MM) na mesma tabela
SUPABASE.meses = ['Agosto', '2026-08'];
SUPABASE.lancamentos['2026-08'] = SUPABASE.lancamentos['Agosto'];
const mistos = ctx.migrarDoSupabase();
assert.strictEqual(mistos.ok, true, JSON.stringify(mistos.erros));
eq(mistos.meses.map((m) => m.aba), ['Agosto', 'Agosto 2026']); // abas distintas, sem colisão
assert.strictEqual(cell('Agosto', 'E7'), 1000);
assert.strictEqual(cell('Agosto 2026', 'E7'), 1000);

// dois ids que cairiam na MESMA aba → erro explícito, em vez de sobrescrever
SUPABASE.meses = ['2026-08', 'Agosto 2026'];
const colisao = ctx.migrarDoSupabase();
assert.strictEqual(colisao.ok, false);
assert.strictEqual(colisao.meses.length, 1);            // a 1ª passa
assert.strictEqual(colisao.erros.length, 1);
assert.ok(/seria usada também por "2026-08"/.test(colisao.erros[0]), colisao.erros[0]);

// meses com o mesmo mês em anos diferentes → abas com sufixo de ano
SUPABASE.meses = FIXTURE.meses.slice();
SUPABASE.lancamentos = JSON.parse(JSON.stringify(FIXTURE.lancamentos));
ctx.migrarDoSupabase();                  // regrava 'Agosto 2025', 'Julho' e 'Agosto 2026'
SUPABASE.meses = ['Agosto', 'Setembro']; // volta ao formato "real" do banco

// -------------------------------------- testarSupabase()
const t = ctx.testarSupabase();
assert.strictEqual(t.ok, true);
eq(t.meses, ['Agosto', 'Setembro']);

// ------------------------------- leitura das linhas pelo backend antigo
// (a aba migrada tem de continuar legível pelo Code.gs)
const codeGs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
vm.runInContext(codeGs, ctx); // agora no mesmo contexto: Code.gs + MigrarSupabase.gs
assert.strictEqual(typeof ctx.acaoLancamentos, 'function');
const lidos = ctx.acaoLancamentos(ss, 'Agosto 2026');
assert.strictEqual(lidos.ok, true);
assert.strictEqual(lidos.existe, true);
assert.strictEqual(lidos.entradas.length, 3);
assert.strictEqual(lidos.saidas.length, 2);
assert.strictEqual(lidos.entradas[0].descricao, 'Salário');
assert.strictEqual(lidos.totais.entradas, 2592.5);
assert.strictEqual(lidos.totais.saidas, 620);
assert.strictEqual(lidos.totais.balanco, 1972.5);
eq(ctx.acaoMeses(ss).meses, ss.getSheets().map((s) => s.getName()));

// -------------------------------------- ação 'migrar' no roteador HTTP
abertaCom = null;
const viaHttp = ctx.processar({ action: 'migrar', key: ctx.APP_KEY, mes: 'Setembro' });
assert.strictEqual(viaHttp.ok, true);
assert.strictEqual(viaHttp.meses[0].aba, 'Setembro');
assert.strictEqual(ctx.processar({ action: 'migrar', key: 'errada' }).erro, 'Chave de acesso inválida.');
// mesmo chamado pelo Code.gs (que abre a planilha dele), a migração escreve no
// destino configurado em MIG_SPREADSHEET_ID
assert.strictEqual(abertaCom, PLANILHA_DESTINO, 'a migração não deve escrever na planilha do Code.gs');

console.log('✅ scripts/test-migracao.js — todos os testes passaram');
