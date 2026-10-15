/*******************************************************************************
 * CONTROLE FINANCEIRO — MIGRAÇÃO SUPABASE ➜ GOOGLE SHEETS
 *
 * Copia as tabelas `meses` e `lancamentos` do Supabase (REST/PostgREST, a mesma
 * API que o site usa) para DESTA planilha:
 *   https://docs.google.com/spreadsheets/d/1WTL4V2AGx_jj84_rKU3Y18tGXgeN4dT9-ciYc0an_dA
 *
 * É um ESPELHO de leitura: o Supabase é a fonte da verdade. A cada execução as
 * tabelas ENTRADAS/SAÍDAS da aba são limpas e regravadas, então edições feitas
 * nessas tabelas são sobrescritas na próxima migração.
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
 *   • Migrar tudo do Supabase → grava todas as tabelas na aba "Página1"
 *   • Migrar um mês…          → só um mês ("Agosto", "2026-08" ou "Agosto 2026")
 *   • Testar conexão          → confere URL/chave e lista os meses do banco
 *
 * LAYOUT GRAVADO — template "120 Dias - Controle Financeiro Geral", numa única
 * aba (`MIG_ABA_MODELO` = "Página1"), a partir da LINHA 18 (a 17 é o cabeçalho):
 *   • ENTRADAS: B = Data · C = Valor Bruto · D = Custo (não vem do banco)
 *   • SAÍDAS:   J = Data · K = Descrição · L = Categoria · M = Valor
 *               N = Observação (recebe a Conta: Pix / Dinheiro / Físico)
 *   • E (Lucro Bruto), F (Dízimo 10%) e G (Valor Líquido) são FÓRMULAS do
 *     template e a migração nunca escreve nelas. Os totais da linha 3
 *     (C3 = SOMA(G18:G), F3 = SOMA(M18:M), J3 = C3-F3) também são fórmulas e
 *     somam a coluna inteira — como tudo vai para a mesma aba, eles mostram o
 *     total geral (todos os meses), sem precisar de ajuste quando as linhas
 *     crescem.
 *   • O bloco CONTROLE DA ESTADIA / PAINEL DE PROGRESSO (linhas 8-13) é
 *     manual e nunca é tocado.
 *   • O template não tem colunas para Descrição/Categoria/Conta das
 *     ENTRADAS; para não perder dado, elas são gravadas à direita, em
 *     O:P:Q (MIG_EXTRAS). Basta apagar/ocultar essas colunas se não quiser.
 *   • Com MIG_ABA_POR_MES = true o nome da aba passa a ser o mês ("Agosto",
 *     ou "Agosto 2026" se o mesmo mês existir em mais de um ano).
 *   A marca "✓" de pago/enviado vem junto da própria Descrição.
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
// Planilha de destino da migração (NÃO herda a planilha do Code.gs).
var MIG_SPREADSHEET_ID = '1WTL4V2AGx_jj84_rKU3Y18tGXgeN4dT9-ciYc0an_dA';

// ---------------------------------------------------- layout do template TEO
// A migração grava SEMPRE na aba `MIG_ABA_MODELO` ("Página1"), nas tabelas
// ENTRADAS/SAÍDAS, a partir da LINHA 18 (a 17 é o cabeçalho).
var MIG_ABA_MODELO = 'Página1';  // aba de destino (o template TEO)
var MIG_ABA_POR_MES = false;     // false = tudo em Página1 (padrão)
                                 // true  = uma aba por mês, copiada de Página1
var MIG_LINHA_DADOS = 18;        // 1ª linha de lançamento (17 = cabeçalho)

// Colunas do template (1 = A). As faixas escritas são B:D, J:N e O:Q.
var MIG_COL_ENTRADA = 2;   // B: Data, Valor Bruto, Custo
var MIG_COL_SAIDA = 10;    // J: Data, Descrição, Categoria, Valor, Observação
var MIG_COL_EXTRA = 15;    // O: Descrição, Categoria, Conta (só ENTRADAS)
var MIG_EXTRAS = true;     // false = não grava as colunas extras O:P:Q

var MIG_FMT_DATA = 'dd/mm';
var MIG_FMT_MOEDA = 'R$ #,##0.00';

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

  var meses = [], erros = [];

  if (!MIG_ABA_POR_MES) {
    // Padrão: tudo na mesma aba ("Página1"). As duas tabelas ficam em ordem de
    // data, então dá para isolar um mês pela coluna Data.
    var todasE = [], todasS = [];
    ids.forEach(function (id) {
      try {
        var linhas = migBuscarLancamentos(cfg, id);
        var e = migFiltrar(linhas, 'entrada'), s = migFiltrar(linhas, 'saida');
        todasE = todasE.concat(e);
        todasS = todasS.concat(s);
        meses.push({
          mes: id, aba: MIG_ABA_MODELO, entradas: e.length, saidas: s.length,
          totalEntradas: migSoma(e), totalSaidas: migSoma(s), balanco: migSoma(e) - migSoma(s)
        });
      } catch (err) {
        erros.push(id + ': ' + migErro(err));
      }
    });
    if (meses.length) {
      var alvo = ss.getSheetByName(MIG_ABA_MODELO);
      if (!alvo) {
        throw new Error('aba "' + MIG_ABA_MODELO + '" não encontrada — ajuste MIG_ABA_MODELO.');
      }
      if (!migPareceTemplate(alvo)) {
        throw new Error('a aba "' + MIG_ABA_MODELO + '" não tem as tabelas do template ' +
          '(cabeçalho "Data" em B' + (MIG_LINHA_DADOS - 1) + ' e J' + (MIG_LINHA_DADOS - 1) + ').');
      }
      var rUnica = migEscreverAba(alvo, migOrdenar(todasE), migOrdenar(todasS));
      meses.forEach(function (m) {
        m.linhaInicial = rUnica.primeiraLinha;
        m.linhaFinal = rUnica.ultimaLinha;
      });
    }
  } else {
    var anos = migMapaAnos(ids);
    var donoDaAba = {}; // nome da aba → id que a usa (evita uma sobrescrever a outra)

    ids.forEach(function (id) {
      try {
        var nome = migNomeAba(id, anos);
        if (donoDaAba[nome] && donoDaAba[nome] !== id) {
          throw new Error('a aba "' + nome + '" seria usada também por "' + donoDaAba[nome] +
            '" — ajuste MIG_FORMATO_ABA para "id" ou padronize os ids no banco.');
        }
        var rows = migBuscarLancamentos(cfg, id);
        var dest = migAbaDoMes(ss, nome);
        if (!dest.criada && !migPareceTemplate(dest.aba)) {
          throw new Error('a aba "' + nome + '" já existe mas não tem as tabelas do template ' +
            '(cabeçalho "Data" em B' + (MIG_LINHA_DADOS - 1) + ' e J' + (MIG_LINHA_DADOS - 1) + '). ' +
            'Renomeie ou apague essa aba para a migração poder copiar o modelo.');
        }
        donoDaAba[nome] = id;
        var r = migEscreverAba(dest.aba, migFiltrar(rows, 'entrada'), migFiltrar(rows, 'saida'));
        meses.push({
          mes: id, aba: nome, criada: dest.criada,
          entradas: r.entradas, saidas: r.saidas,
          totalEntradas: r.totalEntradas, totalSaidas: r.totalSaidas,
          linhaInicial: r.primeiraLinha, linhaFinal: r.ultimaLinha,
          balanco: r.totalEntradas - r.totalSaidas
        });
      } catch (err) {
        erros.push(id + ': ' + migErro(err));
      }
    });
  }

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
/** Devolve a aba do mês, criando-a como CÓPIA da aba modelo quando faltar. */
function migAbaDoMes(ss, nome) {
  var existente = ss.getSheetByName(nome);
  if (existente) return { aba: existente, criada: false };
  var modelo = ss.getSheetByName(MIG_ABA_MODELO);
  if (!modelo) {
    throw new Error('aba modelo "' + MIG_ABA_MODELO + '" não encontrada — ajuste MIG_ABA_MODELO.');
  }
  var copia = modelo.copyTo(ss);
  copia.setName(nome);
  return { aba: copia, criada: true };
}

/**
 * A aba tem as tabelas do template? (cabeçalho "Data" em B e J na linha 17)
 * Serve para não sobrescrever uma aba que não seja do template.
 */
function migPareceTemplate(sh) {
  try {
    var cab = MIG_LINHA_DADOS - 1;
    return migTexto(sh.getRange(cab, MIG_COL_ENTRADA).getValue(), 20).toLowerCase() === 'data' &&
           migTexto(sh.getRange(cab, MIG_COL_SAIDA).getValue(), 20).toLowerCase() === 'data';
  } catch (err) {
    return false;
  }
}

/**
 * Regrava as tabelas da aba (linha 18 em diante): limpa B:D, J:N e O:Q, escreve
 * os lançamentos do mês e reaplica os formatos.
 * As colunas de fórmula do template (E, F e G) e a linha 3 não são tocadas.
 */
function migEscreverAba(sh, entradas, saidas) {
  migLimparDados(sh);

  var matE = migMatrizEntradas(entradas);
  var matS = migMatrizSaidas(saidas);
  if (matE.length) sh.getRange(MIG_LINHA_DADOS, MIG_COL_ENTRADA, matE.length, 3).setValues(matE);
  if (matS.length) sh.getRange(MIG_LINHA_DADOS, MIG_COL_SAIDA, matS.length, 5).setValues(matS);
  if (MIG_EXTRAS && matE.length) {
    sh.getRange(MIG_LINHA_DADOS, MIG_COL_EXTRA, matE.length, 3).setValues(migMatrizExtras(entradas));
  }

  var usadas = Math.max(matE.length, matS.length);
  if (usadas) {
    sh.getRange(MIG_LINHA_DADOS, MIG_COL_ENTRADA, usadas, 1).setNumberFormat(MIG_FMT_DATA);
    sh.getRange(MIG_LINHA_DADOS, MIG_COL_ENTRADA + 1, usadas, 2).setNumberFormat(MIG_FMT_MOEDA);
    sh.getRange(MIG_LINHA_DADOS, MIG_COL_SAIDA, usadas, 1).setNumberFormat(MIG_FMT_DATA);
    sh.getRange(MIG_LINHA_DADOS, MIG_COL_SAIDA + 3, usadas, 1).setNumberFormat(MIG_FMT_MOEDA);
  }

  return {
    entradas: matE.length, saidas: matS.length,
    totalEntradas: migSoma(entradas), totalSaidas: migSoma(saidas),
    primeiraLinha: MIG_LINHA_DADOS,
    ultimaLinha: MIG_LINHA_DADOS + Math.max(usadas - 1, 0)
  };
}

function migLimparDados(sh) {
  var ultima = Math.max(sh.getLastRow(), MIG_LINHA_DADOS);
  var n = ultima - MIG_LINHA_DADOS + 1;
  sh.getRange(MIG_LINHA_DADOS, MIG_COL_ENTRADA, n, 3).clearContent(); // B:D
  sh.getRange(MIG_LINHA_DADOS, MIG_COL_SAIDA, n, 5).clearContent();   // J:N
  if (MIG_EXTRAS) {
    sh.getRange(MIG_LINHA_DADOS, MIG_COL_EXTRA, n, 3).clearContent(); // O:Q
  }
}

/** ENTRADAS → [Data, Valor Bruto, Custo] (o banco não tem Custo em entrada). */
function migMatrizEntradas(rows) {
  var out = [];
  (rows || []).forEach(function (r) {
    var data = migData(r && r.data);
    if (!data) return; // sem data válida não dá para lançar
    out.push([data, migValor(r.valor), '']);
  });
  return out;
}

/** Campos que a ENTRADA tem no banco e o template não tem (colunas O:P:Q). */
function migMatrizExtras(rows) {
  var out = [];
  (rows || []).forEach(function (r) {
    if (!migData(r && r.data)) return;
    out.push([
      migTexto(r.descricao, MIG_MAX_TEXTO),
      migTexto(r.categoria, MIG_MAX_TEXTO),
      migTexto(r.conta, MIG_MAX_TEXTO)
    ]);
  });
  return out;
}

/** SAÍDAS → [Data, Descrição, Categoria, Valor, Observação(=conta)]. */
function migMatrizSaidas(rows) {
  var out = [];
  (rows || []).forEach(function (r) {
    var data = migData(r && r.data);
    if (!data) return;
    out.push([
      data,
      migTexto(r.descricao, MIG_MAX_TEXTO),
      migTexto(r.categoria, MIG_MAX_TEXTO),
      migValor(r.valor),
      migTexto(r.conta, MIG_MAX_TEXTO)
    ]);
  });
  return out;
}

// ---------------------------------------------------------------- utilitários
function migFiltrar(rows, tipo) {
  return (rows || []).filter(function (r) { return r && r.tipo === tipo; }).sort(migComparar);
}

/** Ordena lançamentos por data (mesma regra do filtro). */
function migOrdenar(rows) {
  return (rows || []).slice().sort(migComparar);
}

/** Comparador: data → num (linha estável do banco) → descrição → valor. */
function migComparar(a, b) {
  var da = String(a.data == null ? '' : a.data);
  var db = String(b.data == null ? '' : b.data);
  if (da !== db) return da < db ? -1 : 1;
  var na = Number(a.num), nb = Number(b.num);
  if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
  var sa = String(a.descricao == null ? '' : a.descricao);
  var sb = String(b.descricao == null ? '' : b.descricao);
  if (sa !== sb) return sa < sb ? -1 : 1;
  var va = Number(a.valor) || 0, vb = Number(b.valor) || 0;
  return va === vb ? 0 : (va < vb ? -1 : 1);
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
      var onde = 'linhas ' + m.linhaInicial + '–' + m.linhaFinal;
      linhas.push('• ' + m.aba + (m.criada ? ' (nova)' : '') + ' (' + m.mes + '): ' +
        m.entradas + ' entradas, ' + m.saidas + ' saídas → saldo ' + migBRL(m.balanco) +
        '  [' + onde + ']');
    });
    linhas.push('');
    linhas.push('Total: ' + r.meses.length + ' mês(es) gravado(s).');
    linhas.push(MIG_ABA_POR_MES
      ? 'Cada mês fica em uma aba copiada de "' + MIG_ABA_MODELO + '".'
      : 'Tudo na aba "' + MIG_ABA_MODELO + '", em ordem de data (linhas 18+).');
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
