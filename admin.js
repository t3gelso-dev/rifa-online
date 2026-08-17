let TOKEN = localStorage.getItem('rifa_admin_token') || '';

async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (TOKEN) opts.headers.Authorization = 'Bearer ' + TOKEN;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 401) {
    localStorage.removeItem('rifa_admin_token');
    TOKEN = '';
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('painel').classList.add('hidden');
    throw new Error('Sessão expirada');
  }
  return res;
}

function preencherCfg(cfg) {
  document.getElementById('c_titulo').value = cfg.titulo;
  document.getElementById('c_descricao').value = cfg.descricao;
  document.getElementById('c_total').value = cfg.totalNumeros;
  document.getElementById('c_valor').value = cfg.valor;
  document.getElementById('c_pix').value = cfg.pixKey || '';
  document.getElementById('c_pagador').value = cfg.pagador;
  document.getElementById('c_cidade').value = cfg.cidade;
  document.getElementById('c_contato').value = cfg.contato;
}

async function salvarCfg() {
  const payload = {
    titulo: document.getElementById('c_titulo').value,
    descricao: document.getElementById('c_descricao').value,
    totalNumeros: parseInt(document.getElementById('c_total').value, 10),
    valor: parseFloat(document.getElementById('c_valor').value),
    pixKey: document.getElementById('c_pix').value,
    pagador: document.getElementById('c_pagador').value,
    cidade: document.getElementById('c_cidade').value,
    contato: document.getElementById('c_contato').value,
    adminPass: document.getElementById('c_senha').value,
  };
  const res = await api('POST', '/api/admin/config', payload);
  if (res.ok) {
    alert('Configurações salvas. A lista de números foi reiniciada.');
    carregar();
  } else {
    alert('Erro ao salvar.');
  }
}

async function renderLista() {
  const res = await api('GET', '/api/admin/raffle');
  const data = await res.json();
  preencherCfg(data.config);
  const alvo = data.numeros.filter((n) => n.status !== 'disponivel');
  const el = document.getElementById('listaAdm');
  if (alvo.length === 0) {
    el.innerHTML = '<p class="muted">Nenhum número reservado ou pago ainda.</p>';
    return;
  }
  el.innerHTML = '';
  alvo.sort((a, b) => a.numero - b.numero).forEach((n) => {
    const row = document.createElement('div');
    row.className = 'adm-row ' + n.status;
    row.innerHTML = `
      <span class="adm-num">#${n.numero}</span>
      <span class="adm-status">${n.status}</span>
      <span class="adm-actions">
        ${n.status !== 'pago' ? `<button data-pagar="${n.numero}" class="btn btn-small btn-primary">Marcar pago</button>` : ''}
        <button data-lib="${n.numero}" class="btn btn-small btn-ghost">Liberar</button>
      </span>`;
    el.appendChild(row);
  });
  el.querySelectorAll('[data-pagar]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('POST', '/api/admin/marcar-pago', { numero: parseInt(b.dataset.pagar, 10) });
      renderLista();
    })
  );
  el.querySelectorAll('[data-lib]').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('POST', '/api/admin/liberar', { numero: parseInt(b.dataset.lib, 10) });
      renderLista();
    })
  );
}

async function sortear() {
  const res = await api('POST', '/api/admin/sortear', {});
  const data = await res.json();
  const box = document.getElementById('resultadoSorteio');
  if (!res.ok) {
    box.classList.remove('hidden');
    box.innerHTML = `<p>${data.error}</p>`;
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="vencedor">🎉 Número sorteado: <strong>#${data.vencedor}</strong></div>
    <p class="muted">Total de números pagos na premiação: ${data.totalPagos}</p>`;
}

async function carregar() {
  await renderLista();
}

function init() {
  document.getElementById('btnLogin').addEventListener('click', async () => {
    const s = document.getElementById('senha').value;
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha: s }),
    });
    const data = await res.json();
    if (res.ok && data.token) {
      TOKEN = data.token;
      localStorage.setItem('rifa_admin_token', TOKEN);
      document.getElementById('login').classList.add('hidden');
      document.getElementById('painel').classList.remove('hidden');
      carregar();
    } else {
      alert('Senha incorreta.');
    }
  });
  document.getElementById('btnSalvarCfg').addEventListener('click', salvarCfg);
  document.getElementById('btnSortear').addEventListener('click', sortear);
  document.getElementById('btnReset').addEventListener('click', async () => {
    if (confirm('Tem certeza? Isso apaga todos os números e pedidos.')) {
      await api('POST', '/api/admin/reset', {});
      renderLista();
    }
  });

  // tenta entrar direto se já tiver token
  if (TOKEN) {
    api('GET', '/api/admin/raffle')
      .then(() => {
        document.getElementById('login').classList.add('hidden');
        document.getElementById('painel').classList.remove('hidden');
        carregar();
      })
      .catch(() => {});
  }
}

init();
