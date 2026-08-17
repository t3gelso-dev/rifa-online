const state = { numeros: [], selecionados: new Set(), mock: false, orderId: null, pollTimer: null };

function formatBRL(v) {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (ok ? 'ok' : 'erro');
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
}

async function carregarRifa() {
  const res = await fetch('/api/raffle');
  const data = await res.json();
  state.numeros = data.numeros;
  state.mock = data.mock;
  document.getElementById('titulo').textContent = data.titulo;
  document.title = data.titulo;
  document.getElementById('descricao').textContent = '🎁 ' + data.descricao;
  document.getElementById('valor').textContent = formatBRL(data.valor);
  document.getElementById('disponiveis').textContent = data.resumo.disponivel;
  document.getElementById('reservados').textContent = data.resumo.reservado;
  document.getElementById('pagos').textContent = data.resumo.pago;
  renderGrade();
}

function renderGrade() {
  const grade = document.getElementById('grade');
  grade.innerHTML = '';
  state.numeros.forEach((n) => {
    const btn = document.createElement('button');
    btn.className = 'num ' + n.status;
    btn.textContent = n.numero;
    if (n.status === 'disponivel') {
      btn.addEventListener('click', () => toggleSelecionado(n.numero));
      if (state.selecionados.has(n.numero)) btn.classList.add('sel');
    } else {
      btn.disabled = true;
    }
    grade.appendChild(btn);
  });
}

function toggleSelecionado(num) {
  if (state.selecionados.has(num)) state.selecionados.delete(num);
  else state.selecionados.add(num);
  renderSelecionados();
  renderGrade();
}

function renderSelecionados() {
  const el = document.getElementById('selecionados');
  if (state.selecionados.size === 0) {
    el.textContent = 'Nenhum selecionado';
    return;
  }
  const lista = [...state.selecionados].sort((a, b) => a - b);
  el.innerHTML = lista.map((n) => `<span class="chip">${n}</span>`).join('');
}

function abrirModalPix() {
  if (state.selecionados.size === 0) {
    toast('Selecione ao menos um número.', false);
    return;
  }
  document.getElementById('dadosComprador').classList.remove('hidden');
  document.getElementById('pixArea').classList.add('hidden');
  document.getElementById('pixStatus').textContent = '';
  if (state.pollTimer) clearInterval(state.pollTimer);
  document.getElementById('modalPix').classList.remove('hidden');
}

async function gerarPix() {
  const nome = document.getElementById('c_nome').value.trim();
  const tel = document.getElementById('c_tel').value.trim();
  const email = document.getElementById('c_email').value.trim();
  if (!nome) {
    toast('Informe seu nome.', false);
    return;
  }
  const numeros = [...state.selecionados].sort((a, b) => a - b);
  try {
    const res = await fetch('/api/reservar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numeros, nome, email, telefone: tel }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Erro ao gerar Pix.', false);
      carregarRifa();
      return;
    }
    state.orderId = data.orderId;
    state.selecionados.clear();
    renderSelecionados();
    mostrarPix(data);
  } catch (e) {
    toast('Erro de conexão.', false);
  }
}

function mostrarPix(data) {
  document.getElementById('dadosComprador').classList.add('hidden');
  document.getElementById('pixArea').classList.remove('hidden');
  document.getElementById('pixValor').textContent = formatBRL(data.total);
  document.getElementById('pixCode').value = data.qrCode;
  const qr = document.getElementById('pixQr');
  if (data.qrBase64) qr.src = 'data:image/png;base64,' + data.qrBase64;
  else qr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(data.qrCode);

  const sim = document.getElementById('btnSimular');
  if (data.mock) sim.classList.remove('hidden');
  else sim.classList.add('hidden');

  iniciarPoll();
}

function iniciarPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/pagamento/' + state.orderId);
      const d = await res.json();
      if (d.status === 'approved') {
        clearInterval(state.pollTimer);
        document.getElementById('pixStatus').innerHTML =
          '<div class="vencedor" style="font-size:1.1rem">✅ Pagamento confirmado! Obrigado.</div>';
        carregarRifa();
        setTimeout(() => document.getElementById('modalPix').classList.add('hidden'), 2500);
      }
    } catch (e) {}
  }, 3000);
}

function copiarPix() {
  const ta = document.getElementById('pixCode');
  ta.select();
  document.execCommand('copy');
  const btn = document.getElementById('btnCopiar');
  btn.textContent = 'Copiado!';
  setTimeout(() => (btn.textContent = 'Copiar código'), 1500);
}

async function simularPagamento() {
  await fetch('/api/simular-pagamento/' + state.orderId, { method: 'POST' });
}

function init() {
  carregarRifa();
  document.getElementById('btnGerarPix').addEventListener('click', abrirModalPix);
  document.getElementById('btnLimpar').addEventListener('click', () => {
    state.selecionados.clear();
    renderSelecionados();
    renderGrade();
  });
  document.getElementById('fecharPix').addEventListener('click', () => {
    if (state.pollTimer) clearInterval(state.pollTimer);
    document.getElementById('modalPix').classList.add('hidden');
    carregarRifa();
  });
  document.getElementById('btnCopiar').addEventListener('click', copiarPix);
  document.getElementById('btnSimular').addEventListener('click', simularPagamento);
  // Gera Pix após preencher dados (botão dentro do modal)
  const gerarBtn = document.createElement('button');
  gerarBtn.className = 'btn btn-primary';
  gerarBtn.textContent = 'Gerar Pix';
  gerarBtn.style.marginTop = '14px';
  gerarBtn.addEventListener('click', gerarPix);
  document.getElementById('dadosComprador').appendChild(gerarBtn);
}

init();
