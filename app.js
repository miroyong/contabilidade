// ============================================================
// CONTROLE FINANCEIRO — lógica do app
// ============================================================
(function () {
  'use strict';

  var API = window.APP_CONFIG || {};
  var SB_URL = (API.SUPABASE_URL || '').replace(/\/+$/, '');
  var SB_KEY = API.SUPABASE_ANON_KEY || '';

  var state = {
    mes: null,          // aba selecionada (ex.: "Agosto")
    meses: [],          // abas existentes
    mesAtual: null,     // mês corrente (pt-BR)
    existe: true,       // a aba do mês selecionado existe?
    entradas: [],
    saidas: [],
    acumulado: null,    // soma dos meses até o vigente (caixa que passa de um mês para o outro)
    categorias: [],
    contas: [],
    filtro: { tipo: 'todos', categoria: '', conta: '', busca: '' },
    editando: null,     // { tipo: 'entrada'|'saida', linha: N }
    salvando: false,    // trava toque duplo no salvar (evita duplicar)
    limiteLista: 15     // quantos lançamentos o extrato mostra por vez
  };

  var LISTA_INICIAL = 15; // evita rolar centenas de itens de uma vez

  var $ = function (id) { return document.getElementById(id); };

  // ---- cache local: renderização instantânea (evita espera do servidor) ----
  function cacheGet(chave) {
    try { return JSON.parse(localStorage.getItem('cf_' + chave)); } catch (e) { return null; }
  }
  function cacheSet(chave, valor) {
    try { localStorage.setItem('cf_' + chave, JSON.stringify(valor)); } catch (e) {}
  }
  function syncStatus(ativo, msg) {
    var el = $('sync-status');
    if (!el) return;
    el.hidden = !ativo;
    el.textContent = ativo ? (msg || 'sincronizando…') : '';
    // segurança: nunca deixa o indicador ativo por mais de 60s
    clearTimeout(syncStatus._t);
    if (ativo) syncStatus._t = setTimeout(function () {
      el.hidden = true;
      el.textContent = '';
    }, 60000);
  }
  function salvarCacheMes() {
    cacheSet('lan_' + state.mes, {
      existe: state.existe, entradas: state.entradas, saidas: state.saidas, acumulado: state.acumulado
    });
  }
  function renderDoCache(mes) {
    var c = cacheGet('lan_' + mes);
    if (!c) return false;
    state.existe = !!c.existe;
    state.entradas = c.entradas || [];
    state.saidas = c.saidas || [];
    state.acumulado = c.acumulado || null;
    renderTudo();
    return true;
  }
  function recarregarMes() { selecionarMes(state.mes); }

  var fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // ------------------------------------------------------------ utilidades
  function chamar(action, params) {
    params = params || {};
    switch (action) {
      case 'meses':       return sbMeses();
      case 'opcoes':      return sbOpcoes();
      case 'lancamentos': return sbLancamentos(params.mes);
      case 'acumulado':   return sbAcumulado(params.meses);
      case 'adicionar':   return sbAdicionar(params);
      case 'atualizar':   return sbAtualizar(params);
      case 'excluir':     return sbExcluir(params);
      case 'novoMes':     return sbNovoMes(params.mes);
      default:            return Promise.resolve({ ok: false, erro: 'Ação desconhecida: ' + action });
    }
  }

  // ------------------------------------------------- Supabase REST (PostgREST)
  function sbRest(path, opts) {
    opts = opts || {};
    var url = SB_URL + '/rest/v1/' + path + (opts.query ? '?' + opts.query : '');
    var cfg = {
      method: opts.method || 'GET',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json'
      }
    };
    if (opts.body) cfg.body = JSON.stringify(opts.body);
    if (opts.prefer) cfg.headers['Prefer'] = opts.prefer;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 90000);
    cfg.signal = ctrl.signal;
    return fetch(url, cfg).then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (t) {
        if (!r.ok) {
          var msg = 'HTTP ' + r.status;
          try {
            var j = JSON.parse(t);
            if (j.message) msg += ' — ' + j.message;
            else if (j.details) msg += ' — ' + j.details;
            else if (t) msg += ' — ' + t.slice(0, 180);
          } catch (e) { if (t) msg += ' — ' + t.slice(0, 180); }
          throw new Error(msg);
        }
        if (!t) return null;
        try { return JSON.parse(t); } catch (e) { return null; }
      });
    });
  }

  function sbEnc(v) { return encodeURIComponent(String(v == null ? '' : v)); }

  // mês corrente em pt-BR (ex.: "Setembro") — antes era calculado no servidor
  function sbMesCorrente() {
    var d = new Date();
    var n = d.toLocaleDateString('pt-BR', { month: 'long' });
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  // linha = num (id numérico estável do banco); app não muda o restante
  function sbMontar(r) {
    return {
      linha: Number(r.num),
      data: String(r.data || ''),
      descricao: String(r.descricao == null ? '' : r.descricao).trim(),
      categoria: String(r.categoria == null ? '' : r.categoria).trim(),
      conta: String(r.conta == null ? '' : r.conta).trim(),
      valor: Number(r.valor) || 0
    };
  }

  function sbMeses() {
    return sbRest('meses', { query: 'select=id&order=criado_em.asc,id.asc' })
      .then(function (rows) {
        return {
          ok: true,
          meses: (rows || []).map(function (r) { return r.id; }),
          mesAtual: sbMesCorrente()
        };
      });
  }

  function sbOpcoes() {
    return sbRest('lancamentos', { query: 'select=categoria,conta' })
      .then(function (rows) {
        var cats = {}, contas = {};
        (rows || []).forEach(function (r) {
          if (r.categoria) cats[String(r.categoria).trim()] = 1;
          if (r.conta) contas[String(r.conta).trim()] = 1;
        });
        return {
          ok: true,
          categorias: Object.keys(cats).sort(),
          contas: Object.keys(contas).sort()
        };
      });
  }

  function sbLancamentos(mes) {
    var qMes = 'mes_id=eq.' + sbEnc(mes);
    return Promise.all([
      sbRest('lancamentos', {
        query: 'select=num,tipo,data,descricao,categoria,conta,valor&' + qMes + '&order=data.asc,num.asc'
      }),
      sbRest('meses', { query: 'select=id&id=eq.' + sbEnc(mes) })
    ]).then(function (rs) {
      var rows = rs[0] || [];
      var existe = (rs[1] || []).length > 0;
      var entradas = [], saidas = [];
      rows.forEach(function (r) {
        var it = sbMontar(r);
        if (r.tipo === 'saida') saidas.push(it); else entradas.push(it);
      });
      var totE = entradas.reduce(function (s, l) { return s + l.valor; }, 0);
      var totS = saidas.reduce(function (s, l) { return s + l.valor; }, 0);
      return {
        ok: true, existe: existe, mes: mes,
        entradas: entradas, saidas: saidas,
        totais: { entradas: totE, saidas: totS, balanco: totE - totS }
      };
    });
  }

  // soma de todos os meses até o vigente: o caixa que sobra num mês continua no
  // seguinte, então o hero mostra o acumulado (não só o mês selecionado).
  // Uma consulta por mês (em paralelo) para não bater no teto de linhas do PostgREST.
  function sbAcumulado(meses) {
    var total = novoTotal();
    if (!meses || !meses.length) return Promise.resolve(total);
    return Promise.all(meses.map(function (m) {
      return sbRest('lancamentos', { query: 'select=tipo,conta,valor&mes_id=eq.' + sbEnc(m) });
    })).then(function (listas) {
      listas.forEach(function (rows) {
        var ent = [], sai = [];
        (rows || []).forEach(function (l) {
          (l.tipo === 'saida' ? sai : ent).push({ valor: Number(l.valor) || 0, conta: l.conta });
        });
        somarNoTotal(total, somarLancamentos(ent, sai));
      });
      return total;
    });
  }

  function sbAdicionar(p) {
    return sbRest('lancamentos', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        mes_id: p.mes, tipo: p.tipo, data: p.data,
        descricao: p.descricao, categoria: p.categoria || '',
        conta: p.conta || '', valor: p.valor
      }
    }).then(function (rows) {
      rows = rows || [];
      return { ok: true, linha: rows.length ? Number(rows[0].num) : null };
    });
  }

  function sbAtualizar(p) {
    return sbRest('lancamentos', {
      query: 'num=eq.' + sbEnc(p.linha),
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        tipo: p.tipo, data: p.data,
        descricao: p.descricao, categoria: p.categoria || '',
        conta: p.conta || '', valor: p.valor
      }
    }).then(function () { return { ok: true }; });
  }

  function sbExcluir(p) {
    return sbRest('lancamentos', {
      query: 'num=eq.' + sbEnc(p.linha) + '&mes_id=eq.' + sbEnc(p.mes),
      method: 'DELETE'
    }).then(function () { return { ok: true }; });
  }

  function sbNovoMes(mes) {
    if (!mes) return Promise.resolve({ ok: false, erro: 'Informe o mês.' });
    return sbRest('meses', {
      method: 'POST', prefer: 'return=representation', body: { id: mes }
    }).then(function () {
      return { ok: true, criado: true, mes: mes };
    }).catch(function (e) {
      // mês já existe (chave duplicada 23505) — comportamento igual ao antigo
      if (/23505|duplicate|already exists/i.test(String(e.message))) {
        return { ok: true, criado: false, mes: mes };
      }
      return { ok: false, erro: e.message };
    });
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('visivel'); });
    clearTimeout(t._timer);
    t._timer = setTimeout(function () {
      t.classList.remove('visivel');
      setTimeout(function () { t.hidden = true; }, 300);
    }, 2200);
  }

  function hojeISO() {
    var d = new Date();
    var dd = ('0' + d.getDate()).slice(-2);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function mesDaData(iso) {
    var meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var partes = String(iso || '').split('-');
    var ano = Number(partes[0]);
    var mes = Number(partes[1]);
    return ano && mes >= 1 && mes <= 12 ? meses[mes - 1] : state.mes;
  }

  function fmtDataBR(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1];
  }

  function parseValor(s) {
    if (typeof s === 'number') return s;
    var t = String(s || '').replace(/R\$/g, '').replace(/\s/g, '');
    if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }

  function renderValorMascara(input) {
    var digitos = input._valorDigitos || '';
    if (!digitos) { input.value = ''; return; }
    digitos = digitos.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    var centavos = digitos.padStart(3, '0');
    var inteiro = centavos.slice(0, -2) || '0';
    input.value = inteiro + ',' + centavos.slice(-2);
  }

  function prepararValorInput(input) {
    var valor = String(input.value || '').trim();
    input._valorDigitos = valor ? String(Math.round(parseValor(valor) * 100)) : '';
    renderValorMascara(input);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------ ícones
  // SVG inline (traço 1.5) — a interface não usa emojis.
  var SVG_ICONE = '<svg class="icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">';
  var ICO = {
    sol: SVG_ICONE + '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/></svg>',
    lua: SVG_ICONE + '<path d="M20.6 14.7A8.6 8.6 0 0 1 9.3 3.4a7.1 7.1 0 1 0 11.3 11.3Z"/></svg>',
    mais: '<svg class="icone cheio" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
    baixo: SVG_ICONE + '<path d="M6 9.5l6 6 6-6"/></svg>',
    cima: SVG_ICONE + '<path d="M6 14.5l6-6 6 6"/></svg>'
  };

  // ------------------------------------------------------------ tema
  function aplicarTema(t) {
    document.documentElement.dataset.tema = t;
    var btn = $('btn-tema');
    if (btn) btn.innerHTML = t === 'escuro' ? ICO.sol : ICO.lua;
    cacheSet('tema', t);
  }

  // ------------------------------------------------------------ carregamento
  function carregarInicio() {
    if (!SB_URL || !SB_KEY) {
      $('aviso-config').hidden = false;
      $('btn-novo-fab').disabled = true;
      return;
    }
    // 1) render imediato a partir do cache (nada de tela vazia)
    var mesesC = cacheGet('meses');
    if (mesesC && mesesC.meses && mesesC.meses.length) {
      state.meses = mesesC.meses;
      state.mesAtual = mesesC.mesAtual;
      var opC = cacheGet('opcoes');
      if (opC) {
        state.categorias = opC.categorias || [];
        state.contas = opC.contas || [];
      }
      preencherDatalists();
      selecionarMes(state.meses.indexOf(state.mesAtual) >= 0 ? state.mesAtual : state.meses[0]);
    }
    // 2) revalida no servidor em background e atualiza
    syncStatus(true, 'carregando…');
    Promise.all([chamar('meses'), chamar('opcoes')])
      .then(function (rs) {
        var meses = rs[0], op = rs[1];
        if (!meses.ok) throw new Error(meses.erro);
        state.meses = meses.meses || [];
        state.mesAtual = meses.mesAtual;
        state.categorias = (op && op.ok && op.categorias) || [];
        state.contas = (op && op.ok && op.contas) || [];

        cacheSet('meses', { meses: state.meses, mesAtual: state.mesAtual });
        cacheSet('opcoes', { categorias: state.categorias, contas: state.contas });
        preencherDatalists();

        // escolhe o mês: o atual se existir, senão o primeiro existente
        var alvo = null;
        if (state.meses.indexOf(state.mesAtual) >= 0) alvo = state.mesAtual;
        else if (state.meses.length) alvo = state.meses[0];
        else alvo = state.mesAtual; // nada existe ainda — deixa o app propor criar

        selecionarMes(alvo);
      })
      .catch(function (e) {
        syncStatus(false);
        if (!renderDoCache(state.mes)) {
          $('aviso-config').hidden = false;
          $('aviso-config').textContent = 'Erro ao conectar no Supabase: ' + e.message +
            '. Confira o SUPABASE_URL/SUPABASE_ANON_KEY no config.js.';
        }
      });
  }

  function mesesAteAqui(mes) {
    // o mês selecionado não estar na lista é raro (aba recém-criada): acumula tudo
    var idx = state.meses.indexOf(mes);
    return idx < 0 ? state.meses.slice() : state.meses.slice(0, idx + 1);
  }

  // o mês aberto faz parte do acumulado: depois de gravar/excluir, refaz a soma
  function atualizarAcumulado() {
    return chamar('acumulado', { meses: mesesAteAqui(state.mes) }).then(function (ac) {
      if (!ac || !ac.ok) return;
      state.acumulado = ac;
      salvarCacheMes();
      renderSaldo();
    }).catch(function () {});
  }

  function selecionarMes(mes) {
    state.mes = mes;
    state.editando = null;
    limparFiltros();
    renderDoCache(mes); // mostra na hora se houver cache
    syncStatus(true, 'atualizando…');
    // o caixa acumula de mês em mês: soma o selecionado + todos os anteriores
    var ateAqui = mesesAteAqui(mes);
    Promise.all([
      chamar('lancamentos', { mes: mes }),
      chamar('acumulado', { meses: ateAqui }).catch(function () { return null; })
    ])
      .then(function (rs) {
        var r = rs[0], ac = rs[1];
        syncStatus(false);
        if (!r.ok) throw new Error(r.erro);
        state.existe = !!r.existe;
        state.entradas = r.entradas || [];
        state.saidas = r.saidas || [];
        state.acumulado = ac && ac.ok ? ac : null;
        salvarCacheMes();
        renderTudo();
        carregarComparativo(mes);
      })
      .catch(function (e) {
        syncStatus(false);
        if (!renderDoCache(state.mes)) toast('Erro ao carregar mês: ' + e.message);
      });
  }

  // contas do filtro: canônicas (Pix / Dinheiro) + legadas/estranhas ainda não cobertas
  function contasOpcoes() {
    var opts = CONTAS.slice();
    var baldes = opts.map(function (c) { return contaChave(c); });
    state.contas.forEach(function (c) {
      var k = contaChave(c) || c; // conta conhecida entra pelo balde canônico (sem duplicar)
      if (opts.indexOf(k) < 0 && baldes.indexOf(k) < 0) { opts.push(k); baldes.push(k); }
    });
    return opts;
  }

  function preencherDatalists() {
    $('dl-categorias').innerHTML = state.categorias.map(function (c) {
      return '<option value="' + esc(c) + '">';
    }).join('');
  }

  // ------------------------------------------------------------ render
  function renderTudo() {
    renderSaldo();
    renderMeses();
    renderAvisoMes();
    renderFiltros();
    renderDashboard();
    renderGrafico();
    renderLista();
  }

  var CONTAS = ['Pix', 'Dinheiro'];

  // normaliza qualquer nome de conta (novo ou legado) para um dos dois baldes:
  // 'Pix' (Pix / Cartão) e 'Físico' (Dinheiro + legado Físico, o dinheiro em mãos)
  function contaChave(nome) {
    var s = String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (s.indexOf('pix') >= 0) return 'Pix';
    if (s.indexOf('fisic') >= 0) return 'Físico';
    if (s.indexOf('dinheiro') >= 0) return 'Físico';
    return null; // não entra no breakdown
  }

  function novoTotal() {
    return { ok: true, entradas: 0, saidas: 0, porConta: { 'Pix': 0, 'Físico': 0 } };
  }

  // soma lançamentos já normalizados ({ valor, conta }): entradas, saídas e saldo por conta
  function somarLancamentos(entradas, saidas) {
    var t = novoTotal();
    entradas.forEach(function (l) {
      t.entradas += l.valor;
      var k = contaChave(l.conta);
      if (k) t.porConta[k] += l.valor;
    });
    saidas.forEach(function (l) {
      t.saidas += l.valor;
      var k = contaChave(l.conta);
      if (k) t.porConta[k] -= l.valor;
    });
    return t;
  }

  function somarNoTotal(destino, t) {
    destino.entradas += t.entradas;
    destino.saidas += t.saidas;
    destino.porConta['Pix'] += t.porConta['Pix'];
    destino.porConta['Físico'] += t.porConta['Físico'];
  }

  function renderSaldo() {
    var t = state.acumulado || somarLancamentos(state.entradas, state.saidas);
    var bal = t.entradas - t.saidas;
    var porConta = { 'Pix': t.porConta['Pix'], 'Físico': t.porConta['Físico'] };
    // lançamentos sem conta reconhecida entram só no Total
    var outros = bal - (porConta['Pix'] + porConta['Físico']);
    $('saldo-escopo').textContent = state.acumulado ? 'Caixa acumulado até ' : 'Balanço · ';
    $('saldo-mes').textContent = state.mes || '—';
    var v = $('saldo-valor');
    v.textContent = fmtBRL.format(bal);
    v.className = 'saldo-valor ' + (bal >= 0 ? 'positivo' : 'negativo');
    $('saldo-entradas').textContent = fmtBRL.format(t.entradas);
    $('saldo-saidas').textContent = fmtBRL.format(t.saidas);

    $('saldo-pix').textContent = fmtBRL.format(porConta['Pix']);
    $('saldo-fisico').textContent = fmtBRL.format(porConta['Físico']);
    $('saldo-pix').className = 'saldo-item-valor ' + (porConta['Pix'] >= 0 ? 'positivo' : 'negativo');
    $('saldo-fisico').className = 'saldo-item-valor ' + (porConta['Físico'] >= 0 ? 'positivo' : 'negativo');

    void outros;
  }

  function renderMeses() {
    var box = $('meses-list');
    if (!state.meses.length) {
      box.innerHTML = '<span class="vazio">Nenhuma aba de mês ainda.</span>';
      return;
    }
    box.innerHTML = state.meses.map(function (m) {
      return '<button class="chip' + (m === state.mes ? ' ativo' : '') + '" data-mes="' +
        esc(m) + '">' + esc(m) + '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (b) {
      b.addEventListener('click', function () { selecionarMes(b.dataset.mes); });
    });
  }

  function renderAvisoMes() {
    var av = $('aviso-mes');
    if (!state.meses.length || state.existe) {
      av.hidden = true;
      av.innerHTML = '';
      return;
    }
    av.hidden = false;
    av.innerHTML = 'A aba <b>' + esc(state.mes) + '</b> ainda não existe. ' +
      '<button class="btn-criar-mes">Criar aba agora</button>';
    var btn = av.querySelector('.btn-criar-mes');
    // --sel-b é o verde escuro do tema (mesmo tom do .chip.ativo) — contraste AA com texto branco
    btn.style.cssText = 'margin-left:6px;background:var(--sel-b);color:#fff;border:none;' +
      'border-radius:8px;padding:4px 10px;font-weight:600;cursor:pointer;';
    btn.addEventListener('click', function () { criarMes(state.mes); });
  }

  function renderFiltros() {
    var selCat = $('filtro-categoria');
    var selConta = $('filtro-conta');
    var atualCat = selCat.value, atualConta = selConta.value;
    selCat.innerHTML = '<option value="">Todas as categorias</option>' +
      state.categorias.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    selConta.innerHTML = '<option value="">Todas as contas</option>' +
      contasOpcoes().map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    if (atualCat) selCat.value = atualCat;
    if (atualConta) selConta.value = atualConta;
  }

  function renderGrafico() {
    var porCat = {};
    state.saidas.forEach(function (l) {
      var c = l.categoria || 'Sem categoria';
      porCat[c] = (porCat[c] || 0) + l.valor;
    });
    var box = $('grafico');
    var itens = Object.keys(porCat).map(function (c) { return { nome: c, valor: porCat[c] }; })
      .sort(function (a, b) { return b.valor - a.valor; }).slice(0, 6);
    if (!itens.length) {
      box.innerHTML = '<div class="vazio">Sem saídas neste mês.</div>';
      return;
    }
    var max = itens[0].valor || 1;
    box.innerHTML = itens.map(function (i) {
      var pct = Math.max(3, Math.round(i.valor / max * 100));
      return '<div class="barra-linha">' +
        '<div class="barra-rotulo" title="' + esc(i.nome) + '">' + esc(i.nome) + '</div>' +
        '<div class="barra-pista"><div class="barra-preenchida" style="width:' + pct + '%"></div></div>' +
        '<div class="barra-valor">' + fmtBRL.format(i.valor) + '</div>' +
        '</div>';
    }).join('');
  }

  function renderLista() {
    var f = state.filtro;
    var todos = state.entradas.map(function (l) { l._tipo = 'entrada'; return l; })
      .concat(state.saidas.map(function (l) { l._tipo = 'saida'; return l; }));

    todos = todos.filter(function (l) {
      if (f.tipo !== 'todos' && l._tipo !== f.tipo) return false;
      if (f.categoria && l.categoria !== f.categoria) return false;
      if (f.conta) {
        // compara por balde: "Pix / Cartão" conta como Pix, "Físico" (legado) como Dinheiro
        var k = contaChave(l.conta);
        var fk = contaChave(f.conta);
        if (fk ? k !== fk : l.conta !== f.conta) return false;
      }
      if (f.busca) {
        var termo = f.busca.toLowerCase();
        var descricao = l.descricao.toLowerCase();
        var valorFormatado = fmtBRL.format(l.valor).toLowerCase();
        var valorNumerico = String(l.valor).replace('.', ',');
        if (descricao.indexOf(termo) < 0 &&
        valorFormatado.indexOf(termo) < 0 &&
        valorNumerico.indexOf(termo) < 0) return false;
      }
      return true;
    });

    todos.sort(function (a, b) {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1;
      return b.linha - a.linha;
    });

    $('contador').textContent = todos.length;
    var box = $('lista');
    if (!todos.length) {
      var temFiltro = f.tipo !== 'todos' || f.categoria || f.conta || f.busca;
      box.innerHTML = '<div class="vazio">' +
        (temFiltro ? 'Nenhum lançamento encontrado com esses filtros.'
                   : 'Nenhum lançamento neste mês ainda.') +
        (temFiltro ? '<button class="btn-ver-mais" data-limpar-filtros type="button">Limpar filtros</button>' : '') +
        '</div>';
      var btnLimpar = box.querySelector('[data-limpar-filtros]');
      if (btnLimpar) {
        btnLimpar.addEventListener('click', function () {
          limparFiltros();
          renderLista();
        });
      }
      return;
    }

    var visiveis = todos.slice(0, state.limiteLista);
    var restantes = todos.length - visiveis.length;

    box.innerHTML = visiveis.map(function (l) {
      var tipo = l._tipo;
      var marcado = (tipo === 'saida' && temTogglePago(l) && l.descricao.indexOf('✓') === 0);
      var det = l.categoria || 'Sem categoria';
      if (l.conta) det += ' · ' + l.conta;
      var desc = stripMarca(l.descricao);
      return '<div class="lanc">' +
        '<div class="lanc-data">' + fmtDataBR(l.data) + '</div>' +
        '<div class="lanc-info">' +
          '<span class="lanc-desc" title="' + esc(desc) + '">' +
            (marcado ? '<span class="marcado-rot">✓</span> ' : '') + esc(desc) +
          '</span>' +
          '<span class="lanc-det" title="' + esc(det) + '">' + esc(det) + '</span>' +
        '</div>' +
        '<div class="lanc-valor ' + tipo + '">' + (tipo === 'entrada' ? '+' : '−') + ' ' +
          fmtBRL.format(l.valor) + '</div>' +
        '<button type="button" class="lanc-mais" data-mais="' + tipo + ':' + l.linha + '" ' +
          'aria-label="Ações de ' + esc(desc) + '">' + ICO.mais + '</button>' +
      '</div>';
    }).join('');

    if (restantes > 0) {
      box.innerHTML += '<button class="btn-ver-mais" data-ver-mais type="button">Mostrar todos os ' +
        todos.length + ' lançamentos ' + ICO.baixo + '</button>';
    } else if (state.limiteLista > LISTA_INICIAL) {
      box.innerHTML += '<button class="btn-ver-mais" data-ver-menos type="button">Mostrar menos ' + ICO.cima + '</button>';
    }

    var btnVerMais = box.querySelector('[data-ver-mais]');
    if (btnVerMais) {
      btnVerMais.addEventListener('click', function () {
        state.limiteLista = todos.length;
        renderLista();
      });
    }
    var btnVerMenos = box.querySelector('[data-ver-menos]');
    if (btnVerMenos) {
      btnVerMenos.addEventListener('click', function () {
        state.limiteLista = LISTA_INICIAL;
        renderLista();
      });
    }

    Array.prototype.forEach.call(box.querySelectorAll('[data-mais]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.mais.split(':');
        abrirAcoes(p[0], Number(p[1]));
      });
    });
  }

  // Folha de ações da linha (Editar / Pago / Excluir) — mantém a lista com uma linha por lançamento.
  var acaoCtx = null;
  function abrirAcoes(tipo, linha) {
    var lista = tipo === 'entrada' ? state.entradas : state.saidas;
    var item = lista.filter(function (l) { return l.linha === linha; })[0];
    if (!item) return;
    var marcado = item.descricao.indexOf(MARCA) === 0;
    acaoCtx = { tipo: tipo, linha: linha, marcado: marcado };
    $('acoes-desc').textContent = stripMarca(item.descricao);
    $('acoes-det').textContent = fmtDataBR(item.data) + '/' + String(item.data).slice(0, 4) + ' · ' +
      (item.categoria || 'Sem categoria') + ' · ' + fmtBRL.format(item.valor) +
      (item.conta ? ' · ' + item.conta : '');
    var btnPago = $('acao-pago');
    var podePago = tipo === 'saida' && temTogglePago(item);
    btnPago.hidden = !podePago;
    btnPago.textContent = marcado ? 'Desmarcar pago/enviado' : 'Marcar como pago/enviado';
    var dlg = $('modal-acoes');
    if (dlg && dlg.showModal) dlg.showModal();
  }

  // ------------------------------------------------------------ dashboard
  function renderDashboard() {
    var totE = state.entradas.reduce(function (s, l) { return s + l.valor; }, 0);
    var totS = state.saidas.reduce(function (s, l) { return s + l.valor; }, 0);
    renderBarra(totE, totS);
    renderKpis(totE, totS);
    renderComparativo();
  }

  function renderBarra(totE, totS) {
    var barra = $('barra-dist');
    var leg = $('barra-legenda');
    var total = totE + totS;
    if (total <= 0) {
      $('barra-entrada').style.width = '0%';
      $('barra-saida').style.width = '0%';
      leg.innerHTML = '<span class="vazio">Sem movimentos neste mês.</span>';
      return;
    }
    var pctE = Math.round(totE / total * 100);
    $('barra-entrada').style.width = pctE + '%';
    $('barra-saida').style.width = (100 - pctE) + '%';
    leg.innerHTML = '<span class="e">▲ <b>' + fmtBRL.format(totE) + '</b> · ' + pctE + '%</span>' +
      '<span class="s"><b>' + fmtBRL.format(totS) + '</b> ▼ · ' + (100 - pctE) + '%</span>';
  }

  function renderKpis(totE, totS) {
    var box = $('insights');
    var html = [];
    var porCat = {};
    var saidasInsight = state.saidas.filter(function (l) {
      // insights ignoram lançamentos de liquidação/acumulado (ex.: ajuste de
      // saldo), para não distorcer categoria top / maior saída
      return !l.categoria || l.categoria.toLowerCase() !== 'acumulado';
    });
    saidasInsight.forEach(function (l) {
      var c = l.categoria || 'Sem categoria';
      porCat[c] = (porCat[c] || 0) + l.valor;
    });
    var topCat = null;
    Object.keys(porCat).forEach(function (c) {
      if (!topCat || porCat[c] > topCat.valor) topCat = { nome: c, valor: porCat[c] };
    });
    var maior = saidasInsight.slice().sort(function (a, b) { return b.valor - a.valor; })[0];

    function kpi(rot, val, sub, extra) {
      html.push('<div class="kpi' + (extra ? ' ' + extra : '') + '">' +
        '<span class="kpi-rot">' + rot + '</span>' +
        '<span class="kpi-val">' + val + '</span>' +
        (sub ? '<span class="kpi-sub">' + sub + '</span>' : '') + '</div>');
    }

    if (topCat && topCat.valor > 0) {
      kpi('Categoria top', esc(topCat.nome), fmtBRL.format(topCat.valor) + ' · ' +
        Math.round(topCat.valor / totS * 100) + '% das saídas');
    }
    if (maior && maior.valor > 0) {
      kpi('Maior saída', esc(maior.descricao), fmtBRL.format(maior.valor));
    }
    if (totE > 0) {
      var comp = Math.round(totS / totE * 100);
      kpi('Comprometimento', comp + '%', 'das entradas em saídas',
        comp >= 100 ? 'neg' : 'pos');
    }
    if (totS > 0) {
      kpi('Média diária', fmtBRL.format(totS / new Date().getDate()), 'de gasto');
    }

    box.innerHTML = html.length ? html.join('') : '';
    box.hidden = !html.length;
    if (!html.length) return;
    var celulas = box.querySelectorAll ? box.querySelectorAll('.kpi-val') : [];
    for (var i = 0; i < celulas.length; i++) {
      if (celulas[i].scrollWidth > celulas[i].clientWidth) {
        var pai = celulas[i].parentNode;
        if (pai) pai.title = celulas[i].textContent;
      }
    }
  }

  var compState = { mes: null, dados: null };
  function carregarComparativo(mes) {
    var idx = state.meses.indexOf(mes);
    if (idx <= 0) { compState = { mes: mes, dados: null }; renderComparativo(); return; }
    var ant = state.meses[idx - 1];
    var c = cacheGet('lan_' + ant);
    if (c) { compState = { mes: mes, dados: c }; renderComparativo(); }
    chamar('lancamentos', { mes: ant }).then(function (r) {
      if (!r.ok) return;
      var dados = { existe: !!r.existe, entradas: r.entradas || [], saidas: r.saidas || [] };
      cacheSet('lan_' + ant, dados);
      if (state.mes === mes) { compState = { mes: mes, dados: dados }; renderComparativo(); }
    }).catch(function () {});
  }

  function renderComparativo() {
    var box = $('comparativo');
    if (!compState.dados || compState.mes !== state.mes) { box.innerHTML = ''; return; }
    var aT = compState.dados.entradas.reduce(function (s, l) { return s + l.valor; }, 0);
    var aS = compState.dados.saidas.reduce(function (s, l) { return s + l.valor; }, 0);
    var tE = state.entradas.reduce(function (s, l) { return s + l.valor; }, 0);
    var tS = state.saidas.reduce(function (s, l) { return s + l.valor; }, 0);
    var idx = state.meses.indexOf(state.mes);
    var nomeAnt = idx > 0 ? state.meses[idx - 1] : '';
    function delta(atual, ant) {
      if (!ant) return null;
      if (ant === 0) return atual > 0 ? 'novo' : null;
      return Math.round((atual - ant) / ant * 100);
    }
    var partes = [];
    function pct(d) { return d === 'novo' ? 'novo' : (d >= 0 ? '+' + d : String(d)) + '%'; }
    var dE = delta(tE, aT);
    if (dE !== null) partes.push('▲ ' + pct(dE));
    var dS = delta(tS, aS);
    if (dS !== null) partes.push('▼ ' + pct(dS));
    if (!partes.length) { box.innerHTML = ''; return; }
    box.innerHTML = 'vs ' + esc(nomeAnt) + ': ' + partes.join(' · ');
  }

  function limparFiltros() {
    state.filtro = { tipo: 'todos', categoria: '', conta: '', busca: '' };
    state.limiteLista = LISTA_INICIAL;
    $('filtro-tipo').value = 'todos';
    $('filtro-conta').value = '';
    $('filtro-categoria').value = '';
    $('filtro-busca').value = '';
  }

  // ------------------------------------------------------------ ações de dados
  function criarMes(mes) {
    chamar('novoMes', { mes: mes }).then(function (r) {
      if (!r.ok) { toast('Erro: ' + r.erro); return; }
      // mês recém-criado é o mais novo: entra no fim. A ordem é a de criação
      // (mesma do servidor) e define quais meses somam no caixa acumulado
      if (!state.meses.length || state.meses.indexOf(mes) < 0) state.meses.push(r.mes || mes);
      toast('Aba "' + mes + '" criada!');
      selecionarMes(r.mes || mes);
    }).catch(function (e) { toast('Erro: ' + e.message); });
  }

  function salvarLancamento(dados) {
    if (state.salvando) return; // trava toque duplo: evita duplicar por submit concorrente
    state.salvando = true;

    var editando = state.editando;
    var eraEdicao = !!editando;
    var tipo = dados.tipo;
    var mudouTipo = eraEdicao && editando.tipo !== tipo;
    var mesOrigem = state.mes;
    var mesDestino = eraEdicao ? state.mes : mesDaData(dados.data);

    // preserva a marca "✓" (pago/enviado) ao editor uma despesa já marcada:
    // a caixa de edição mostra sem o prefixo, mas ao salvar mantemos a marca
    // (a menos que o usuário tenha digitado manualmente uma nova começando com ✓).
    if (eraEdicao && tipo === 'saida' && editando.tipo === 'saida') {
      var antes = state.saidas.filter(function (l) { return l.linha === editando.linha; })[0];
      if (antes && antes.descricao.indexOf(MARCA) === 0 && dados.descricao.indexOf(MARCA) !== 0) {
        dados.descricao = MARCA + dados.descricao;
      }
    }

    var item = {
      // em edição SEM mudar tipo mantém a linha real; mudando tipo usa linha
      // provisória (o item é remoção no tipo antigo + adição no novo);
      // em item novo usa provisória até o servidor responder.
      linha: (eraEdicao && !mudouTipo) ? editando.linha : -Date.now(),
      data: dados.data,
      descricao: dados.descricao,
      categoria: dados.categoria,
      conta: dados.conta,
      valor: dados.valor,
      _tipo: tipo
    };

    // ---- otimista: aplica na lista e renderiza já (não confirma, só a UI) ----
    if (eraEdicao && !mudouTipo) {
      var listaE = (tipo === 'entrada' ? state.entradas : state.saidas);
      for (var i = 0; i < listaE.length; i++) {
        if (listaE[i].linha === editando.linha) { listaE[i] = item; break; }
      }
    } else if (eraEdicao && mudouTipo) {
      // removo do tipo antigo (linha real lá) e entro no novo tipo
      var listaAntiga = (editando.tipo === 'entrada' ? state.entradas : state.saidas);
      state[editando.tipo === 'entrada' ? 'entradas' : 'saidas'] =
        listaAntiga.filter(function (l) { return l.linha !== editando.linha; });
      (tipo === 'entrada' ? state.entradas : state.saidas).push(item);
    } else if (mesDestino === mesOrigem) {
      (tipo === 'entrada' ? state.entradas : state.saidas).push(item);
    }
    state.editando = null;
    fecharModal();
    renderTudo();
    syncStatus(true, 'salvando…');

    // SÓ confirma sucesso DEPOIS da resposta real do servidor — assim o toast
    // e o cache nunca "mentem": se o servidor rejeitar (sem rede, timeout, etc.),
    // o usuário vê o erro e o cache NÃO sai cheio. Mudar o tipo de um item:
    // como na planilha entrada/saída ficam em colunas diferentes, faz-se
    // ADICIONAR no tipo novo + EXCLUIR no tipo antigo (serializado).
    var base = { mes: mesDestino };
    var prom;
    if (eraEdicao && !mudouTipo) {
      prom = chamar('atualizar', Object.assign({}, base, editando, dados));
    } else if (eraEdicao && mudouTipo) {
      prom = chamar('adicionar', Object.assign({}, base, dados))
        .then(function (r) {
          if (!r.ok) return r;
          // grava a linha real no item recem-adicionado
          var listaN = (tipo === 'entrada' ? state.entradas : state.saidas);
          for (var j = 0; j < listaN.length; j++) {
            if (listaN[j].linha === item.linha) { listaN[j].linha = r.linha; break; }
          }
          salvarCacheMes();
          return chamar('excluir', { mes: state.mes, tipo: editando.tipo, linha: editando.linha });
        });
    } else {
      prom = chamar('novoMes', { mes: mesDestino })
        .then(function (r) {
          if (!r.ok) return r;
          return chamar('adicionar', Object.assign({}, base, dados));
        });
    }

    prom.then(function (r) {
      syncStatus(false);
      state.salvando = false;
      if (!r.ok) {
        toast('Erro ao salvar: ' + (r.erro || 'tente criar a aba do mês antes.'));
        recarregarMes(); // desfaz o otimista com o que está no servidor
        return;
      }
      // adicionar simples confirmado → grava a linha real no item provisório
      if (!eraEdicao && r.linha) {
        var listaN2 = (tipo === 'entrada' ? state.entradas : state.saidas);
        for (var j2 = 0; j2 < listaN2.length; j2++) {
          if (listaN2[j2].linha === item.linha) { listaN2[j2].linha = r.linha; break; }
        }
      }
      if (!eraEdicao && state.meses.indexOf(mesDestino) < 0) state.meses.push(mesDestino);
      if (!eraEdicao && mesDestino !== mesOrigem) {
        toast('Adicionado em ' + mesDestino + '!');
        selecionarMes(mesDestino);
        return;
      }
      salvarCacheMes();
      renderTudo();
      toast(eraEdicao ? 'Atualizado!' : 'Adicionado!');
      atualizarAcumulado(); // o mês aberto entra no caixa acumulado
    }).catch(function (e) {
      syncStatus(false);
      state.salvando = false;
      toast('Erro ao salvar: ' + e.message);
      recarregarMes(); // desfaz o otimista: o cache volta a refletir o servidor
    });
  }

  // Marca "✓" no lançamento: guarda como prefixo na descrição (sem mexer no
  // backend/planilha — só o texto). Só despesas de Dízimo/Custos têm o toggle.
  var MARCA = '✓ ';
  function temTogglePago(l) {
    if (!l || l.tipo === 'entrada' || l._tipo === 'entrada') return false;
    var c = String(l.categoria || '').toLowerCase();
    return c === 'dízimo' || c === 'custos';
  }
  function stripMarca(d) {
    return (d != null && d.indexOf(MARCA) === 0) ? d.slice(MARCA.length) : d;
  }

  function marcarPago(tipo, linha) {
    if (tipo !== 'saida') return;
    var item = state.saidas.filter(function (l) { return l.linha === linha; })[0];
    if (!item || !temTogglePago(item)) return;
    var novoDesc = item.descricao.indexOf(MARCA) === 0 ? stripMarca(item.descricao) : (MARCA + stripMarca(item.descricao));
    var dados = {
      tipo: tipo,
      data: item.data,
      descricao: novoDesc,
      categoria: item.categoria,
      conta: item.conta,
      valor: item.valor
    };
    syncStatus(true, 'salvando…');
    chamar('atualizar', Object.assign({ mes: state.mes, tipo: tipo, linha: linha }, dados)).then(function (r) {
      syncStatus(false);
      if (!r.ok) { toast('Erro ao marcar: ' + (r.erro || 'erro')); recarregarMes(); return; }
      item.descricao = novoDesc;
      salvarCacheMes();
      renderLista();
      toast(novoDesc.indexOf(MARCA) === 0 ? 'Marcado como pago/enviado ✓' : 'Marcação removida');
    }).catch(function (e) {
      syncStatus(false);
      toast('Erro ao marcar: ' + e.message);
      recarregarMes();
    });
  }

  function excluir(tipo, linha) {
    var item = (tipo === 'entrada' ? state.entradas : state.saidas)
      .filter(function (l) { return l.linha === linha; })[0];
    var desc = item ? item.descricao : 'este lançamento';
    if (!confirm('Excluir "' + desc + '"?')) return;
    // ---- otimista ----
    state[tipo === 'entrada' ? 'entradas' : 'saidas'] =
      (tipo === 'entrada' ? state.entradas : state.saidas)
        .filter(function (l) { return l.linha !== linha; });
    state.limiteLista = LISTA_INICIAL; // lista encurtou: sem "Mostrar menos" fantasma
    salvarCacheMes();
    renderTudo();
    toast('Excluído!');
    // ---- confirma no servidor ----
    syncStatus(true, 'excluindo…');
    chamar('excluir', { mes: state.mes, tipo: tipo, linha: linha }).then(function (r) {
      syncStatus(false);
      if (!r.ok) { toast('Erro: ' + r.erro); recarregarMes(); return; }
      atualizarAcumulado(); // o item saiu do mês aberto: o acumulado muda
    }).catch(function (e) {
      syncStatus(false);
      toast('Erro: ' + e.message);
      recarregarMes();
    });
  }

  // ------------------------------------------------------------ modal

  // ---- atalhos "1 toque": preenche Conta/Categoria sem digitar ----
  function preencherChipsRapidos() {
    var boxConta = $('chips-conta');
    var boxCat = $('chips-categoria');
    if (!boxConta || !boxCat) return; // (nós ausentes em testes/mock)

    function montar(container, itens) {
      if (!itens.length) { container.hidden = true; container.innerHTML = ''; return; }
      container.hidden = false;
      container.innerHTML = itens.map(function (v) {
        return '<button type="button" class="chip-rapido" data-val="' + esc(v) + '">' + esc(v) + '</button>';
      }).join('');
    }
    function ligar(box, input) {
      Array.prototype.forEach.call(box.querySelectorAll('.chip-rapido'), function (b) {
        b.addEventListener('click', function () {
          input.value = b.dataset.val;
          Array.prototype.forEach.call(box.querySelectorAll('.chip-rapido'), function (x) {
            x.classList.toggle('ativo', x === b);
          });
        });
      });
    }
    function marcar(box, val) {
      if (!val) return;
      Array.prototype.forEach.call(box.querySelectorAll('.chip-rapido'), function (x) {
        x.classList.toggle('ativo', x.dataset.val === val);
      });
    }

    // contas do lançamento: Pix / Cartão ou Dinheiro
    montar(boxConta, ['Pix / Cartão', 'Dinheiro']);
    // categorias: mais usadas no mês primeiro; depois as demais (limite 8)
    var peso = {};
    state.entradas.concat(state.saidas).forEach(function (l) {
      if (l.categoria) peso[l.categoria] = (peso[l.categoria] || 0) + l.valor;
    });
    var cats = Object.keys(peso).sort(function (a, b) { return peso[b] - peso[a]; });
    state.categorias.forEach(function (c) { if (cats.indexOf(c) < 0) cats.push(c); });
    montar(boxCat, cats.slice(0, 8));

    ligar(boxConta, $('f-conta'));
    ligar(boxCat, $('f-categoria'));
    marcar(boxConta, $('f-conta').value);
    marcar(boxCat, $('f-categoria').value);
  }

  function abrirModal(modo, tipo, linha) {
    state.editando = null;
    $('f-data').value = hojeISO();
    $('f-descricao').value = '';
    $('f-categoria').value = '';
    $('f-conta').value = '';
    $('f-valor').value = '';
    setTipo(tipo || 'saida');
    $('modal-titulo').textContent = 'Novo lançamento';

    if (modo === 'editar') {
      var lista = (tipo === 'entrada' ? state.entradas : state.saidas);
      var item = lista.filter(function (l) { return l.linha === linha; })[0];
      if (!item) return;
      $('f-data').value = item.data;
      $('f-descricao').value = stripMarca(item.descricao);
      $('f-categoria').value = item.categoria;
      $('f-conta').value = item.conta;
      $('f-valor').value = fmtBRL.format(item.valor).replace('R$', '').trim();
      $('modal-titulo').textContent = 'Editar lançamento';
      state.editando = { tipo: tipo, linha: linha };
    }

    preencherChipsRapidos(); // atalhos de Conta/Categoria (1 toque)

    $('modal').showModal();
    $('f-descricao').focus();
  }

  function fecharModal() {
    if ($('modal').open) $('modal').close();
  }

  function setTipo(tipo) {
    Array.prototype.forEach.call(document.querySelectorAll('.tipo-btn'), function (b) {
      b.classList.toggle('ativo', b.dataset.tipo === tipo);
    });
  }

  // ------------------------------------------------------------ eventos
  function novoLancamento() {
    if (!state.existe && !state.meses.length) {
      toast('Crie a aba do mês primeiro (botão ＋).');
      return;
    }
    if (!state.existe) {
      if (!confirm('A aba "' + state.mes + '" não existe. Criar agora?')) return;
      criarMes(state.mes);
      return;
    }
    abrirModal('novo', null, null);
  }

  $('btn-novo-fab').addEventListener('click', novoLancamento);

  $('btn-novo-mes').addEventListener('click', function () {
    var nome = prompt('Nome do mês (ex.: Janeiro, Fevereiro…):');
    if (!nome || !nome.trim()) return;
    criarMes(nome.trim());
  });

  $('btn-cancelar').addEventListener('click', function () {
    state.editando = null;
    fecharModal();
  });
  $('modal').addEventListener('click', function (e) {
    if (e.target === $('modal')) { state.editando = null; fecharModal(); }
  });

  document.querySelectorAll('.tipo-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      setTipo(b.dataset.tipo);
    });
  });

  $('form-lancamento').addEventListener('submit', function (e) {
    e.preventDefault();
    var tipo = document.querySelector('.tipo-btn.ativo').dataset.tipo;
    var valor = parseValor($('f-valor').value);
    var dados = {
      tipo: tipo,
      data: $('f-data').value,
      descricao: $('f-descricao').value.trim(),
      categoria: $('f-categoria').value.trim(),
      conta: $('f-conta').value.trim(),
      valor: valor
    };
    if (!dados.data) { toast('Informe a data.'); return; }
    if (!dados.descricao) { toast('Informe a descrição.'); return; }
    if (valor <= 0) { toast('Informe um valor maior que zero.'); return; }
    salvarLancamento(dados);
  });

  document.querySelectorAll('.campo-valor').forEach(function (input) {
    input.addEventListener('focus', function () {
      prepararValorInput(input);
      input.select();
      input._valorSelecionado = true;
    });
    input.addEventListener('keydown', function (e) {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        if (input._valorSelecionado) input._valorDigitos = '';
        input._valorSelecionado = false;
        input._valorDigitos = (input._valorDigitos || '') + e.key;
        renderValorMascara(input);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        input._valorSelecionado = false;
        input._valorDigitos = (input._valorDigitos || '').slice(0, -1);
        renderValorMascara(input);
      } else if (e.key === '.' || e.key === ',') {
        e.preventDefault();
      }
    });
    input.addEventListener('paste', function () {
      setTimeout(function () {
        input._valorDigitos = input.value.replace(/\D/g, '');
        input._valorSelecionado = false;
        renderValorMascara(input);
      }, 0);
    });
  });

  ['filtro-tipo', 'filtro-categoria', 'filtro-conta'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.filtro.tipo = $('filtro-tipo').value;
      state.filtro.categoria = $('filtro-categoria').value;
      state.filtro.conta = $('filtro-conta').value;
      state.limiteLista = LISTA_INICIAL; // filtro novo volta ao começo da lista
      renderLista();
    });
  });

  $('filtro-busca').addEventListener('input', function () {
    state.filtro.busca = this.value;
    state.limiteLista = LISTA_INICIAL;
    renderLista();
  });

  $('btn-tema').addEventListener('click', function () {
    aplicarTema(document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro');
  });

  // ------------------------------------------------------------ aba Arrecadação
  var CHA_CUSTOS = { '3d': 5, '2d': 2, 'ab': 1 }; // custo/un chaveiros
  var CHA_TIPO = 'chaveiros';                      // 'chaveiros' | 'brownie'
  function chaBRL(v) {
    return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function chaQtd(id) {
    var v = parseInt($(id).value, 10);
    return isFinite(v) && v > 0 ? v : 0;
  }
  function chaVal(id) {
    return parseValor($(id).value) || 0;
  }

  // ---- "quanto levei": persiste localmente (não redigitar ao voltar) ----
  var CHA_LEVOU_KEY = 'chaLevou';
  function chaSalvarLevou() {
    cacheSet(CHA_LEVOU_KEY, {
      '3d': chaQtd('cha-levou-3d'),
      '2d': chaQtd('cha-levou-2d'),
      'ab': chaQtd('cha-levou-ab')
    });
  }
  function chaRestaurarLevou() {
    var s = cacheGet(CHA_LEVOU_KEY);
    if (!s) return;
    if (typeof s['3d'] === 'number') $('cha-levou-3d').value = s['3d'] || '';
    if (typeof s['2d'] === 'number') $('cha-levou-2d').value = s['2d'] || '';
    if (typeof s['ab'] === 'number') $('cha-levou-ab').value = s['ab'] || '';
  }

  // alterna o contexto da arrecadação: chaveiros ou brownie
  function chaSetTipo(t) {
    CHA_TIPO = (t === 'brownie') ? 'brownie' : 'chaveiros';
    document.querySelectorAll('.cha-tipo-btn').forEach(function (b) {
      b.classList.toggle('ativo', b.dataset.chaTipo === CHA_TIPO);
    });
    var ck = $('cha-chaveiros-block');
    var bk = $('cha-brownie-block');
    if (ck) ck.hidden = (CHA_TIPO !== 'chaveiros');
    if (bk) bk.hidden = (CHA_TIPO !== 'brownie');
    // descarta um cálculo anterior (evita lançar no contexto errado)
    var res = $('cha-resumo'), lc = $('cha-lancar');
    if (res) { res.hidden = true; res.innerHTML = ''; }
    if (lc) lc.hidden = true;
    state.chaveiros = null;
  }

  function visualizar(viz) {
    document.querySelectorAll('#viz .viz-btn').forEach(function (b) {
      b.classList.toggle('ativo', b.dataset.viz === viz);
    });
    var chaSec = $('chaveiros-section');
    document.querySelectorAll('main > section').forEach(function (s) {
      if (s.id === 'chaveiros-section') s.hidden = (viz !== 'cha');
      else s.style.display = (viz === 'cha') ? 'none' : '';
    });
    // na Arrecadação o lançamento é feito pelo próprio formulário da aba
    $('btn-novo-fab').hidden = (viz === 'cha');
  }

  // Helper do resumo da arrecadação (rótulo + valor + detalhe opcional).
  function chaLinha(rot, val, sub, cls) {
    return '<div class="linha' + (cls ? ' ' + cls : '') + '">' +
      '<span class="linha-rot">' + rot + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
      '<span class="linha-val">' + val + '</span></div>';
  }

  // O Total do Dia é a receita do dia = Pix + Físico + Alimentação: o dinheiro
  // da comida saiu do que foi arrecadado, então entra no total (e no detalhe).
  function chaReceitaDia(pix, fisico, alimentacao) {
    return pix + fisico + alimentacao;
  }
  function chaDetTotalDia(pix, fisico, alimentacao) {
    return 'Pix ' + chaBRL(pix) + ' · Físico ' + chaBRL(fisico) +
      (alimentacao > 0 ? ' · Alimentação ' + chaBRL(alimentacao) : '');
  }

  function chaCalcular() {
    if (CHA_TIPO === 'brownie') { chaCalcularBrownie(); return; }
    var vendas = {
      '3d': Math.max(0, chaQtd('cha-levou-3d') - chaQtd('cha-voltou-3d')),
      '2d': Math.max(0, chaQtd('cha-levou-2d') - chaQtd('cha-voltou-2d')),
      'ab': Math.max(0, chaQtd('cha-levou-ab') - chaQtd('cha-voltou-ab'))
    };
    var custo = vendas['3d'] * CHA_CUSTOS['3d'] + vendas['2d'] * CHA_CUSTOS['2d'] + vendas['ab'] * CHA_CUSTOS['ab'];
    var receitaPix = chaVal('cha-pix');
    var receitaFis = chaVal('cha-fisico');
    var alimentacao = chaVal('cha-alimentacao');
    var transporte = chaVal('cha-transporte');
    var receita = chaReceitaDia(receitaPix, receitaFis, alimentacao);
    // dízimo = 10% do que sobra APÓS descontar o custo da mercadoria
    // (ex.: 3D de R$20 com custo R$5 -> 10% de R$15 = R$1,50). Nunca negativo.
    var dizimo = Math.max(0, Math.round((receita - custo) * 0.10 * 100) / 100);
    var nome = ($('cha-nome') ? $('cha-nome').value : '').trim();
    if (receita <= 0 && custo === 0) {
      toast('Informe o total do dia e/ou as quantidades.');
      return;
    }
    state.chaveiros = { nome: nome, vendas: vendas, custo: custo, receita: receita, receitaPix: receitaPix, receitaFis: receitaFis, dizimo: dizimo, alimentacao: alimentacao, transporte: transporte };
    var lucro = receita - custo;                                        // bruto (antes do dízimo)
    var liquido = Math.max(0, lucro - dizimo - alimentacao - transporte); // o que sobra após dízimo + alimentação + transporte
    var vendidos = vendas['3d'] + vendas['2d'] + vendas['ab'];
    var linhas = '';
    if (nome) linhas += chaLinha('QUEM ARRECADOU', nome);
    linhas += chaLinha('VENDIDOS', String(vendidos),
      '3D ' + vendas['3d'] + ' · 2D ' + vendas['2d'] + ' · Abridor ' + vendas['ab']);
    linhas += chaLinha('TOTAL DO DIA', chaBRL(receita),
      chaDetTotalDia(receitaPix, receitaFis, alimentacao));
    linhas += chaLinha('CUSTO DOS MATERIAIS', chaBRL(custo));
    linhas += chaLinha('DÍZIMO (10% DA MARGEM)', chaBRL(dizimo));
    linhas += chaLinha('ALIMENTAÇÃO', chaBRL(alimentacao));
    linhas += chaLinha('TRANSPORTE', chaBRL(transporte));
    var lucroCls = lucro >= 0 ? 'lucro-positivo' : 'lucro-negativo';
    var liquidoCls = liquido >= 0 ? 'lucro-positivo' : 'lucro-negativo';
    linhas += chaLinha('LUCRO BRUTO', '<b class="' + lucroCls + '">' + chaBRL(lucro) + '</b>', '', 'tot');
    linhas += chaLinha('LÍQUIDO (APÓS DÍZIMO)', '<b class="' + liquidoCls + '">' + chaBRL(liquido) + '</b>', '', 'tot');
    $('cha-resumo').innerHTML = linhas;
    $('cha-resumo').hidden = false;
    $('cha-lancar').hidden = false;
    $('cha-lancar').disabled = false;
  }

  // ---- brownie: custo unitário padrão ~R$ 1,40 (editável) ----
  function chaCalcularBrownie() {
    var vendidos = Math.max(0, chaQtd('cha-b-levou') - chaQtd('cha-b-voltou'));
    var custoUn = chaVal('cha-b-custo') || 0;
    var custo = Math.round(vendidos * custoUn * 100) / 100;
    var receitaPix = chaVal('cha-pix');
    var receitaFis = chaVal('cha-fisico');
    var alimentacao = chaVal('cha-alimentacao');
    var transporte = chaVal('cha-transporte');
    var receita = chaReceitaDia(receitaPix, receitaFis, alimentacao);
    // dízimo = 10% do que sobra APÓS descontar o custo da mercadoria
    var dizimo = Math.max(0, Math.round((receita - custo) * 0.10 * 100) / 100);
    var nome = ($('cha-nome') ? $('cha-nome').value : '').trim();
    if (receita <= 0 && custo === 0) {
      toast('Informe o total do dia e/ou as quantidades.');
      return;
    }
    state.chaveiros = { tipo: 'brownie', nome: nome, vendidos: vendidos, custo: custo, receita: receita, receitaPix: receitaPix, receitaFis: receitaFis, dizimo: dizimo, alimentacao: alimentacao, transporte: transporte };
    var lucro = receita - custo;
    var liquido = Math.max(0, lucro - dizimo - alimentacao - transporte);
    var linhas = '';
    if (nome) linhas += chaLinha('QUEM ARRECADOU', nome);
    linhas += chaLinha('VENDIDOS', String(vendidos) + ' brownie(s)', 'custo ' + chaBRL(custoUn) + '/un');
    linhas += chaLinha('TOTAL DO DIA', chaBRL(receita),
      chaDetTotalDia(receitaPix, receitaFis, alimentacao));
    linhas += chaLinha('CUSTO DOS MATERIAIS', chaBRL(custo));
    linhas += chaLinha('DÍZIMO (10% DA MARGEM)', chaBRL(dizimo));
    linhas += chaLinha('ALIMENTAÇÃO', chaBRL(alimentacao));
    linhas += chaLinha('TRANSPORTE', chaBRL(transporte));
    var lucroCls = lucro >= 0 ? 'lucro-positivo' : 'lucro-negativo';
    var liquidoCls = liquido >= 0 ? 'lucro-positivo' : 'lucro-negativo';
    linhas += chaLinha('LUCRO BRUTO', '<b class="' + lucroCls + '">' + chaBRL(lucro) + '</b>', '', 'tot');
    linhas += chaLinha('LÍQUIDO (APÓS DÍZIMO)', '<b class="' + liquidoCls + '">' + chaBRL(liquido) + '</b>', '', 'tot');
    $('cha-resumo').innerHTML = linhas;
    $('cha-resumo').hidden = false;
    $('cha-lancar').hidden = false;
    $('cha-lancar').disabled = false;
  }

  function chaLancar() {
    var c = state.chaveiros;
    if (!c) return;
    var data = hojeISO();
    // a arrecadação não tem campo de data: usa a data de hoje, então pertence
    // ao mês dessa data (e não ao mês que estiver aberto na aba Financeiro).
    var mesDestino = mesDaData(data);
    var base = { mes: mesDestino, data: data };
    var quem = c.nome ? ' — ' + c.nome : '';
    // Todo lançamento gerado pela aba leva o nome de quem arrecadou no fim do
    // parêntese: "Venda de chaveiros (arrecadação — Joana)",
    // "Dízimo (venda de chaveiros — Joana)", "Custo chaveiros (mercadoria — Joana)"…
    function comNome(base) {
      return quem ? base.replace(/\)$/, quem + ')') : base;
    }
    var itens;
    if (c.tipo === 'brownie') {
      itens = [];
      if (c.receitaPix > 0) itens.push({ tipo: 'entrada', descricao: comNome('Venda de brownie (arrecadação)'), categoria: 'Vendas', conta: 'Pix', valor: c.receitaPix });
      if (c.receitaFis > 0) itens.push({ tipo: 'entrada', descricao: comNome('Venda de brownie (arrecadação)'), categoria: 'Vendas', conta: 'Físico', valor: c.receitaFis });
      if (c.custo > 0) itens.push({ tipo: 'saida', descricao: comNome('Custo brownie (mercadoria)'), categoria: 'Custos Brownie', conta: 'Pix', valor: c.custo });
      if (c.dizimo > 0) itens.push({ tipo: 'saida', descricao: comNome('Dízimo (venda de brownie)'), categoria: 'Dízimo', conta: 'Pix', valor: c.dizimo });
      if (c.alimentacao > 0) itens.push({ tipo: 'saida', descricao: comNome('Alimentação (venda de brownie)'), categoria: 'Alimentação', conta: 'Físico', valor: c.alimentacao });
      if (c.transporte > 0) itens.push({ tipo: 'saida', descricao: comNome('Transporte (venda de brownie)'), categoria: 'Transporte', conta: 'Físico', valor: c.transporte });
    } else {
      itens = [];
      if (c.receitaPix > 0) itens.push({ tipo: 'entrada', descricao: comNome('Venda de chaveiros (arrecadação)'), categoria: 'Vendas', conta: 'Pix', valor: c.receitaPix });
      if (c.receitaFis > 0) itens.push({ tipo: 'entrada', descricao: comNome('Venda de chaveiros (arrecadação)'), categoria: 'Vendas', conta: 'Físico', valor: c.receitaFis });
      if (c.custo > 0) itens.push({ tipo: 'saida', descricao: comNome('Custo chaveiros (mercadoria)'), categoria: 'Custos', conta: 'Pix', valor: c.custo });
      if (c.dizimo > 0) itens.push({ tipo: 'saida', descricao: comNome('Dízimo (venda de chaveiros)'), categoria: 'Dízimo', conta: 'Pix', valor: c.dizimo });
      if (c.alimentacao > 0) itens.push({ tipo: 'saida', descricao: comNome('Alimentação (venda de chaveiros)'), categoria: 'Alimentação', conta: 'Físico', valor: c.alimentacao });
      if (c.transporte > 0) itens.push({ tipo: 'saida', descricao: comNome('Transporte (venda de chaveiros)'), categoria: 'Transporte', conta: 'Físico', valor: c.transporte });
    }
    if (!itens.length) { toast('Nada a lançar.'); return; }
    $('cha-lancar').disabled = true;
    syncStatus(true, 'lançando…');
    var prom = chamar('novoMes', { mes: mesDestino }).then(function (r) {
      if (!r.ok) return r;
      var p = Promise.resolve();
      itens.forEach(function (it) {
        p = p.then(function () {
          return chamar('adicionar', Object.assign({}, base, it));
        });
      });
      return p;
    });
    prom.then(function (r) {
      syncStatus(false);
      if (!r.ok) throw new Error(r.erro || 'não foi possível lançar na planilha.');
      if (state.meses.indexOf(mesDestino) < 0) state.meses.push(mesDestino);
      toast(itens.length + ' lançamento(s) gravados' + (mesDestino !== state.mes ? ' em ' + mesDestino : '') + '!');
      $('cha-lancar').hidden = true;
      $('cha-resumo').hidden = true;
      ['cha-nome','cha-levou-3d','cha-levou-2d','cha-levou-ab','cha-voltou-3d','cha-voltou-2d','cha-voltou-ab',
       'cha-b-levou','cha-b-voltou',
       'cha-pix','cha-fisico','cha-alimentacao','cha-transporte'].forEach(function (id) { $(id).value = ''; });
      state.chaveiros = null;
      if (mesDestino !== state.mes) {
        selecionarMes(mesDestino); // troca para o mês dono da data e recarrega do servidor
      } else {
        salvarCacheMes();
        recarregarMes(); // recarrega o mês para os lançamentos aparecerem
      }
      visualizar('fin');
    }).catch(function (e) {
      syncStatus(false);
      $('cha-lancar').disabled = false;
      toast('Erro ao lançar: ' + e.message);
      recarregarMes();
    });
  }

  // handlers da aba Arrecadação
  document.querySelectorAll('#viz .viz-btn').forEach(function (b) {
    b.addEventListener('click', function () { visualizar(b.dataset.viz); });
  });
  document.querySelectorAll('.cha-tipo-btn').forEach(function (b) {
    b.addEventListener('click', function () { chaSetTipo(b.dataset.chaTipo); });
  });
  $('cha-calcular').addEventListener('click', chaCalcular);
  $('cha-lancar').addEventListener('click', chaLancar);
  ['cha-levou-3d', 'cha-levou-2d', 'cha-levou-ab'].forEach(function (id) {
    $(id).addEventListener('input', chaSalvarLevou);
  });
  chaRestaurarLevou(); // preenche "Levou" com o que ficou salvo (não redigitar na volta)

  // folha de ações da linha do extrato (Editar / Pago / Excluir / Cancelar)
  var dlgAcoes = $('modal-acoes');
  if (dlgAcoes) {
    dlgAcoes.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-acao]') : null;
      var alvo = b ? b.dataset.acao : (ev.target === dlgAcoes ? 'cancelar' : '');
      if (!alvo) return;
      dlgAcoes.close();
      var ctx = acaoCtx;
      acaoCtx = null;
      if (!ctx) return;
      if (alvo === 'editar') abrirModal('editar', ctx.tipo, ctx.linha);
      else if (alvo === 'excluir') excluir(ctx.tipo, ctx.linha);
      else if (alvo === 'pago') marcarPago('saida', ctx.linha);
    });
  }
  visualizar('fin');

  // ------------------------------------------------------------ start
  var temaInit = cacheGet('tema') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
  aplicarTema(temaInit);
  carregarInicio();
})();
