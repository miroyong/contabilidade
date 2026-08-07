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
    editando: null      // { tipo: 'entrada'|'saida', linha: N }
  };

  var $ = function (id) { return document.getElementById(id); };

  var fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // ------------------------------------------------------------ utilidades
  function chamar(action, params) {
    var corpo = Object.assign({ action: action, key: APP_KEY }, params || {});
    return fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo)
    }).then(function (r) { return r.json(); });
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
    if (!SCRIPT_URL) {
      $('aviso-config').hidden = false;
      $('btn-novo').disabled = true;
      return;
    }
    Promise.all([chamar('meses'), chamar('opcoes')])
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
        $('aviso-config').textContent = 'Erro ao conectar: ' + e.message +
          '. Confira o APPS_SCRIPT_URL no config.js.';
      });
  }

  function selecionarMes(mes) {
    state.mes = mes;
    state.editando = null;
    limparFiltros();
    chamar('lancamentos', { mes: mes })
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

    $('saldo-mes').textContent = state.mes || '—';
    var v = $('saldo-valor');
    v.textContent = fmtBRL.format(bal);
    v.className = 'saldo-valor ' + (bal >= 0 ? 'positivo' : 'negativo');
    $('saldo-entradas').textContent = fmtBRL.format(totE);
    $('saldo-saidas').textContent = fmtBRL.format(totS);
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
    var prom;
    if (state.editando) {
      prom = chamar('atualizar', Object.assign({ mes: state.mes }, state.editando, dados));
    } else {
      prom = chamar('adicionar', Object.assign({ mes: state.mes }, dados));
    }
    prom.then(function (r) {
      if (!r.ok) { toast('Erro: ' + r.erro); return; }
      toast(state.editando ? 'Lançamento atualizado!' : 'Lançamento adicionado!');
      state.editando = null;
      fecharModal();
      selecionarMes(state.mes); // recarrega (atualiza totais/gráfico)
    }).catch(function (e) { toast('Erro: ' + e.message); });
  }

  function excluir(tipo, linha) {
    var item = (tipo === 'entrada' ? state.entradas : state.saidas)
      .filter(function (l) { return l.linha === linha; })[0];
    var desc = item ? item.descricao : 'este lançamento';
    if (!confirm('Excluir "' + desc + '"?')) return;
    chamar('excluir', { mes: state.mes, tipo: tipo, linha: linha }).then(function (r) {
      if (!r.ok) { toast('Erro: ' + r.erro); return; }
      toast('Excluído!');
      selecionarMes(state.mes);
    }).catch(function (e) { toast('Erro: ' + e.message); });
  }

  // ------------------------------------------------------------ modal
  function abrirModal(modo, tipo, linha) {
    state.editando = null;
    $('f-data').value = hojeISO();
    $('f-descricao').value = '';
    $('f-categoria').value = '';
    $('f-conta').value = '';
    $('f-valor').value = '';

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
    renderLista();
  });

  // ------------------------------------------------------------ start
  carregarInicio();
})();
