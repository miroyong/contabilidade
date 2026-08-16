// ============================================================
// CONTROLE FINANCEIRO — lógica do app
// ============================================================
(function () {
  'use strict';

  var API = window.APP_CONFIG || {};
  var SCRIPT_URL = API.APPS_SCRIPT_URL || '';
  var APP_KEY = API.APP_KEY || '';

  var state = {
    mes: null,          // aba selecionada (ex.: "Agosto")
    meses: [],          // abas existentes
    mesAtual: null,     // mês corrente (pt-BR)
    existe: true,       // a aba do mês selecionado existe?
    entradas: [],
    saidas: [],
    categorias: [],
    contas: [],
    filtro: { tipo: 'todos', categoria: '', conta: '', busca: '' },
    editando: null,     // { tipo: 'entrada'|'saida', linha: N }
    salvando: false     // trava toque duplo no salvar (evita duplicar)
  };

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
    cacheSet('lan_' + state.mes, { existe: state.existe, entradas: state.entradas, saidas: state.saidas });
  }
  function renderDoCache(mes) {
    var c = cacheGet('lan_' + mes);
    if (!c) return false;
    state.existe = !!c.existe;
    state.entradas = c.entradas || [];
    state.saidas = c.saidas || [];
    renderTudo();
    return true;
  }
  function recarregarMes() { selecionarMes(state.mes); }

  var fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // ------------------------------------------------------------ utilidades
  function chamar(action, params) {
    var corpo = Object.assign({ action: action, key: APP_KEY }, params || {});
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 90000);
    return fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo),
      signal: ctrl.signal
    }).then(function (r) {
      clearTimeout(timer);
      return r.json();
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

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ------------------------------------------------------------ tema
  function aplicarTema(t) {
    document.documentElement.dataset.tema = t;
    var btn = $('btn-tema');
    if (btn) btn.textContent = t === 'escuro' ? '☀️' : '🌙';
    cacheSet('tema', t);
  }

  // ------------------------------------------------------------ carregamento
  function carregarInicio() {
    if (!SCRIPT_URL) {
      $('aviso-config').hidden = false;
      $('btn-novo').disabled = true;
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
          $('aviso-config').textContent = 'Erro ao conectar: ' + e.message +
            '. Confira o APPS_SCRIPT_URL no config.js.';
        }
      });
  }

  function selecionarMes(mes) {
    state.mes = mes;
    state.editando = null;
    limparFiltros();
    renderDoCache(mes); // mostra na hora se houver cache
    syncStatus(true, 'atualizando…');
    chamar('lancamentos', { mes: mes })
      .then(function (r) {
        syncStatus(false);
        if (!r.ok) throw new Error(r.erro);
        state.existe = !!r.existe;
        state.entradas = r.entradas || [];
        state.saidas = r.saidas || [];
        salvarCacheMes();
        renderTudo();
        carregarComparativo(mes);
      })
      .catch(function (e) {
        syncStatus(false);
        if (!renderDoCache(state.mes)) toast('Erro ao carregar mês: ' + e.message);
      });
  }

  // contas disponíveis: apenas Pix e Físico (sempre presentes)
  function contasOpcoes() {
    var fixas = CONTAS.slice();
    state.contas.forEach(function (c) {
      if (fixas.indexOf(c) < 0 && contaChave(c)) fixas.push(c); // legado ganha a versão canônica
    });
    return fixas;
  }

  function preencherDatalists() {
    $('dl-categorias').innerHTML = state.categorias.map(function (c) {
      return '<option value="' + esc(c) + '">';
    }).join('');
    $('dl-contas').innerHTML = contasOpcoes().map(function (c) {
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

  var CONTAS = ['Pix', 'Físico'];

  // normaliza qualquer nome de conta legado para "Pix" ou "Físico"
  function contaChave(nome) {
    var s = String(nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (s.indexOf('pix') >= 0) return 'Pix';
    if (s.indexOf('fisic') >= 0) return 'Físico';
    return null; // não entra no breakdown
  }

  function renderSaldo() {
    var totE = state.entradas.reduce(function (s, l) { return s + l.valor; }, 0);
    var totS = state.saidas.reduce(function (s, l) { return s + l.valor; }, 0);
    var bal = totE - totS;

    // balanço por conta: soma entradas e saídas de cada conta
    var porConta = { 'Pix': 0, 'Físico': 0 };
    function acumula(lista, sinal) {
      lista.forEach(function (l) {
        var k = contaChave(l.conta);
        if (k && porConta.hasOwnProperty(k)) porConta[k] += sinal * l.valor;
      });
    }
    acumula(state.entradas, 1);
    acumula(state.saidas, -1);
    var outros = bal - (porConta['Pix'] + porConta['Físico']);

    $('saldo-mes').textContent = state.mes || '—';
    var v = $('saldo-valor');
    v.textContent = fmtBRL.format(bal);
    v.className = 'saldo-valor ' + (bal >= 0 ? 'positivo' : 'negativo');
    $('saldo-entradas').textContent = fmtBRL.format(totE);
    $('saldo-saidas').textContent = fmtBRL.format(totS);

    $('saldo-pix').textContent = fmtBRL.format(porConta['Pix']);
    $('saldo-fisico').textContent = fmtBRL.format(porConta['Físico']);
    $('saldo-pix').className = 'saldo-item-valor ' + (porConta['Pix'] >= 0 ? 'positivo' : 'negativo');
    $('saldo-fisico').className = 'saldo-item-valor ' + (porConta['Físico'] >= 0 ? 'positivo' : 'negativo');

    // lançamentos sem conta ("outros") ficam refletidos apenas no Total em cima
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
    btn.style.cssText = 'margin-left:6px;background:var(--azul);color:#fff;border:none;' +
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
      if (f.conta && l.conta !== f.conta) return false;
      if (f.busca && l.descricao.toLowerCase().indexOf(f.busca.toLowerCase()) < 0) return false;
      return true;
    });

    todos.sort(function (a, b) {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1;
      return b.linha - a.linha;
    });

    $('contador').textContent = todos.length;
    var box = $('lista');
    if (!todos.length) {
      box.innerHTML = '<div class="vazio">Nenhum lançamento encontrado.</div>';
      return;
    }

    box.innerHTML = todos.map(function (l) {
      var tipo = l._tipo;
      return '<div class="lanc">' +
        '<div class="lanc-data">' + fmtDataBR(l.data) + '</div>' +
        '<div class="lanc-desc">' + esc(l.descricao) + '</div>' +
        '<div class="lanc-valor ' + tipo + '">' + (tipo === 'entrada' ? '+' : '−') + ' ' +
          fmtBRL.format(l.valor) + '</div>' +
        '<div class="lanc-acoes">' +
          '<button class="btn-icone" data-edit="' + tipo + ':' + l.linha + '" title="Editar">✏️</button>' +
          '<button class="btn-icone" data-del="' + tipo + ':' + l.linha + '" title="Excluir">🗑️</button>' +
        '</div>' +
        '<div class="lanc-det">' + esc(l.categoria || '—') + ' · ' + esc(l.conta || '—') + '</div>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.edit.split(':');
        abrirModal('editar', p[0], Number(p[1]));
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.del.split(':');
        excluir(p[0], Number(p[1]));
      });
    });
  }

  // ------------------------------------------------------------ dashboard
  function renderDashboard() {
    var totE = state.entradas.reduce(function (s, l) { return s + l.valor; }, 0);
    var totS = state.saidas.reduce(function (s, l) { return s + l.valor; }, 0);
    renderPizza(totE, totS);
    renderInsights(totE, totS);
    renderComparativo();
  }

  function renderPizza(totE, totS) {
    var pizza = $('pizza-grafico');
    var rot = $('pizza-rotulos');
    var total = totE + totS;
    if (total <= 0) {
      pizza.style.background = '#e5e7eb';
      pizza.innerHTML = '<div class="pizza-centro">sem<br>movimento</div>';
      rot.innerHTML = '';
      return;
    }
    var pctE = Math.round(totE / total * 100);
    var pctS = 100 - pctE;
    var escuro = document.documentElement.dataset.tema === 'escuro';
    var corE = escuro ? '#4ade80' : '#16a34a';
    var corS = escuro ? '#f87171' : '#dc2626';
    pizza.style.background = 'conic-gradient(' + corE + ' 0 ' + pctE + '%, ' + corS + ' ' + pctE + '% 100%)';
    pizza.innerHTML = '<div class="pizza-centro">' + pctE + '%<br>entradas</div>';
    rot.innerHTML = '<div><b class="verde">▲ ' + fmtBRL.format(totE) + '</b> (' + pctE + '%)</div>' +
      '<div><b class="vermelho">▼ ' + fmtBRL.format(totS) + '</b> (' + pctS + '%)</div>';
  }

  function renderInsights(totE, totS) {
    var box = $('insights');
    var html = [];
    var porCat = {};
    state.saidas.forEach(function (l) {
      var c = l.categoria || 'Sem categoria';
      porCat[c] = (porCat[c] || 0) + l.valor;
    });
    var topCat = null;
    Object.keys(porCat).forEach(function (c) {
      if (!topCat || porCat[c] > topCat.valor) topCat = { nome: c, valor: porCat[c] };
    });
    var maior = state.saidas.slice().sort(function (a, b) { return b.valor - a.valor; })[0];

    if (topCat && topCat.valor > 0) {
      html.push('<div class="insight">🎯 Categoria top: <b>' + esc(topCat.nome) + '</b> — ' +
        fmtBRL.format(topCat.valor) + ' (' + Math.round(topCat.valor / totS * 100) + '% das saídas)</div>');
    }
    if (maior && maior.valor > 0) {
      html.push('<div class="insight">💸 Maior saída: <b>' + esc(maior.descricao) + '</b> — ' + fmtBRL.format(maior.valor) + '</div>');
    }
    if (totE > 0) {
      var comp = Math.round(totS / totE * 100);
      html.push('<div class="insight">📉 Comprometimento: <b class="' + (comp >= 100 ? 'neg' : 'pos') + '">' +
        comp + '%</b> da renda em saídas' + (comp >= 100 ? ' ⚠️' : '') + '</div>');
    }
    if (totS > 0) {
      var dias = new Date().getDate();
      html.push('<div class="insight">📅 Média diária: <b>' + fmtBRL.format(totS / dias) + '</b> de gasto</div>');
    }
    if (totE - totS < 0) {
      html.push('<div class="insight">🚨 <b class="neg">Balanço negativo</b> de ' +
        fmtBRL.format(Math.abs(totE - totS)) + '</div>');
    }
    if (!html.length) html.push('<div class="insight">Sem dados suficientes para insights ainda.</div>');
    box.innerHTML = html.join('');
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
    var dE = delta(tE, aT);
    if (dE !== null) partes.push('Entradas ' + (dE === 'novo' ? 'novas' : (dE >= 0 ? '+' + dE : dE) + '%'));
    var dS = delta(tS, aS);
    if (dS !== null) partes.push('Saídas ' + (dS === 'novo' ? 'novas' : (dS >= 0 ? '+' + dS : dS) + '%'));
    if (!partes.length) { box.innerHTML = ''; return; }
    box.innerHTML = '📈 vs ' + esc(nomeAnt) + ': ' + partes.join(' · ');
  }

  function limparFiltros() {
    state.filtro = { tipo: 'todos', categoria: '', conta: '', busca: '' };
    $('filtro-tipo').value = 'todos';
    $('filtro-busca').value = '';
  }

  // ------------------------------------------------------------ ações de dados
  function criarMes(mes) {
    chamar('novoMes', { mes: mes }).then(function (r) {
      if (!r.ok) { toast('Erro: ' + r.erro); return; }
      if (!state.meses.length || state.meses.indexOf(mes) < 0) {
        state.meses.push(r.mes || mes);
        state.meses.sort();
      }
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
    } else {
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
    var base = { mes: state.mes };
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
      prom = chamar('adicionar', Object.assign({}, base, dados));
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
      salvarCacheMes();
      renderTudo();
      toast(eraEdicao ? 'Atualizado!' : (dados.recorrente ? 'Adicionado! Criando próximos meses…' : 'Adicionado!'));
      if (dados.recorrente && !eraEdicao) criarRecorrentes(dados, dados.recorrenteMeses);
    }).catch(function (e) {
      syncStatus(false);
      state.salvando = false;
      toast('Erro ao salvar: ' + e.message);
      recarregarMes(); // desfaz o otimista: o cache volta a refletir o servidor
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
    salvarCacheMes();
    renderTudo();
    toast('Excluído!');
    // ---- confirma no servidor ----
    syncStatus(true, 'excluindo…');
    chamar('excluir', { mes: state.mes, tipo: tipo, linha: linha }).then(function (r) {
      syncStatus(false);
      if (!r.ok) { toast('Erro: ' + r.erro); recarregarMes(); }
    }).catch(function (e) {
      syncStatus(false);
      toast('Erro: ' + e.message);
      recarregarMes();
    });
  }

  // ------------------------------------------------------------ lançamento recorrente
  function proximosMeses(qtd, diaRef) {
    var hoje = new Date();
    var dia = Math.max(1, Math.min(parseInt(diaRef, 10) || hoje.getDate(), 28));
    var out = [];
    for (var i = 1; i <= qtd; i++) {
      var d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
      var ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      var dc = Math.min(dia, ult);
      var data = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + dc).slice(-2);
      var nome = d.toLocaleDateString('pt-BR', { month: 'long' });
      nome = nome.charAt(0).toUpperCase() + nome.slice(1);
      out.push({ mes: nome, data: data });
    }
    return out;
  }

  function criarRecorrentes(dados, qtd) {
    var meses = proximosMeses(qtd, dados.data ? dados.data.slice(8, 10) : null);
    var i = 0;
    var sucesso = 0;
    (function proximo() {
      if (i >= meses.length) {
        syncStatus(false);
        toast(sucesso > 0 ? 'Recorrente criado em ' + sucesso + ' mês(es)!' : 'Nada criado.');
        return;
      }
      var m = meses[i++];
      syncStatus(true, 'criando ' + m.mes + '…');
      chamar('novoMes', { mes: m.mes })
        .then(function (r) {
          if (!r.ok) throw new Error(m.mes + ': ' + r.erro);
          return chamar('adicionar', {
            mes: m.mes, tipo: dados.tipo, data: m.data,
            descricao: dados.descricao, categoria: dados.categoria,
            conta: dados.conta, valor: dados.valor
          });
        })
        .then(function (r) {
          if (!r.ok) throw new Error(m.mes + ': ' + r.erro);
          sucesso++;
          proximo();
        })
        .catch(function (e) {
          syncStatus(false);
          toast('Erro ao criar ' + m.mes + ': ' + e.message);
        });
    })();
  }

  // ------------------------------------------------------------ modal
  function abrirModal(modo, tipo, linha) {
    state.editando = null;
    $('f-data').value = hojeISO();
    $('f-descricao').value = '';
    $('f-categoria').value = '';
    $('f-conta').value = '';
    $('f-valor').value = '';
    $('f-recorrente').checked = false;
    $('f-recorrente-wrap').hidden = true;
    $('f-recorrente-meses').value = 12;

    setTipo(tipo || 'entrada');
    $('modal-titulo').textContent = 'Novo lançamento';

    if (modo === 'editar') {
      var lista = (tipo === 'entrada' ? state.entradas : state.saidas);
      var item = lista.filter(function (l) { return l.linha === linha; })[0];
      if (!item) return;
      $('f-data').value = item.data;
      $('f-descricao').value = item.descricao;
      $('f-categoria').value = item.categoria;
      $('f-conta').value = item.conta;
      $('f-valor').value = fmtBRL.format(item.valor).replace('R$', '').trim();
      $('modal-titulo').textContent = 'Editar lançamento';
      state.editando = { tipo: tipo, linha: linha };
    }

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
  $('btn-novo').addEventListener('click', function () {
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
  });

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
      valor: valor,
      recorrente: $('f-recorrente').checked,
      recorrenteMeses: parseInt($('f-recorrente-meses').value, 10) || 12
    };
    if (!dados.data) { toast('Informe a data.'); return; }
    if (!dados.descricao) { toast('Informe a descrição.'); return; }
    if (valor <= 0) { toast('Informe um valor maior que zero.'); return; }
    salvarLancamento(dados);
  });

  ['filtro-tipo', 'filtro-categoria', 'filtro-conta'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.filtro.tipo = $('filtro-tipo').value;
      state.filtro.categoria = $('filtro-categoria').value;
      state.filtro.conta = $('filtro-conta').value;
      renderLista();
    });
  });

  $('filtro-busca').addEventListener('input', function () {
    state.filtro.busca = this.value;
    renderLista();
  });

  $('btn-tema').addEventListener('click', function () {
    aplicarTema(document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro');
  });

  $('f-recorrente').addEventListener('change', function () {
    $('f-recorrente-wrap').hidden = !this.checked;
  });

  // ------------------------------------------------------------ aba Chaveiros
  var CHA_CUSTOS = { '3d': 5, '2d': 2, 'ab': 1 };
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

  // ---------------------- Pix: BR Code (payload copia-e-cola) ----------------------
  // Monta o payload est%C3%A1tico/din%C3%A2mico Pix conforme a norma do BACEN.
  // A chave %C3%A9 o CNPJ (campo 26). Nome (59) e cidade (60) s%C3%A3o obrigat%C3%B3rios.
  function pixCRC16(str) {
    // CRC-16/CCITT-FALSE (polin%C3%B4mio 0x1021, init 0xFFFF) - usada pelo Pix
    var crc = 0xFFFF;
    for (var i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
        crc &= 0xFFFF;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function pixEMV(id, valor) {
    // helper: id de 2 d%C3%ADgitos + valor (inteiro, em centavos quando num%C3%A9rico)
    var v = String(valor);
    return String(id).padStart(2, '0') + v.length.toString().padStart(2, '0') + v;
  }
  // Aceita chave Pix numérica de CPF (11) ou CNPJ (14) dígitos.
  function chavePixValida(chave) {
    var d = String(chave || '').replace(/\D/g, '');
    return d.length === 11 || d.length === 14;
  }
  function pixStr(chavePix, nome, cidade, valorCentavos) {
    // Monta o payload Pix (BR Code) com valor fixo em centavos.
    var merchan = nome.slice(0, 25);
    var cit = cidade.slice(0, 15);
    var chave = String(chavePix).replace(/\D/g, '');
    var gui46 = '0014br.gov.bcb.pix01' + (chave.length < 10 ? '0' : '') + chave.length + chave;
    var p = '000201' + pixEMV('26', gui46);
    p += '52040000';
    p += '5303986';
    if (valorCentavos > 0) {
      // Campo 54 (valor): 2 casas decimais com ponto, sem separador de milhar
      // (norma BACEN / EMVCo Transaction Amount). Ex.: 1000 centavos -> "10.00".
      var valor = (valorCentavos / 100).toFixed(2);
      p += pixEMV('54', valor);
    }
    p += '5802BR';
    p += pixEMV('59', merchan);
    p += pixEMV('60', cit);
    p += pixEMV('62', '05' + '***');
    p += '63040000';
    var crc = pixCRC16(p);
    p = p.slice(0, -4) + crc;
    return p;
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
  }
  // Copia o código Pix (payload BR Code) para o clipboard e tenta abrir o PagBank.
  function pixCopiar() {
    var cfg = cacheGet('pixconfig') || {};
    if (!cfg || !chavePixValida(cfg.chave)) {
      toast('Primeiro configure o CPF ou CNPJ da chave Pix (☰ Pix).');
      abrirConfigPix(); return;
    }
    var c = state.chaveiros;
    if (!c) return;
    // valor = do botão que disparou (custo ou dízimo)
    var bt = $('pix-btn-custo');
    var alvo = this && this.dataset && this.dataset.tipo === 'dizimo' ? 'dizimo' : 'custo';
    var centavos = 0;
    if (alvo === 'dizimo') centavos = Math.round(c.dizimo * 100);
    else centavos = Math.round(c.custo * 100);
    if (centavos <= 0) { toast('Valor zerado: nada a cobrar.'); return; }
    var payload = pixStr(cfg.chave, cfg.nome || 'Recebedor', cfg.cidade || 'BRASILIA', centavos);
    copiarClip(payload, function () {
      toast((alvo === 'dizimo' ? 'Código Pix do dízimo' : 'Código Pix do custo') + ' copiado!');
    });
    // tenta abrir o PagBank. NÃO usar um <a> para host externo (em PWA/TWA ele
    // navega a própria página em vez de fazer handoff). Usa a URI intent://
    // padrão do Android pinhando o PACOTE exato + fallback, sem depender de
    // autoVerify de App Link. O link https serve de fallback e para o Chrome.
    if (cfg.abrirApp !== false) {
      abrirPagBankApp();
    }
  }
  // Abre o app PagBank. Estratégia em camadas:
  //  1) intent:// com package=br.com.uol.ps.myaccount (método padrão do Android,
  //     pinha o app e abre independente de App Link/autoVerify).
  //  2) fallback: navega para o link de conta Pix (se o intent não resolver).
  // Se nada abrir, o código Pix JÁ foi copiado antes -> colagem manual funciona.
  function abrirPagBankApp() {
    var urlI =
      'intent://pagbank.com.br/conta-digital/pix#Intent;' +
      'scheme=https;package=br.com.uol.ps.myaccount;' +
      'S.browser_fallback_url=https%3A%2F%2Fwww.pagbank.com.br%2Fpix%2F;end';
    try { window.location.href = urlI; return; } catch (e) { /* tenta web */ }
    try {
      var a = document.createElement('a');
      a.href = 'https://www.pagbank.com.br/pix/';
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e2) { /* código já copiado: colagem manual */ }
  }
  function copiarClip(texto, cb) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy'); document.body.removeChild(ta);
        if (cb) cb();
      } catch (e) { }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () { if (cb) cb(); }, fallback);
    } else fallback();
  }
  function abrirConfigPix() {
    var f = $('pix-config');
    if (f) f.hidden = !f.hidden;
  }
  function salvarConfigPix() {
    var cfg = {
      chave: ($('pix-chave') ? $('pix-chave').value : '').trim(),
      nome: ($('pix-nome') ? $('pix-nome').value : '').trim() || 'Recebedor',
      cidade: ($('pix-cidade') ? $('pix-cidade').value : '').trim() || 'BRASILIA',
      abrirApp: $('pix-abrir') ? $('pix-abrir').checked : true
    };
    if (!chavePixValida(cfg.chave)) { toast('CPF (11) ou CNPJ (14) precisa de dígitos válidos.'); return; }
    cacheSet('pixconfig', cfg);
    toast('Configuração do Pix salva!');
    if ($('pix-config')) $('pix-config').hidden = true;
    if (state.chaveiros) chaCalcular();
  }
  function carregarConfigPix() {
    var cfg = cacheGet('pixconfig') || {};
    if ($('pix-chave')) $('pix-chave').value = cfg.chave || '';
    if ($('pix-nome')) $('pix-nome').value = cfg.nome || '';
    if ($('pix-cidade')) $('pix-cidade').value = cfg.cidade || '';
    if ($('pix-abrir')) $('pix-abrir').checked = cfg.abrirApp !== false;
  }
  function chaCalcular() {
    var vendas = {
      '3d': Math.max(0, chaQtd('cha-levou-3d') - chaQtd('cha-voltou-3d')),
      '2d': Math.max(0, chaQtd('cha-levou-2d') - chaQtd('cha-voltou-2d')),
      'ab': Math.max(0, chaQtd('cha-levou-ab') - chaQtd('cha-voltou-ab'))
    };
    var custo = vendas['3d'] * CHA_CUSTOS['3d'] + vendas['2d'] * CHA_CUSTOS['2d'] + vendas['ab'] * CHA_CUSTOS['ab'];
    var receitaPix = chaVal('cha-pix');
    var receitaFis = chaVal('cha-fisico');
    var receita = receitaPix + receitaFis;
    // dízimo = 10% do que sobra APÓS descontar o custo da mercadoria
    // (ex.: 3D de R$20 com custo R$5 -> 10% de R$15 = R$1,50). Nunca negativo.
    var dizimo = Math.max(0, Math.round((receita - custo) * 0.10 * 100) / 100);
    var nome = ($('cha-nome') ? $('cha-nome').value : '').trim();
    if (receita <= 0 && custo === 0) {
      toast('Informe o total do dia e/ou as quantidades.');
      return;
    }
    state.chaveiros = { nome: nome, vendas: vendas, custo: custo, receita: receita, receitaPix: receitaPix, receitaFis: receitaFis, dizimo: dizimo };
    var lucro = receita - custo;                                        // bruto (antes do dízimo)
    var liquido = Math.max(0, lucro - dizimo);                          // o que sobra após o dízimo
    var linhas = [];
    if (nome) linhas.push('Quem arrecadou: <b>' + nome + '</b>');
    linhas = linhas.concat([
      'Vendidos: 3D <b>' + vendas['3d'] + '</b> · 2D <b>' + vendas['2d'] + '</b> · Abridor <b>' + vendas['ab'] + '</b>',
      'Total do dia <b>' + chaBRL(receita) + '</b> (Pix ' + chaBRL(receitaPix) + ' · Físico ' + chaBRL(receitaFis) + ')',
      'Custo da mercadoria <b>' + chaBRL(custo) + '</b>',
      'Dízimo (10% da margem) <b>' + chaBRL(dizimo) + '</b>'
    ]).map(function (l) { return '<div class="linha">' + l + '</div>'; }).join('');
    var lucroCls = lucro >= 0 ? 'lucro-positivo' : 'lucro-negativo';
    var liquidoCls = liquido >= 0 ? 'lucro-positivo' : 'lucro-negativo';
    linhas += '<div class="linha tot">LUCRO BRUTO <b class="' + lucroCls + '">' + chaBRL(lucro) + '</b></div>';
    linhas += '<div class="linha tot">LÍQUIDO (após dízimo) <b class="' + liquidoCls + '">' + chaBRL(liquido) + '</b></div>';
    $('cha-resumo').innerHTML = linhas;
    $('cha-resumo').hidden = false;
    $('cha-lancar').hidden = false;
    $('cha-lancar').disabled = false;
    // botões Pix: gera código copia-e-cola com o valor do custo ou do dízimo
    var cfg = cacheGet('pixconfig') || {};
    var btnC = $('pix-btn-custo'), btnD = $('pix-btn-dizimo');
    if (btnC && btnD) {
      var ok = cfg && chavePixValida(cfg.chave);
      btnC.hidden = !ok; btnD.hidden = !ok;
      if (ok) { btnC.dataset.centavos = Math.round(custo * 100); btnD.dataset.centavos = Math.round(dizimo * 100); }
    }
  }
  function chaLancar() {
    var c = state.chaveiros;
    if (!c) return;
    if (!state.mes) { toast('Selecione/ crie um mês na aba Financeiro antes.'); return; }
    var base = { mes: state.mes, data: hojeISO() };
    var quem = c.nome ? ' — ' + c.nome : '';
    var itens = [];
    if (c.receitaPix > 0) itens.push({ tipo: 'entrada', descricao: 'Venda de chaveiros (arrecadação' + quem + ')', categoria: 'Vendas', conta: 'Pix', valor: c.receitaPix });
    if (c.receitaFis > 0) itens.push({ tipo: 'entrada', descricao: 'Venda de chaveiros (arrecadação' + quem + ')', categoria: 'Vendas', conta: 'Físico', valor: c.receitaFis });
    if (c.custo > 0) itens.push({ tipo: 'saida', descricao: 'Custo chaveiros (mercadoria)', categoria: 'Custos', conta: 'Físico', valor: c.custo });
    if (c.dizimo > 0) itens.push({ tipo: 'saida', descricao: 'Dízimo (venda de chaveiros)', categoria: 'Dízimo', conta: 'Físico', valor: c.dizimo });
    if (!itens.length) { toast('Nada a lançar.'); return; }
    $('cha-lancar').disabled = true;
    syncStatus(true, 'lançando…');
    var prom = Promise.resolve();
    itens.forEach(function (it) {
      prom = prom.then(function () {
        return chamar('adicionar', Object.assign({}, base, it));
      });
    });
    prom.then(function (r) {
      syncStatus(false);
      if (!r.ok) throw new Error(r.erro || 'não foi possível lançar na planilha.');
      salvarCacheMes();
      renderTudo();
      toast(itens.length + ' lançamento(s) gravados!');
      $('cha-lancar').hidden = true;
      $('cha-resumo').hidden = true;
      ['cha-nome','cha-levou-3d','cha-levou-2d','cha-levou-ab','cha-voltou-3d','cha-voltou-2d','cha-voltou-ab',
       'cha-pix','cha-fisico'].forEach(function (id) { $(id).value = ''; });
      state.chaveiros = null;
      visualizar('fin');
    }).catch(function (e) {
      syncStatus(false);
      $('cha-lancar').disabled = false;
      toast('Erro ao lançar: ' + e.message);
      recarregarMes();
    });
  }

  // handlers da aba Chaveiros
  document.querySelectorAll('#viz .viz-btn').forEach(function (b) {
    b.addEventListener('click', function () { visualizar(b.dataset.viz); });
  });
  $('cha-calcular').addEventListener('click', chaCalcular);
  $('cha-lancar').addEventListener('click', chaLancar);
  var __pixBtC = $('pix-btn-custo'), __pixBtD = $('pix-btn-dizimo');
  if (__pixBtC) __pixBtC.addEventListener('click', function (e) { e.stopPropagation(); pixCopiar.call(__pixBtC); });
  if (__pixBtD) __pixBtD.addEventListener('click', function (e) { e.stopPropagation(); pixCopiar.call(__pixBtD); });
  if ($('pix-btn-config')) $('pix-btn-config').addEventListener('click', abrirConfigPix);
  if ($('pix-salvar')) $('pix-salvar').addEventListener('click', salvarConfigPix);
  carregarConfigPix();
  visualizar('fin');

  // ------------------------------------------------------------ start
  var temaInit = cacheGet('tema') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
  aplicarTema(temaInit);
  carregarInicio();
})();
