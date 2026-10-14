/*******************************************************************************
 * CONTROLE FINANCEIRO — MIGRAÇÃO SUPABASE ➜ GOOGLE SHEETS
 *
 * Copia as tabelas `meses` e `lancamentos` do Supabase (REST/PostgREST, a mesma
 * API que o site usa) para DESTA planilha:
 *   https://docs.google.com/spreadsheets/d/1WTL4V2AGx_jj84_rKU3Y18tGXgeN4dT9-ciYc0an_dA
 *
 * É um ESPELHO de leitura: o Supabase é a fonte da verdade. A cada execução o
 * bloco de lançamentos da aba é limpo e regravado, então edições feitas na
 * planilha são sobrescritas na próxima migração.
 *
 * COMO INSTALAR (uma vez):
 *   1. Abra a planilha de destino e vá em Extensões → Apps Script.
 *   2. ➕ (ao lado de "Arquivos") → Script → nome: MigrarSupabase
 *   3. Apague o conteúdo e cole TODO este arquivo. Salve (💾).
 *   4. Recarregue a planilha: aparece o menu "Financeiro".
 *   5. Financeiro → Migrar tudo do Supabase.
 *      Na 1ª execução o Google pede autorização — inclusive "conectar-se a um
 *      serviço externo", que é o que permite ler o Supabase.
 *      Também dá para rodar pelo editor: escolha `migrarDoSupabase` e clique ▶.
 *
 * MENU "Financeiro":
 *   • Migrar tudo do Supabase → cria/atualiza uma aba por mês
 *   • Migrar um mês…          → só um mês ("Agosto", "2026-08" ou "Agosto 2026")
 *   • Testar conexão          → confere URL/chave e lista os meses do banco
 *
 * LAYOUT GRAVADO (idêntico ao apps-script/Code.gs):
 *   • linha 6 = cabeçalho · lançamentos a partir da linha 7
 *   • A:E = ENTRADAS (Data, Descrição, Categoria, Conta, Valor)
 *   • G:K = SAÍDAS   (mesma ordem) · coluna F = separador
 *   • C4 = total de entradas, I4 = total de saídas, C1 = balanço (fórmulas)
 *   • Nome da aba: "Agosto" (o id usado no banco); se o mesmo mês existir em
 *     mais de um ano, vira "Agosto 2025"/"Agosto 2026" para não misturar.
 *   A marca "✓" de pago/enviado vem junto da própria Descrição.
 *   Fórmulas e formatos são esticados quando o mês passa de 93 linhas (o
 *   range original do Code.gs ia só até a linha 100), então o total nunca
 *   fica "cortado".
 *
 * PLANILHA DE DESTINO: definida em MIG_SPREADSHEET_ID. Para trocar sem mexer
 * no código, salve uma Propriedade do script (Configurações do projeto →
 * Propriedades do script):
 *     SPREADSHEET_ID = <id da planilha>
 * Precedência: Propriedade do script → MIG_SPREADSHEET_ID → planilha ativa
 * (quando o script está vinculado a uma planilha).
 *
 * SEGURANÇA: a chave abaixo é a "anon", que já é pública (está no config.js e
 * protegida pelo RLS). Para não deixá-la no código, salve as Propriedades:
 *     SUPABASE_URL = https://SEU_PROJETO.supabase.co
 *     SUPABASE_ANON_KEY = sua-chave
 * (as propriedades têm prioridade sobre os valores abaixo)
 ******************************************************************************/

// ------------------------------------------------------------- configuração
// Linha em que começa a lista de lançamentos (linha 6 = cabeçalho).
// Reaproveita a constante do Code.gs quando ele estiver no mesmo projeto.
var MIG_LINHA_DADOS = (typeof LINHA_DADOS !== 'undefined' && LINHA_DADOS) ? LINHA_DADOS : 7;

// Planilha de destino da migração (NÃO herda a planilha do Code.gs).
var MIG_SPREADSHEET_ID = '1WTL4V2AGx_jj84_rKU3Y18tGXgeN4dT9-ciYc0an_dA';

// Chave do app (a mesma do Code.gs/config.js), para o arquivo ficar
// autossuficiente. Quem valida a chave no modo URL
// (.../exec?key=...&action=migrar) é o Code.gs, em `processar`.
var MIG_APP_KEY = (typeof APP_KEY !== 'undefined' && APP_KEY) ? APP_KEY : 'cf-2026-k3x9pQ7mZt';

// Credenciais do Supabase (as mesmas do config.js).
var MIG_SUPABASE_URL = 'https://krdzqceedqanhiqmlijd.supabase.co';
var MIG_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyZHpxY2VlZHFhbmhpcW1saWpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MDE2NjAsImV4cCI6MjEwMzk3NzY2MH0.ar_66WVg7eH_61yX0FKOx6cocYUZCjQXfbtWT6nqcsY';

// Nome das abas criadas:
//   'auto' → "Agosto" quando o mês existe em um único ano no banco; se o mesmo
//            mês aparecer em 2+ anos, acrescenta o ano ("Agosto 2025"/"Agosto 2026")
//   'id'   → o id do banco, como está ("Agosto", "2026-08", …)
var MIG_FORMATO_ABA = 'auto';

var MIG_FIM_FORMATOS = 100;   // formatos/fórmulas pré-aplicados até esta linha
var MIG_TAM_PAGINA = 1000;    // registros por página na leitura do Supabase
var MIG_MAX_REGISTROS = 20000;// trava de segurança
var MIG_MAX_TEXTO = 120;      // mesmo limite das colunas no Postgres

// Nomes de mês (1..12) e abreviações aceitas no prompt.
var MIG_MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
var MIG_MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// --------------------------------------------------------------- menu (UI)
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Financeiro')
      .addItem('⬇️  Migrar tudo do Supabase', 'migrarDoSupabaseUI')
      .addItem('📅  Migrar um mês…', 'migrarMesPrompt')
      .addItem('🔌  Testar conexão com o Supabase', 'testarSupabaseUI')
      .addToUi();
  } catch (err) {
    // sem UI (execução via gatilho/API) — ignora
  }
}

function migrarDoSupabaseUI() {
  try {
    migAlerta(migResumoTexto(migrarDoSupabase()));
  } catch (err) {
    migAlerta('❌ ' + migErro(err));
  }
}

function migrarMesPrompt() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Migrar um mês',
    'Digite o mês (ex.: Agosto, 2026-08 ou Agosto 2026):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var texto = migTexto(resp.getResponseText(), 40);
  if (!texto) return;
  try {
    // o texto é resolvido contra os meses que existem no banco
    migAlerta(migResumoTexto(migrarDoSupabase(texto)));
  } catch (err) {
    migAlerta('❌ ' + migErro(err));
  }
}

function testarSupabaseUI() {
  try {
    var r = testarSupabase();
    migAlerta(r.meses.length
      ? '✅ Conexão OK.\n\nMeses no Supabase (' + r.meses.length + '):\n' + r.meses.join(', ')
      : '✅ Conexão OK, mas nenhum mês foi cadastrado no Supabase ainda.');
  } catch (err) {
    migAlerta('❌ ' + migErro(err));
  }
}

// ------------------------------------------------------------ API principal
/**
 * Migra o Supabase para a planilha de destino.
 * @param {string=} mesFiltro mês a migrar ("Agosto", "2026-08", "Agosto 2026"…).
 *        Vazio/omitido = todos os meses.
 * @return {{ok:boolean, meses:Array, erros:Array}}
 */
function migrarDoSupabase(mesFiltro) {
  var cfg = migCfg();
  if (!cfg.url || !cfg.key) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY (Propriedades do script).');
  }
  var ss = migPlanilha();

  var todos = migListarMeses(cfg);
  var ids;
  if (migTexto(mesFiltro, 40) === '') {
    ids = todos;
    if (!ids.length) {
      Logger.log('Migração: nenhum mês encontrado no Supabase.');
      return { ok: true, meses: [], erros: [] };
    }
  } else {
    var escolha = migResolverMeses(todos, mesFiltro);
    if (escolha.erro) throw new Error(escolha.erro);
    ids = escolha.ids;
  }

  var anos = migMapaAnos(ids);
  var meses = [], erros = [];
  var donoDaAba = {}; // nome da aba → id que a usa (evita uma sobrescrever a outra)

  ids.forEach(function (id) {
    try {
      var nome = migNomeAba(id, anos);
      if (donoDaAba[nome] && donoDaAba[nome] !== id) {
        throw new Error('a aba "' + nome + '" seria usada também por "' + donoDaAba[nome] +
          '" — ajuste MIG_FORMATO_ABA para "id" ou padronize os ids no banco.');
      }
      var rows = migBuscarLancamentos(cfg, id);
      var sh = migGarantirAba(ss, nome);
      donoDaAba[nome] = id;
      var r = migEscreverAba(sh, migFiltrar(rows, 'entrada'), migFiltrar(rows, 'saida'));
      meses.push({
        mes: id, aba: nome, entradas: r.entradas, saidas: r.saidas,
        totalEntradas: r.totalEntradas, totalSaidas: r.totalSaidas,
        balanco: r.totalEntradas - r.totalSaidas
      });
    } catch (err) {
      erros.push(id + ': ' + migErro(err));
    }
  });

  var resumo = { ok: erros.length === 0, planilha: migNomePlanilha(ss), meses: meses, erros: erros };
  Logger.log(migResumoTexto(resumo));
  return resumo;
}

/** Só testa URL/chave e lista os meses do banco. */
function testarSupabase() {
  var ids = migListarMeses(migCfg());
  Logger.log('Supabase OK — ' + (ids.length ? ids.length + ' mês(es): ' + ids.join(', ') : 'nenhum mês cadastrado.'));
  return { ok: true, meses: ids };
}

/** Abre a planilha de destino (Propriedade SPREADSHEET_ID > constante > ativa). */
function migPlanilha() {
  var id = migTexto(migProp('SPREADSHEET_ID'), 120);
  if (id) return SpreadsheetApp.openById(id);
  if (MIG_SPREADSHEET_ID) return SpreadsheetApp.openById(migTexto(MIG_SPREADSHEET_ID, 120));
  return SpreadsheetApp.getActiveSpreadsheet();
}

function migNomePlanilha(ss) {
  try { return ss.getName(); } catch (err) { return MIG_SPREADSHEET_ID; }
}

/** Lê uma Propriedade do script (null quando não existe ou não há serviço). */
function migProp(nome) {
  try {
    if (typeof PropertiesService === 'undefined') return null;
    var v = PropertiesService.getScriptProperties().getProperty(nome);
    return (v == null || v === '') ? null : String(v);
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------------- leitura REST
function migCfg() {
  var url = migProp('SUPABASE_URL') || MIG_SUPABASE_URL;
  var key = migProp('SUPABASE_ANON_KEY') || MIG_SUPABASE_ANON_KEY;
  return { url: String(url || '').replace(/\/+$/, ''), key: String(key || '') };
}

/** Meses cadastrados no banco (na ordem devolvida pelo Supabase). */
function migListarMeses(cfg) {
  var rows = migBuscarTudo(cfg, 'meses', 'select=id&order=id.asc');
  var ids = [], vistos = {};
  rows.forEach(function (r) {
    var id = r && r.id != null ? String(r.id).trim() : '';
    if (!id || vistos[id]) return;
    vistos[id] = 1;
    ids.push(id);
  });
  return ids;
}

/** Lançamentos de um mês (ordem estável: data, depois num). */
function migBuscarLancamentos(cfg, mesId) {
  var q = 'select=num,tipo,data,descricao,categoria,conta,valor' +
    '&mes_id=eq.' + encodeURIComponent(mesId) +
    '&order=data.asc,num.asc';
  return migBuscarTudo(cfg, 'lancamentos', q);
}

/**
 * GET no PostgREST com paginação por header Range.
 * (o Supabase devolve no máximo ~1000 linhas por requisição)
 */
function migBuscarTudo(cfg, path, query) {
  var out = [], inicio = 0;
  while (true) {
    var fim = inicio + MIG_TAM_PAGINA - 1;
    var pagina = migGet(cfg, path, query, inicio + '-' + fim);
    if (!pagina || !pagina.length) break;
    out = out.concat(pagina);
    if (pagina.length < MIG_TAM_PAGINA) break;
    if (out.length >= MIG_MAX_REGISTROS) {
      throw new Error('Mais de ' + MIG_MAX_REGISTROS + ' registros em ' + path +
        ' — aumente MIG_MAX_REGISTROS se for intencional.');
    }
    inicio += MIG_TAM_PAGINA;
  }
  return out;
}

function migGet(cfg, path, query, range) {
  var url = cfg.url + '/rest/v1/' + path + (query ? '?' + query : '');
  var headers = {
    'apikey': cfg.key,
    'Authorization': 'Bearer ' + cfg.key,
    'Accept': 'application/json'
  };
  if (range) headers['Range'] = range;

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true
  });
  var codigo = resp.getResponseCode();
  var texto = resp.getContentText();
  if (codigo < 200 || codigo >= 300) {
    throw new Error('Supabase HTTP ' + codigo + ' — ' + migResumoErro(texto));
  }
  try {
    var json = JSON.parse(texto);
    return Object.prototype.toString.call(json) === '[object Array]' ? json : [];
  } catch (err) {
    return [];
  }
}

/** Mensagem curta e legível a partir do corpo de erro do PostgREST. */
function migResumoErro(texto) {
  var t = String(texto == null ? '' : texto).trim();
  if (!t) return '(resposta vazia)';
  try {
    var j = JSON.parse(t);
    var msg = j.message || j.error_description || j.error || j.details || j.hint;
    if (msg) return String(msg).slice(0, 200);
  } catch (err) {
    // não é JSON — devolve o texto cru
  }
  return t.slice(0, 200);
}

// ------------------------------------------------------------ escrita na aba
function migGarantirAba(ss, nome) {
  var sh = ss.getSheetByName(nome);
  return sh ? sh : migCriarAba(ss, nome);
}

/** Cria a aba do mês com o mesmo layout/formatação do Code.gs. */
function migCriarAba(ss, nome) {
  var sh = ss.insertSheet(nome);

  sh.getRange('A1').setValue('BALANÇO');
  sh.getRange('B1').setValue('POSITIVO');
  sh.getRange('C1').setFormula('=SUM(C4-I4)');
  sh.getRange('A4').setValue('TOTAL DE ENTRADAS');
  sh.getRange('C4').setFormula('=SUM(E7:E' + MIG_FIM_FORMATOS + ')');
  sh.getRange('G4').setValue('TOTAL DE SAÍDAS');
  sh.getRange('I4').setFormula('=SUM(K7:K' + MIG_FIM_FORMATOS + ')');
  sh.getRange('A5').setValue('ENTRADAS');
  sh.getRange('G5').setValue('SAÍDAS');
  sh.getRange('A5:E5').merge();
  sh.getRange('G5:K5').merge();

  var cabecalho = [['Data', 'Descrição', 'Categoria', 'Conta', 'Valor']];
  sh.getRange('A6:E6').setValues(cabecalho);
  sh.getRange('G6:K6').setValues(cabecalho);

  sh.getRange('A1:C1').setFontWeight('bold');
  sh.getRange('A4:C4').setFontWeight('bold');
  sh.getRange('G4:I4').setFontWeight('bold');
  sh.getRange('A5:E5').setFontWeight('bold').setBackground('#e3f2e6');
  sh.getRange('G5:K5').setFontWeight('bold').setBackground('#fdeaea');
  sh.getRange('A6:K6').setFontWeight('bold').setBackground('#f2f2f2');

  sh.getRange('A7:A' + MIG_FIM_FORMATOS).setNumberFormat('dd/mm');
  sh.getRange('G7:G' + MIG_FIM_FORMATOS).setNumberFormat('dd/mm');
  sh.getRange('E7:E' + MIG_FIM_FORMATOS).setNumberFormat('#,##0.00');
  sh.getRange('K7:K' + MIG_FIM_FORMATOS).setNumberFormat('#,##0.00');

  sh.setColumnWidths(1, 5, 120);
  sh.setColumnWidth(6, 20);
  sh.setColumnWidths(7, 5, 120);
  return sh;
}

/**
 * Regrava a aba: limpa A:E e G:K (linha 7 em diante), escreve as entradas e as
 * saídas e reajusta formatos/fórmulas até a última linha usada.
 */
function migEscreverAba(sh, entradas, saidas) {
  migLimparDados(sh);

  var matE = migMatriz(entradas);
  var matS = migMatriz(saidas);
  if (matE.length) sh.getRange(MIG_LINHA_DADOS, 1, matE.length, 5).setValues(matE);
  if (matS.length) sh.getRange(MIG_LINHA_DADOS, 7, matS.length, 5).setValues(matS);

  var usadas = Math.max(matE.length, matS.length, 1);
  var fim = Math.max(MIG_LINHA_DADOS + usadas - 1, MIG_FIM_FORMATOS);

  sh.getRange('A' + MIG_LINHA_DADOS + ':A' + fim).setNumberFormat('dd/mm');
  sh.getRange('G' + MIG_LINHA_DADOS + ':G' + fim).setNumberFormat('dd/mm');
  sh.getRange('E' + MIG_LINHA_DADOS + ':E' + fim).setNumberFormat('#,##0.00');
  sh.getRange('K' + MIG_LINHA_DADOS + ':K' + fim).setNumberFormat('#,##0.00');

  sh.getRange('C4').setFormula('=SUM(E' + MIG_LINHA_DADOS + ':E' + fim + ')');
  sh.getRange('I4').setFormula('=SUM(K' + MIG_LINHA_DADOS + ':K' + fim + ')');
  sh.getRange('C1').setFormula('=SUM(C4-I4)');

  return {
    entradas: matE.length, saidas: matS.length,
    totalEntradas: migSoma(entradas), totalSaidas: migSoma(saidas), ultimaLinha: fim
  };
}

function migLimparDados(sh) {
  var ultima = Math.max(sh.getLastRow(), MIG_LINHA_DADOS);
  var n = ultima - MIG_LINHA_DADOS + 1;
  sh.getRange(MIG_LINHA_DADOS, 1, n, 5).clearContent(); // A:E
  sh.getRange(MIG_LINHA_DADOS, 7, n, 5).clearContent(); // G:K
}

/** Linhas do banco → matriz de 5 colunas prontas para setValues. */
function migMatriz(rows) {
  var out = [];
  (rows || []).forEach(function (r) {
    var data = migData(r && r.data);
    if (!data) return; // sem data válida não dá para lançar
    out.push([
      data,
      migTexto(r.descricao, MIG_MAX_TEXTO),
      migTexto(r.categoria, MIG_MAX_TEXTO),
      migTexto(r.conta, MIG_MAX_TEXTO),
      migValor(r.valor)
    ]);
  });
  return out;
}

// ---------------------------------------------------------------- utilitários
function migFiltrar(rows, tipo) {
  return (rows || []).filter(function (r) { return r && r.tipo === tipo; })
    .sort(function (a, b) {
      var da = String(a.data == null ? '' : a.data);
      var db = String(b.data == null ? '' : b.data);
      if (da !== db) return da < db ? -1 : 1;
      var na = Number(a.num), nb = Number(b.num); // num = "linha" estável do banco
      if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
      var sa = String(a.descricao == null ? '' : a.descricao);
      var sb = String(b.descricao == null ? '' : b.descricao);
      if (sa !== sb) return sa < sb ? -1 : 1;
      var va = Number(a.valor) || 0, vb = Number(b.valor) || 0;
      return va === vb ? 0 : (va < vb ? -1 : 1);
    });
}

function migSoma(rows) {
  return (rows || []).reduce(function (s, r) { return s + migValor(r && r.valor); }, 0);
}

/** Mapa { '08': { '2026': 1 } } — quantos ids diferentes caem em cada mês. */
function migMapaAnos(ids) {
  var mapa = {};
  (ids || []).forEach(function (id) {
    var p = migPartesMes(id);
    if (!p) return;
    mapa[p.mes] = mapa[p.mes] || {};
    // id sem ano entra com o próprio texto, para não colidir com um id "AAAA-MM"
    mapa[p.mes][p.ano || String(id)] = 1;
  });
  return mapa;
}

/**
 * Nome da aba de um mês.
 *   'Agosto'      → "Agosto"         (id sem ano, ou só um ano no banco)
 *   '2026-08'     → "Agosto"
 *   '2026-08' com o mesmo mês em 2025 e 2026 → "Agosto 2026"
 *   id que não é mês (ex.: "Férias") → o próprio id
 */
function migNomeAba(id, anos) {
  var txt = migTexto(id, 40);
  if (MIG_FORMATO_ABA === 'id' || !txt) return txt;
  var p = migPartesMes(txt);
  if (!p) return txt;
  var nome = MIG_MESES_PT[p.numero - 1];
  var doMes = (anos || {})[p.mes] || {};
  if (Object.keys(doMes).length < 2) return nome;   // um único mês/ano → "Agosto"
  return p.ano ? nome + ' ' + p.ano : txt;          // 2+ grupos → precisa desambiguar
}

/** "Agosto" / "agosto" / "ago" → 1..12 (null se não for nome de mês). */
function migNumeroMes(texto) {
  var chave = migTexto(texto, 40).toLowerCase();
  if (!chave) return null;
  for (var i = 0; i < 12; i++) {
    if (MIG_MESES_PT[i].toLowerCase() === chave || MIG_MESES_ABREV[i] === chave) return i + 1;
  }
  return null;
}

/**
 * Entende um id de mês em qualquer dos formatos usados:
 *   "2026-08" · "Agosto 2026" · "Agosto" · "ago/2026"
 * → { ano: '2026'|null, mes: '08', numero: 8 }  (null se não for um mês)
 */
function migPartesMes(id) {
  var s = migTexto(id, 40);
  if (!s) return null;

  var iso = s.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    var n = Number(iso[2]);
    if (n < 1 || n > 12) return null;
    return { ano: iso[1], mes: migPad2(n), numero: n };
  }

  var partes = s.replace(/[\/,]/g, ' ').split(/\s+/).filter(function (p) { return p !== ''; });
  var ano = null;
  if (partes.length > 1 && /^\d{4}$/.test(partes[partes.length - 1])) ano = partes.pop();
  var numero = migNumeroMes(partes.join(' '));
  return numero ? { ano: ano, mes: migPad2(numero), numero: numero } : null;
}

/** Chave comparável de um mês: "2026-08" ou "08" (quando o id não diz o ano). */
function migChaveMes(mes) {
  var p = (typeof mes === 'string') ? migPartesMes(mes) : mes;
  if (!p) return '';
  return (p.ano ? p.ano + '-' : '') + p.mes;
}

/**
 * Descobre quais meses do banco correspondem ao texto digitado pelo usuário.
 * @return {{ids:!Array<string>, erro:(string|null)}}
 */
function migResolverMeses(ids, texto) {
  var alvo = migTexto(texto, 40);
  ids = ids || [];
  if (!alvo) return { ids: ids.slice(), erro: null };

  // 1) id idêntico ao que está no banco ("Agosto" → "Agosto")
  var exatos = ids.filter(function (id) { return id.toLowerCase() === alvo.toLowerCase(); });
  if (exatos.length) return { ids: exatos, erro: null };

  var p = migPartesMes(alvo);
  if (p) {
    // 2) mesmo mês (e mesmo ano, quando o alvo informa o ano)
    var mesmaChave = ids.filter(function (id) { return migChaveMes(id) === migChaveMes(p); });
    if (mesmaChave.length === 1) return { ids: mesmaChave, erro: null };
    if (mesmaChave.length > 1) return { ids: [], erro: migErroAmbiguo(alvo, mesmaChave) };

    // 3) banco sem ano ("Agosto") x alvo com ano ("Agosto 2026") — casa pelo mês
    var soMes = ids.filter(function (id) {
      var q = migPartesMes(id);
      return !!q && q.numero === p.numero;
    });
    if (soMes.length === 1) return { ids: soMes, erro: null };
    if (soMes.length > 1) return { ids: [], erro: migErroAmbiguo(alvo, soMes) };
  }

  return {
    ids: [],
    erro: 'Nenhum mês do banco corresponde a "' + alvo + '". ' + migDicaMeses(ids)
  };
}

function migErroAmbiguo(alvo, candidatos) {
  return '"' + alvo + '" corresponde a mais de um mês (' + candidatos.join(', ') +
    '). Informe o ano, ex.: "' + candidatos[0] + '".';
}

function migDicaMeses(ids) {
  return ids.length ? 'Meses disponíveis: ' + ids.join(', ') + '.' : 'A tabela meses está vazia.';
}

function migPad2(n) { return ('0' + n).slice(-2); }

/** Texto do banco → célula (respeita o limite das colunas no Postgres). */
function migTexto(s, maxLen) {
  if (s == null) return '';
  var t = String(s).trim();
  return (maxLen && t.length > maxLen) ? t.slice(0, maxLen) : t;
}

/** "2026-08-05" → Date (reaproveita o parseData do Code.gs quando disponível). */
function migData(v) {
  if (v == null || v === '') return null;
  if (typeof parseData === 'function') {
    var d0 = parseData(v);
    return (d0 instanceof Date && !isNaN(d0.getTime())) ? d0 : null;
  }
  var m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function migValor(v) {
  var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function migBRL(v) {
  var s = (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).split('.');
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + s.join(',');
}

function migErro(err) {
  if (!err) return 'erro desconhecido';
  return String(err.message || err);
}

/** Relatório em texto (alert + Logger). */
function migResumoTexto(r) {
  var linhas = ['Migração Supabase ➜ ' + (r.planilha || MIG_SPREADSHEET_ID), ''];
  if (r.meses && r.meses.length) {
    r.meses.forEach(function (m) {
      linhas.push('• ' + m.aba + ' (' + m.mes + '): ' + m.entradas + ' entradas, ' +
        m.saidas + ' saídas → saldo ' + migBRL(m.balanco));
    });
    linhas.push('');
    linhas.push('Total: ' + r.meses.length + ' aba(s) atualizada(s).');
  } else {
    linhas.push('Nenhum mês encontrado no Supabase.');
  }
  if (r.erros && r.erros.length) {
    linhas.push('');
    linhas.push('⚠️ Falhas (' + r.erros.length + '):');
    r.erros.forEach(function (e) { linhas.push('• ' + e); });
  }
  return linhas.join('\n');
}

function migAlerta(msg) {
  Logger.log(msg);
  SpreadsheetApp.getUi().alert(msg);
}
