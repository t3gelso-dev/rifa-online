const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Carrega .env (sem dependência externa) ----------
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const txt = fs.readFileSync(envPath, 'utf8');
  txt.split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  });
}
loadEnv();

const PORT = process.env.PORT || 3000;
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const PAYMENT_MODE = (process.env.PAYMENT_MODE || (MP_TOKEN ? 'mercadopago' : 'demo')).toLowerCase();
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ---------- Banco de dados (arquivo JSON) ----------
const DB_PATH = path.join(__dirname, 'db.json');
const DEFAULT_CONFIG = {
  titulo: 'Rifa Online',
  descricao: 'Descreva o prêmio da sua rifa aqui.',
  totalNumeros: 100,
  valor: 10.0,
  pixKey: '',
  pagador: 'RECEBEDOR',
  cidade: 'CIDADE',
  contato: 'WhatsApp: (00) 00000-0000',
  adminPass: ADMIN_PASS,
};

let db = null;

function loadDB() {
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } else {
    db = { config: { ...DEFAULT_CONFIG }, numbers: [], orders: [], tokens: {} };
    rebuildNumbers();
    saveDB();
  }
  if (!db.config) db.config = { ...DEFAULT_CONFIG };
  if (!db.numbers) db.numbers = [];
  if (!db.orders) db.orders = [];
  if (!db.tokens) db.tokens = {};
  // garante que a quantidade de números bate com a config
  if (db.numbers.length !== db.config.totalNumeros) rebuildNumbers();
  return db;
}

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function rebuildNumbers() {
  db.numbers = [];
  for (let i = 1; i <= db.config.totalNumeros; i++) {
    db.numbers.push({ numero: i, status: 'disponivel' });
  }
}

function releaseExpiredOrders() {
  const now = Date.now();
  const EXPIRA_MS = 12 * 60 * 60 * 1000; // 12 horas
  let changed = false;
  db.orders.forEach((o) => {
    if (o.status === 'pending' && now - o.createdAt > EXPIRA_MS) {
      o.status = 'expired';
      o.numeros.forEach((n) => {
        const num = db.numbers.find((x) => x.numero === n);
        if (num && num.status === 'reservado') num.status = 'disponivel';
      });
      changed = true;
    }
  });
  if (changed) saveDB();
}

// ---------- Gerador Pix fake (modo MOCK) ----------
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc <<= 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function emvField(id, v) {
  return id + v.length.toString().padStart(2, '0') + v;
}
function gerarPixFake(valor, cfg) {
  const key = (cfg.pixKey || 'rifa@exemplo.com').trim();
  const gui = emvField('00', 'BR.GOV.BCB.PIX') + emvField('01', key);
  let p = '000201' + emvField('26', gui) + '52040000' + '5303986';
  p += emvField('54', valor.toFixed(2));
  p += emvField('58', 'BR') + emvField('59', (cfg.pagador || 'RECEBEDOR').slice(0, 25));
  p += emvField('60', (cfg.cidade || 'CIDADE').slice(0, 15)) + emvField('62', emvField('05', '***'));
  p += '6304' + crc16(p);
  return p;
}

// ---------- Mercado Pago ----------
async function criarPixMP(total, descricao, payer) {
  const token = process.env.MP_ACCESS_TOKEN;
  const res = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      transaction_amount: Number(total),
      description: descricao,
      payment_method_id: 'pix',
      payer: { email: payer.email || 'comprador@rifa.com', first_name: payer.nome || 'Comprador' },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Erro ao criar Pix no Mercado Pago');
  const td = data.point_of_interaction?.transaction_data || {};
  return {
    paymentId: String(data.id),
    qrCode: td.qr_code || '',
    qrBase64: td.qr_code_base64 || '',
    status: data.status,
  };
}

async function checarPagamentoMP(paymentId) {
  const token = process.env.MP_ACCESS_TOKEN;
  const res = await fetch('https://api.mercadopago.com/v1/payments/' + paymentId, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const data = await res.json();
  return data.status;
}

// ---------- Auth admin ----------
function newToken() {
  const t = crypto.randomBytes(24).toString('hex');
  db.tokens[t] = Date.now() + 12 * 60 * 60 * 1000; // 12h
  saveDB();
  return t;
}
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.replace(/^Bearer\s+/i, '');
  if (db.tokens[token] && db.tokens[token] > Date.now()) return next();
  return res.status(401).json({ error: 'Não autorizado' });
}

// ---------- App ----------
const app = express();
app.use(express.json());

// Arquivos do front (na raiz do projeto)
const frontFiles = ['index.html', 'admin.html', 'style.css', 'app.js', 'admin.js', 'jesus-criancas.png'];
frontFiles.forEach((f) => {
  app.get('/' + (f === 'index.html' ? '' : f), (req, res) => {
    res.sendFile(path.join(__dirname, f));
  });
});

// Estado público da rifa
app.get('/api/raffle', (req, res) => {
  releaseExpiredOrders();
  const cfg = db.config;
  const resumo = {
    disponivel: db.numbers.filter((n) => n.status === 'disponivel').length,
    reservado: db.numbers.filter((n) => n.status === 'reservado').length,
    pago: db.numbers.filter((n) => n.status === 'pago').length,
  };
  res.json({
    titulo: cfg.titulo,
    descricao: cfg.descricao,
    valor: cfg.valor,
    contato: cfg.contato,
    totalNumeros: cfg.totalNumeros,
    numeros: db.numbers,
    resumo,
    paymentMode: PAYMENT_MODE,
  });
});

// Reservar números e gerar Pix
app.post('/api/reservar', async (req, res) => {
  try {
    releaseExpiredOrders();
    const { numeros, nome, email, telefone } = req.body || {};
    if (!Array.isArray(numeros) || numeros.length === 0) {
      return res.status(400).json({ error: 'Selecione ao menos um número.' });
    }
    const invalidos = [];
    numeros.forEach((n) => {
      const num = db.numbers.find((x) => x.numero === n);
      if (!num || num.status !== 'disponivel') invalidos.push(n);
    });
    if (invalidos.length) {
      return res.status(409).json({ error: 'Números indisponíveis: ' + invalidos.join(', ') });
    }
    const total = numeros.length * db.config.valor;
    const order = {
      id: crypto.randomUUID(),
      numeros: numeros.slice(),
      nome: nome || '',
      email: email || '',
      telefone: telefone || '',
      total,
      status: 'pending',
      paymentId: null,
      createdAt: Date.now(),
    };
    numeros.forEach((n) => {
      const num = db.numbers.find((x) => x.numero === n);
      num.status = 'reservado';
    });
    db.orders.push(order);

    let qrCode = '';
    let qrBase64 = '';
    let modo = PAYMENT_MODE;

    if (PAYMENT_MODE === 'mercadopago' && MP_TOKEN) {
      const pix = await criarPixMP(total, `Rifa ${db.config.titulo} - nº ${numeros.join(',')}`, { nome, email });
      order.paymentId = pix.paymentId;
      qrCode = pix.qrCode;
      qrBase64 = pix.qrBase64;
    } else {
      // Pix pessoal (ou demo): gera o "copia e cola" com a chave configurada
      qrCode = gerarPixFake(total, db.config);
      qrBase64 = '';
      if (PAYMENT_MODE === 'demo') modo = 'demo';
      else modo = 'pix';
    }
    order.qrCode = qrCode;
    order.qrBase64 = qrBase64;
    saveDB();
    res.json({
      orderId: order.id,
      total,
      qrCode,
      qrBase64,
      paymentId: order.paymentId,
      modo,
      numeros: order.numeros,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Erro interno' });
  }
});

// Consultar status do pagamento (polling do front)
app.get('/api/pagamento/:orderId', (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  res.json({ status: order.status, numeros: order.numeros });
});

// Simular pagamento (somente modo MOCK / demo)
app.post('/api/simular-pagamento/:orderId', (req, res) => {
  if (PAYMENT_MODE !== 'demo') return res.status(400).json({ error: 'Disponível apenas em modo demo' });
  const order = db.orders.find((o) => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
  aprovarPedido(order);
  saveDB();
  res.json({ status: 'approved' });
});

function aprovarPedido(order) {
  order.status = 'approved';
  order.numeros.forEach((n) => {
    const num = db.numbers.find((x) => x.numero === n);
    if (num) num.status = 'pago';
  });
}

// Webhook do Mercado Pago
app.post('/api/webhook', async (req, res) => {
  try {
    let paymentId = null;
    if (req.body && req.body.type === 'payment' && req.body.data && req.body.data.id) {
      paymentId = String(req.body.data.id);
    } else if (req.query && req.query.id) {
      paymentId = String(req.query.id);
    }
    if (!paymentId) return res.sendStatus(200);

    const status = await checarPagamentoMP(paymentId);
    if (status === 'approved') {
      const order = db.orders.find((o) => String(o.paymentId) === paymentId);
      if (order && order.status !== 'approved') {
        aprovarPedido(order);
        saveDB();
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(200);
  }
});
// MP também pode enviar GET de verificação
app.get('/api/webhook', (req, res) => res.sendStatus(200));

// ---------- Admin ----------
app.post('/api/admin/login', (req, res) => {
  const { senha } = req.body || {};
  if (senha === db.config.adminPass) {
    const token = newToken();
    return res.json({ token });
  }
  res.status(401).json({ error: 'Senha incorreta' });
});

app.get('/api/admin/raffle', authMiddleware, (req, res) => {
  releaseExpiredOrders();
  res.json({
    config: db.config,
    numeros: db.numbers,
    orders: db.orders,
    resumo: {
      disponivel: db.numbers.filter((n) => n.status === 'disponivel').length,
      reservado: db.numbers.filter((n) => n.status === 'reservado').length,
      pago: db.numbers.filter((n) => n.status === 'pago').length,
    },
  });
});

app.post('/api/admin/config', authMiddleware, (req, res) => {
  const c = req.body || {};
  const cfg = db.config;
  if (c.titulo !== undefined) cfg.titulo = c.titulo;
  if (c.descricao !== undefined) cfg.descricao = c.descricao;
  if (c.valor !== undefined) cfg.valor = Number(c.valor);
  if (c.contato !== undefined) cfg.contato = c.contato;
  if (c.pagador !== undefined) cfg.pagador = c.pagador;
  if (c.cidade !== undefined) cfg.cidade = c.cidade;
  if (c.pixKey !== undefined) cfg.pixKey = c.pixKey;
  if (c.totalNumeros !== undefined) {
    const tot = parseInt(c.totalNumeros, 10);
    if (tot > 0 && tot !== cfg.totalNumeros) {
      cfg.totalNumeros = tot;
      rebuildNumbers();
    }
  }
  if (c.adminPass) cfg.adminPass = c.adminPass;
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/marcar-pago', authMiddleware, (req, res) => {
  const { numero } = req.body || {};
  const num = db.numbers.find((x) => x.numero === numero);
  if (!num) return res.status(404).json({ error: 'Número não encontrado' });
  num.status = 'pago';
  db.orders.forEach((o) => {
    if (o.numeros.includes(numero)) o.status = 'approved';
  });
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/liberar', authMiddleware, (req, res) => {
  const { numero } = req.body || {};
  const num = db.numbers.find((x) => x.numero === numero);
  if (!num) return res.status(404).json({ error: 'Número não encontrado' });
  num.status = 'disponivel';
  saveDB();
  res.json({ ok: true });
});

app.post('/api/admin/sortear', authMiddleware, (req, res) => {
  const pagos = db.numbers.filter((n) => n.status === 'pago');
  if (pagos.length === 0) return res.status(400).json({ error: 'Nenhum número pago para sortear.' });
  const vencedor = pagos[Math.floor(Math.random() * pagos.length)];
  res.json({ vencedor: vencedor.numero, totalPagos: pagos.length });
});

app.post('/api/admin/reset', authMiddleware, (req, res) => {
  db.orders = [];
  rebuildNumbers();
  saveDB();
  res.json({ ok: true });
});

loadDB();
app.listen(PORT, () => {
  console.log(`Rifa online rodando em ${PUBLIC_URL}`);
  console.log('Modo de pagamento:', PAYMENT_MODE);
});
