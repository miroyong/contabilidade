// ============================================================
// CONTROLE FINANCEIRO — lógica do app
// ============================================================
(function () {
  'use strict';

  var API = window.APP_CONFIG || {};
  var SB_URL = (API.SUPABASE_URL || '').replace(/\/+$/, '');
  var SB_KEY = API.SUPABASE_ANON_KEY || '';

  var state = {
    mes: null,          // mês selecionado (ex.: "2026-08")
    meses: [],          // meses existentes (ids "YYYY-MM"; mais recente primeiro)
    mesAtual: null,     // mês corrente (id "YYYY-MM")
    existe: true,       // o mês selecionado existe no banco?
    entradas: [],
    saidas: [],
    categorias: [],
    contas: [],
    filtro: { tipo: 'todos', categoria: '', conta: '', busca: '' },
    editando: null      // { id: uuid, tipo: 'entrada'|'saida' }
  };

  var $ = function (id) { return document.getElementById(id); };

  var fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var timerBusca = null; // debounce do filtro de busca

  // ------------------------------------------------------- meses (ids YYYY-MM)
  var MESES_PT = {
    'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6,
    'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12
  };

  function pad2(n) { return ('0' + n).slice(-2); }

  function idMesAtual() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  // "2026-08" -> "Agosto"
  function nomeMes(id) {
    if (!id) return '—';
    var p = String(id).split('-');
    if (p.length < 2) return String(id);
    var d = new Date(+p[0], (+p[1] || 1) - 1, 1);
    if (isNaN(d.getTime())) return String(id);
    var n = d.toLocaleDateString('pt-BR', { month: 'long' });
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  // rótulo curto p/ chips e cabeçalho; acrescenta "/ano" só se houver 2+ anos
  function rotuloMes(id) {
    var anos = {};
    (state.meses || []).forEach(function (m) { anos[String(m).slice(0, 4)] = 1; });
    var base = nomeMes(id);
    if (Object.keys(anos).length > 1 && String(id).length >= 4) {
      base += '/' + String(id).slice(2, 4);
    }
    return base;
  }

  function sortMesesDesc() { state.meses.sort().reverse(); }

  // "Setembro" / "Setembro 2026" -> "2026-09" (ano padrão = corrente)
  function parseMesPrompt(s) {
    var partes = String(s || '').trim().split(/\s+/);
    if (!partes.length) return null;
    var ano = new Date().getFullYear();
    if (/^\d{4}$/.test(partes[partes.length - 1])) ano = +partes.pop();
    var mm = MESES_PT[partes.join(' ').toLowerCase()];
    if (!mm) return null;
    return ano + '-' + pad2(mm);
  }

  // ------------------------------------------------- Supabase REST (PostgREST)
  function rest(path, opts) {
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
    return fetch(url, cfg).then(function (r) {
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

  function enc(v) { return encodeURIComponent(v); }

  // ------------------------------------------------------------- "API" do app
  function api(action, params) {
    params = params || {};
    switch (action) {
      case 'meses':       return apiMeses();
      case 'opcoes':      return apiOpcoes();
      case 'lancamentos': return apiLancamentos(params.mes);
      case 'adicionar':   return apiAdicionar(params);
      case 'atualizar':   return apiAtualizar(params);
      case 'excluir':     return apiExcluir(params);
      case 'novoMes':     return apiNovoMes(params.mes);
      default: return Promise.reject(new Error('Ação desconhecida: ' + action));
    }
  }

  function apiMeses() {
    return rest('meses', { query: 'select=id&order=id.desc' }).then(function (rows) {
      return {
        ok: true,
        meses: (rows || []).map(function (r) { return r.id; }),
        mesAtual: idMesAtual()
      };
    });
  }

  function apiOpcoes() {
    return rest('lancamentos', { query: 'select=categoria,conta' }).then(function (rows) {
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

  function apiLancamentos(mes) {
    var qMes = 'mes_id=eq.' + enc(mes);
    return Promise.all([
      rest('lancamentos', {
        query: 'select=id,tipo,data,descricao,categoria,conta,valor&' + qMes + '&order=data'
      }),
      rest('meses', { query: 'select=id&id=eq.' + enc(mes) })
    ]).then(function (rs) {
      var rows = rs[0] || [];
      var existe = (rs[1] || []).length > 0;
      var entradas = [], saidas = [];
      rows.forEach(function (r) {
        var obj = {
          id: r.id,
          data: String(r.data || ''),
          descricao: String(r.descricao || ''),
          categoria: String(r.categoria || ''),
          conta: String(r.conta || ''),
          valor: Number(r.valor) || 0
        };
        if (r.tipo === 'saida') saidas.push(obj); else entradas.push(obj);
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

  function apiAdicionar(p) {
    return rest('lancamentos', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        mes_id: p.mes, tipo: p.tipo, data: p.data,
        descricao: p.descricao, categoria: p.categoria || '',
        conta: p.conta || '', valor: p.valor
      }
    }).then(function (rows) {
      rows = rows || [];
      return { ok: true, id: rows.length ? rows[0].id : null };
    });
  }

  function apiAtualizar(p) {
    return rest('lancamentos', {
      query: 'id=eq.' + enc(p.id),
      method: 'PATCH',
      prefer: 'return=representation',
      body: {
        tipo: p.tipo, data: p.data,
        descricao: p.descricao, categoria: p.categoria || '',
        conta: p.conta || '', valor: p.valor
      }
    }).then(function () { return { ok: true }; });
  }

  function apiExcluir(p) {
    return rest('lancamentos', {
      query: 'id=eq.' + enc(p.id),
      method: 'DELETE'
    }).then(function () { return { ok: true }; });
  }

  function apiNovoMes(mes) {
    if (!mes) return Promise.resolve({ ok: false, erro: 'Informe o mês.' });
    return rest('meses', {
      method: 'POST', prefer: 'return=representation', body: { id: mes }
    }).then(function () {
      return { ok: true, criado: true, mes: mes };
    }).catch(function (e) {
      // chave duplicada (23505) => o mês já existe
      if (/23505|duplicate|already exists/i.test(String(e.message))) {
        return { ok: true, criado: false, mes: mes };
      }
      return { ok: false, erro: e.message };
    });
  }

  // ---------------------------------------------------------- lista local
  function listaPorTipo(t) { return t === 'saida' ? state.saidas : state.entradas; }

  function buscarLocal(id) {
    for (var i = 0; i < state.entradas.length; i++) {
      if (state.entradas[i].id === id) return state.entradas[i];
    }
    for (var j = 0; j < state.saidas.length; j++) {
      if (state.saidas[j].id === id) return state.saidas[j];
    }
    return null;
  }

  function removerLocal(id) {
    state.entradas = state.entradas.filter(function (l) { return l.id !== id; });
    state.saidas = state.saidas.filter(function (l) { return l.id !== id; });
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

  // ------------------------------------------------------------ carregamento
  function carregarInicio() {
    if (!SB_URL || !SB_KEY) {
      $('aviso-config').hidden = false;
      $('btn-novo').disabled = true;
      return;
    }
    Promise.all([api('meses'), api('opcoes')])
      .then(function (rs) {
        var meses = rs[0], op = rs[1];
        if (!meses.ok) throw new Error(meses.erro);
        state.meses = meses.meses || [];
        state.mesAtual = meses.mesAtual;
        state.categorias = (op && op.ok && op.categorias) || [];
        state.contas = (op && op.ok && op.contas) || [];

        preencherDatalists();

        // escolhe o mês: o atual se existir, senão o primeiro existente
        var alvo = null;
        if (state.meses.indexOf(state.mesAtual) >= 0) alvo = state.mesAtual;
        else if (state.meses.length) alvo = state.meses[0];
        else alvo = state.mesAtual; // nada existe ainda — deixa o app propor criar

        selecionarMes(alvo);
      })
      .catch(function (e) {
        $('aviso-config').hidden = false;
        $('aviso-config').textContent = 'Erro ao conectar no Supabase: ' + e.message +
          '. Confira o SUPABASE_URL/SUPABASE_ANON_KEY no config.js.';
      });
  }

  function selecionarMes(mes) {
    state.mes = mes;
    state.editando = null;
    limparFiltros();
    api('lancamentos', { mes: mes })
      .then(function (r) {
        if (!r.ok) throw new Error(r.erro);
        state.existe = !!r.existe;
        state.entradas = r.entradas || [];
        state.saidas = r.saidas || [];
        renderTudo();
      })
      .catch(function (e) {
        toast('Erro ao carregar mês: ' + e.message);
      });
  }

  function preencherDatalists() {
    $('dl-categorias').innerHTML = state.categorias.map(function (c) {
      return '<option value="' + esc(c) + '">';
    }).join('');
    $('dl-contas').innerHTML = state.contas.map(function (c) {
      return '<option value="' + esc(c) + '">';
    }).join('');
  }

  // ------------------------------------------------------------ render
  function renderTudo() {
    renderSaldo();
    renderMeses();
    renderAvisoMes();
    renderFiltros();
    renderGrafico();
    renderLista();
  }

  function renderSaldo() {
    var totE = state.entradas.reduce(function (s, l) { return s + l.valor; }, 0);
    var totS = state.saidas.reduce(function (s, l) { return s + l.valor; }, 0);
    var bal = totE - totS;

    $('saldo-mes').textContent = rotuloMes(state.mes) || '—';
    var v = $('saldo-valor');
    v.textContent = fmtBRL.format(bal);
    v.className = 'saldo-valor ' + (bal >= 0 ? 'positivo' : 'negativo');
    $('saldo-entradas').textContent = fmtBRL.format(totE);
    $('saldo-saidas').textContent = fmtBRL.format(totS);
  }

  function renderMeses() {
    var box = $('meses-list');
    if (!state.meses.length) {
      box.innerHTML = '<span class="vazio">Nenhum mês criado ainda.</span>';
      return;
    }
    box.innerHTML = state.meses.map(function (m) {
      return '<button class="chip' + (m === state.mes ? ' ativo' : '') + '" data-mes="' +
        esc(m) + '" title="' + esc(m) + '">' + esc(rotuloMes(m)) + '</button>';
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
    av.innerHTML = 'O mês <b>' + esc(rotuloMes(state.mes)) + '</b> ainda não existe. ' +
      '<button class="btn-criar-mes">Criar mês agora</button>';
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
      state.contas.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
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
      return a.id < b.id ? 1 : (a.id > b.id ? -1 : 0);
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
          '<button class="btn-icone" data-edit="' + tipo + ':' + l.id + '" title="Editar">✏️</button>' +
          '<button class="btn-icone" data-del="' + tipo + ':' + l.id + '" title="Excluir">🗑️</button>' +
        '</div>' +
        '<div class="lanc-det">' + esc(l.categoria || '—') + ' · ' + esc(l.conta || '—') + '</div>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.edit.split(':');
        abrirModal('editar', p[0], p[1]);
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.del.split(':');
        excluir(p[0], p[1]);
      });
    });
  }

  function limparFiltros() {
    state.filtro = { tipo: 'todos', categoria: '', conta: '', busca: '' };
    $('filtro-tipo').value = 'todos';
    $('filtro-busca').value = '';
  }

  // ------------------------------------------------------------ ações de dados
  function criarMes(id) {
    api('novoMes', { mes: id }).then(function (r) {
      if (!r.ok) { toast('Erro: ' + r.erro); return; }
      if (state.meses.indexOf(id) < 0) {
        state.meses.push(id);
        sortMesesDesc();
      }
      toast(r.criado ? 'Mês criado!' : 'Esse mês já existia.');
      selecionarMes(id);
    }).catch(function (e) { toast('Erro: ' + e.message); });
  }

  function salvarLancamento(dados) {
    var editando = state.editando;
    var prom = editando
      ? api('atualizar', Object.assign({ mes: state.mes, id: editando.id }, dados))
      : api('adicionar', Object.assign({ mes: state.mes }, dados));

    prom.then(function (r) {
      if (!r.ok) { toast('Erro: ' + r.erro); return; }

      var novo = {
        id: editando ? editando.id : r.id,
        data: dados.data,
        descricao: dados.descricao,
        categoria: dados.categoria,
        conta: dados.conta,
        valor: dados.valor
      };
      removerLocal(novo.id);           // remove de onde estiver (edição pode mudar o tipo)
      listaPorTipo(dados.tipo).push(novo);

      toast(editando ? 'Lançamento atualizado!' : 'Lançamento adicionado!');
      state.editando = null;
      fecharModal();
      renderTudo(); // atualiza saldo/gráfico/lista sem refazer o fetch
    }).catch(function (e) { toast('Erro: ' + e.message); });
  }

  function excluir(tipo, id) {
    var item = buscarLocal(id);
    var desc = item ? item.descricao : 'este lançamento';
    if (!confirm('Excluir "' + desc + '"?')) return;
    api('excluir', { mes: state.mes, id: id }).then(function (r) {
      if (!r.ok) { toast('Erro: ' + r.erro); return; }
      removerLocal(id);
      toast('Excluído!');
      renderTudo(); // sem refazer o fetch do mês
    }).catch(function (e) { toast('Erro: ' + e.message); });
  }

  // ------------------------------------------------------------ modal
  function abrirModal(modo, tipo, id) {
    state.editando = null;
    $('f-data').value = hojeISO();
    $('f-descricao').value = '';
    $('f-categoria').value = '';
    $('f-conta').value = '';
    $('f-valor').value = '';

    setTipo(tipo || 'entrada');
    $('modal-titulo').textContent = 'Novo lançamento';

    if (modo === 'editar') {
      var item = buscarLocal(id);
      if (!item) return;
      $('f-data').value = item.data;
      $('f-descricao').value = item.descricao;
      $('f-categoria').value = item.categoria;
      $('f-conta').value = item.conta;
      $('f-valor').value = fmtBRL.format(item.valor).replace('R$', '').trim();
      $('modal-titulo').textContent = 'Editar lançamento';
      state.editando = { id: id, tipo: tipo };
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
      toast('Crie o mês primeiro (botão ＋).');
      return;
    }
    if (!state.existe) {
      if (!confirm('O mês "' + rotuloMes(state.mes) + '" não existe. Criar agora?')) return;
      criarMes(state.mes);
      return;
    }
    abrirModal('novo', null, null);
  });

  $('btn-novo-mes').addEventListener('click', function () {
    var nome = prompt('Mês (ex.: Setembro) ou com ano (ex.: Setembro 2026):');
    if (!nome || !nome.trim()) return;
    var id = parseMesPrompt(nome);
    if (!id) { toast('Mês não reconhecido. Ex.: "Setembro" ou "Setembro 2026".'); return; }
    criarMes(id);
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
    clearTimeout(timerBusca);
    timerBusca = setTimeout(renderLista, 200); // debounce: só renderiza após pausa
  });

  // ------------------------------------------------------------ start
  carregarInicio();
})();
