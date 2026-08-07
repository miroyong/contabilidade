/*******************************************************************************
 * CONTROLE FINANCEIRO — Apps Script (backend da planilha)
 *
 * COMO INSTALAR:
 * 1. Abra a planilha: https://docs.google.com/spreadsheets/d/1jp7hBdUXn5ZmgxVM8UwZFqLB7B4mT8Irmm3EYGwM9Ns
 * 2. Extensões → Apps Script
 * 3. Apague o conteúdo do arquivo e cole TODO este código
 * 4. Implantar → Nova implantação → Aplicativo da web
 *    - Descrição: "controle financeiro"
 *    - Executar como: Eu
 *    - Quem tem acesso: Qualquer pessoa
 * 5. Clique em Implantar, autorize, e copie a URL gerada
 *    (termina em /exec) para o arquivo config.js do site.
 *
 * IMPORTANTE: depois de qualquer mudança neste código, faça
 * Implantar → Gerenciar implantações → ✏️ → Nova versão.
 ******************************************************************************/

var SPREADSHEET_ID = '1jp7hBdUXn5ZmgxVM8UwZFqLB7B4mT8Irmm3EYGwM9Ns';
var APP_KEY = 'cf-2026-k3x9pQ7mZt'; // troque se quiser (deve ser igual ao config.js)
var LINHA_DADOS = 7;               // linha 6 = cabeçalho; lançamentos a partir da 7

// ---------------------------------------------------------------- entrada HTTP
function doGet(e) {
  return responder(processar(e.parameter || {}));
}

function doPost(e) {
  var params = {};
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    params = e.parameter || {};
  }
  return responder(processar(params));
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// -------------------------------------------------------------------- roteador
function processar(p) {
  try {
    if (!p || p.key !== APP_KEY) {
      return { ok: false, erro: 'Chave de acesso inválida.' };
    }
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    switch (p.action) {
      case 'meses':       return acaoMeses(ss);
      case 'lancamentos': return acaoLancamentos(ss, p.mes);
      case 'adicionar':   return acaoAdicionar(ss, p);
      case 'atualizar':   return acaoAtualizar(ss, p);
      case 'excluir':     return acaoExcluir(ss, p);
      case 'novoMes':     return acaoNovoMes(ss, p.mes);
      case 'opcoes':      return acaoOpcoes(ss);
      default:            return { ok: false, erro: 'Ação desconhecida: ' + p.action };
    }
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// --------------------------------------------------------------------- ações
function acaoMeses(ss) {
  var meses = ss.getSheets().map(function (sh) { return sh.getName(); });
  var hoje = new Date();
  var nomeMes = hoje.toLocaleDateString('pt-BR', { month: 'long' });
  nomeMes = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
  return { ok: true, meses: meses, mesAtual: nomeMes };
}

function acaoLancamentos(ss, mes) {
  var sh = ss.getSheetByName(mes);
  if (!sh) {
    return { ok: true, existe: false, mes: mes, entradas: [], saidas: [], totais: zerarTotais() };
  }
  var ultima = Math.max(sh.getLastRow(), LINHA_DADOS);
  var linhas = ultima - LINHA_DADOS + 1;
  var valsEnt = sh.getRange(LINHA_DADOS, 1, linhas, 5).getValues();
  var valsSai = sh.getRange(LINHA_DADOS, 7, linhas, 5).getValues();

  var entradas = [], saidas = [];
  for (var i = 0; i < linhas; i++) {
    var le = valsEnt[i];
    if (linhaPreenchida(le)) entradas.push(montar(le, i + LINHA_DADOS));
    var ls = valsSai[i];
    if (linhaPreenchida(ls)) saidas.push(montar(ls, i + LINHA_DADOS));
  }

  var totE = entradas.reduce(function (s, l) { return s + l.valor; }, 0);
  var totS = saidas.reduce(function (s, l) { return s + l.valor; }, 0);

  return {
    ok: true, existe: true, mes: mes,
    entradas: entradas, saidas: saidas,
    totais: { entradas: totE, saidas: totS, balanco: totE - totS }
  };
}

function acaoAdicionar(ss, p) {
  var sh = ss.getSheetByName(p.mes);
  if (!sh) return { ok: false, erro: 'A aba "' + p.mes + '" não existe. Crie o mês antes.' };
  var col = (p.tipo === 'saida') ? 7 : 1;
  var linha = acharLinhaLivre(sh, col);
  var dados = [parseData(p.data), p.descricao, p.categoria, p.conta, parseValor(p.valor)];
  sh.getRange(linha, col, 1, 5).setValues([dados]);
  sh.getRange(linha, col).setNumberFormat('dd/mm');
  sh.getRange(linha, col + 4).setNumberFormat('#,##0.00');
  return { ok: true, linha: linha };
}

function acaoAtualizar(ss, p) {
  var sh = ss.getSheetByName(p.mes);
  if (!sh) return { ok: false, erro: 'A aba "' + p.mes + '" não existe.' };
  var col = (p.tipo === 'saida') ? 7 : 1;
  var linha = Number(p.linha);
  if (!linha || linha < LINHA_DADOS) return { ok: false, erro: 'Linha inválida.' };
  var dados = [parseData(p.data), p.descricao, p.categoria, p.conta, parseValor(p.valor)];
  sh.getRange(linha, col, 1, 5).setValues([dados]);
  sh.getRange(linha, col).setNumberFormat('dd/mm');
  sh.getRange(linha, col + 4).setNumberFormat('#,##0.00');
  return { ok: true, linha: linha };
}

function acaoExcluir(ss, p) {
  var sh = ss.getSheetByName(p.mes);
  if (!sh) return { ok: false, erro: 'A aba "' + p.mes + '" não existe.' };
  var col = (p.tipo === 'saida') ? 7 : 1;
  var linha = Number(p.linha);
  if (!linha || linha < LINHA_DADOS) return { ok: false, erro: 'Linha inválida.' };
  sh.getRange(linha, col, 1, 5).clearContent();
  return { ok: true };
}

function acaoNovoMes(ss, mes) {
  if (!mes) return { ok: false, erro: 'Informe o nome do mês.' };
  mes = mes.charAt(0).toUpperCase() + mes.slice(1);
  if (ss.getSheetByName(mes)) return { ok: true, criado: false, mes: mes };

  var sh = ss.insertSheet(mes);
  // títulos e fórmulas
  sh.getRange('A1').setValue('BALANÇO');
  sh.getRange('B1').setValue('POSITIVO');
  sh.getRange('C1').setFormula('=SUM(C4-I4)');
  sh.getRange('A4').setValue('TOTAL DE ENTRADAS');
  sh.getRange('C4').setFormula('=SUM(E7:E100)');
  sh.getRange('G4').setValue('TOTAL DE SAÍDAS');
  sh.getRange('I4').setFormula('=SUM(K7:K100)');
  sh.getRange('A5').setValue('ENTRADAS');
  sh.getRange('G5').setValue('SAÍDAS');
  sh.getRange('A5:E5').merge();
  sh.getRange('G5:K5').merge();
  // cabeçalhos
  var cab = [['Data', 'Descrição', 'Categoria', 'Conta', 'Valor']];
  sh.getRange('A6:E6').setValues(cab);
  sh.getRange('G6:K6').setValues(cab);
  // formatação
  sh.getRange('A1:C1').setFontWeight('bold');
  sh.getRange('A4:C4').setFontWeight('bold');
  sh.getRange('G4:I4').setFontWeight('bold');
  sh.getRange('A5:E5').setFontWeight('bold').setBackground('#e3f2e6');
  sh.getRange('G5:K5').setFontWeight('bold').setBackground('#fdeaea');
  sh.getRange('A6:K6').setFontWeight('bold').setBackground('#f2f2f2');
  sh.getRange('E7:E100').setNumberFormat('#,##0.00');
  sh.getRange('K7:K100').setNumberFormat('#,##0.00');
  sh.getRange('A7:A100').setNumberFormat('dd/mm');
  sh.getRange('G7:G100').setNumberFormat('dd/mm');
  sh.setColumnWidths(1, 5, 120);
  sh.setColumnWidth(6, 20);
  sh.setColumnWidths(7, 5, 120);
  return { ok: true, criado: true, mes: mes };
}

function acaoOpcoes(ss) {
  var cats = {}, contas = {};
  ss.getSheets().forEach(function (sh) {
    var ultima = Math.max(sh.getLastRow(), LINHA_DADOS);
    var vals = sh.getRange(LINHA_DADOS, 1, ultima - LINHA_DADOS + 1, 10).getValues();
    vals.forEach(function (l) {
      if (l[2]) cats[String(l[2]).trim()] = true;
      if (l[3]) contas[String(l[3]).trim()] = true;
      if (l[8]) cats[String(l[8]).trim()] = true;
      if (l[9]) contas[String(l[9]).trim()] = true;
    });
  });
  return {
    ok: true,
    categorias: Object.keys(cats).sort(),
    contas: Object.keys(contas).sort()
  };
}

// ------------------------------------------------------------------- utilitários
function zerarTotais() {
  return { entradas: 0, saidas: 0, balanco: 0 };
}

function montar(v, linha) {
  return {
    linha: linha,
    data: fmtData(v[0]),
    descricao: String(v[1] == null ? '' : v[1]).trim(),
    categoria: String(v[2] == null ? '' : v[2]).trim(),
    conta: String(v[3] == null ? '' : v[3]).trim(),
    valor: Number(v[4]) || 0
  };
}

function linhaPreenchida(v) {
  for (var i = 0; i < 5; i++) {
    if (v[i] != null && String(v[i]).trim() !== '') return true;
  }
  return false;
}

function acharLinhaLivre(sh, col) {
  var ultima = Math.max(sh.getLastRow(), LINHA_DADOS);
  var vals = sh.getRange(LINHA_DADOS, col, ultima - LINHA_DADOS + 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    var cel = vals[i][0];
    if (cel == null || String(cel).trim() === '') return i + LINHA_DADOS;
  }
  return ultima + 1;
}

function parseData(s) {
  if (s instanceof Date) return s;
  if (!s) return new Date();
  var m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  var d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

function fmtData(d) {
  if (!d) return '';
  if (d instanceof Date && !isNaN(d.getTime())) {
    var dd = ('0' + d.getDate()).slice(-2);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  return String(d);
}

function parseValor(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).replace(/R\$/g, '').replace(/\s/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
