import { db, auth } from './firebase-config.js';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc, doc,
  query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── Image → Base64 ────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    // Resize to max 600px and compress before storing
    const img = new Image();
    img.onload = () => {
      const MAX = 600;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ── Auth ──────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-admin').style.display = 'block';
    loadProducts();
  } else {
    document.getElementById('screen-login').style.display = 'block';
    document.getElementById('screen-admin').style.display = 'none';
  }
});

document.getElementById('btn-login').addEventListener('click', async () => {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch {
    errEl.textContent = 'אימייל או סיסמה שגויים';
  }
});

document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

// ── Tabs ──────────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.admin-content').forEach(c => c.style.display = 'none');
    const id = 'tab-' + tab.dataset.tab;
    document.getElementById(id).style.display = 'block';
    if (tab.dataset.tab === 'orders') loadOrders();
    if (tab.dataset.tab === 'stats')  loadStats();
  });
});

// ── Products ──────────────────────────────────────────────
let products = [];
let editingProductId = null;

async function loadProducts() {
  const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderProductsTable();
}

function renderProductsTable() {
  const table = document.getElementById('products-table');
  if (products.length === 0) {
    table.innerHTML = '<div class="empty-state"><div class="emoji">📦</div><p>אין מוצרים עדיין</p></div>';
    return;
  }
  table.innerHTML = '';
  products.forEach(p => {
    const row = document.createElement('div');
    row.className = 'product-row';
    row.innerHTML = `
      <img src="${p.imageUrl || ''}" alt="${p.name}"
           onerror="this.style.background='#f3eeff';this.src=''">
      <span class="row-name">${p.name}</span>
      <span class="row-price">₪${p.price}</span>
      <button class="toggle-available ${p.available ? 'available' : ''}" data-id="${p.id}" data-available="${p.available}">
        ${p.available ? '✓ זמין' : '✗ מוסתר'}
      </button>
      <button class="btn-edit" data-id="${p.id}">ערוך</button>
      <button class="btn-delete" data-id="${p.id}">מחק</button>
    `;
    table.appendChild(row);
  });
}

// Delegated events for product table
document.getElementById('products-table').addEventListener('click', async e => {
  const id = e.target.dataset.id;
  if (!id) return;

  if (e.target.classList.contains('toggle-available')) {
    const current = e.target.dataset.available === 'true';
    await updateDoc(doc(db, 'products', id), { available: !current });
    await loadProducts();
  }

  if (e.target.classList.contains('btn-edit')) {
    const product = products.find(p => p.id === id);
    openModal(product);
  }

  if (e.target.classList.contains('btn-delete')) {
    if (!confirm(`למחוק את "${products.find(p => p.id === id)?.name}"?`)) return;
    await deleteDoc(doc(db, 'products', id));
    await loadProducts();
  }
});

// ── Product Modal ─────────────────────────────────────────
function openModal(product = null) {
  editingProductId = product?.id || null;
  document.getElementById('modal-title').textContent  = product ? 'ערוך מוצר' : 'הוסף מוצר';
  document.getElementById('prod-name').value          = product?.name || '';
  document.getElementById('prod-price').value         = product?.price || '';
  document.getElementById('prod-available').checked   = product?.available ?? true;
  document.getElementById('prod-image').value         = '';
  const preview = document.getElementById('prod-image-preview');
  if (product?.imageUrl) {
    preview.src = product.imageUrl;
    preview.classList.add('visible');
  } else {
    preview.classList.remove('visible');
  }
  document.getElementById('product-modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('product-modal').classList.add('hidden');
  editingProductId = null;
}

document.getElementById('btn-new-product').addEventListener('click', () => openModal());
document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
document.getElementById('product-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('product-modal')) closeModal();
});

// Image preview
document.getElementById('prod-image').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('prod-image-preview');
  preview.src = URL.createObjectURL(file);
  preview.classList.add('visible');
});

document.getElementById('btn-modal-save').addEventListener('click', async () => {
  const name      = document.getElementById('prod-name').value.trim();
  const price     = parseFloat(document.getElementById('prod-price').value);
  const available = document.getElementById('prod-available').checked;
  const file      = document.getElementById('prod-image').files[0];

  if (!name || isNaN(price)) {
    alert('נא למלא שם ומחיר');
    return;
  }

  const btn = document.getElementById('btn-modal-save');
  btn.disabled = true;
  btn.textContent = 'שומר...';

  try {
    let imageUrl = editingProductId
      ? products.find(p => p.id === editingProductId)?.imageUrl || ''
      : '';

    if (file) {
      imageUrl = await fileToBase64(file);
      // Firestore doc limit is 1MB — image must stay under 800KB (leaving room for other fields)
      const sizeKB = Math.round((imageUrl.length * 3) / 4 / 1024);
      if (sizeKB > 800) {
        alert('הארכיון מלא. אנא מחקו פריטים קיימים ונסו שוב.');
        btn.disabled = false;
        btn.textContent = 'שמור';
        return;
      }
    }

    if (editingProductId) {
      await updateDoc(doc(db, 'products', editingProductId), { name, price, available, imageUrl });
    } else {
      await addDoc(collection(db, 'products'), {
        name, price, available, imageUrl, createdAt: serverTimestamp()
      });
    }

    closeModal();
    await loadProducts();
  } catch (err) {
    console.error('Save failed:', err);
    alert('שגיאה בשמירה. נסה שוב.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'שמור';
  }
});

// ── Orders ────────────────────────────────────────────────
let allOrders = [];
let activeFilter = 'all';

async function loadOrders() {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
}

function renderOrders() {
  const filtered = activeFilter === 'all'
    ? allOrders
    : allOrders.filter(o => o.status === activeFilter);

  const list = document.getElementById('orders-list');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="emoji">📋</div><p>אין הזמנות</p></div>';
    return;
  }

  const STATUS_LABEL = { new: 'חדש', paid: 'שולם', shipped: 'נשלח' };
  const STATUS_CLASS = { new: 'status-new', paid: 'status-paid', shipped: 'status-shipped' };

  list.innerHTML = '';
  filtered.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    const date = order.createdAt?.toDate
      ? order.createdAt.toDate().toLocaleDateString('he-IL')
      : '';
    const itemsText    = order.items?.map(i => `${i.name} ×${i.qty}`).join(' | ') || '';
    const paymentLabel  = order.payment === 'bit' ? '📱 ביט' : '💵 מזומן';
    const deliveryLabel = order.delivery === 'delivery'
      ? `🚗 משלוח${order.address ? ' — ' + order.address : ''}${order.deliveryFee ? ' (₪' + order.deliveryFee + ')' : ''}`
      : '🏠 איסוף עצמי';

    card.innerHTML = `
      <div class="order-card-header">
        <div>
          <div class="order-customer">${order.customerName}</div>
          <div class="order-phone">${order.phone} ${date ? '· ' + date : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="order-total">₪${order.total}</span>
          <span class="status-badge ${STATUS_CLASS[order.status]}">${STATUS_LABEL[order.status]}</span>
        </div>
      </div>
      <div class="order-items">${itemsText}</div>
      <div class="order-notes">${paymentLabel} &nbsp;|&nbsp; ${deliveryLabel}</div>
      ${order.notes ? `<div class="order-notes">הערות: ${order.notes}</div>` : ''}
      <div class="order-actions">
        ${order.status === 'new'     ? `<button class="btn-status btn-mark-paid"    data-id="${order.id}">✓ סמן שולם</button>` : ''}
        ${order.status !== 'shipped' ? `<button class="btn-status btn-mark-shipped" data-id="${order.id}">📦 סמן נשלח</button>` : ''}
      </div>
    `;
    list.appendChild(card);
  });
}

document.getElementById('orders-list').addEventListener('click', async e => {
  const btn = e.target.closest('.btn-status');
  if (!btn) return;
  const id = btn.dataset.id;
  const newStatus = btn.classList.contains('btn-mark-paid') ? 'paid' : 'shipped';
  await updateDoc(doc(db, 'orders', id), { status: newStatus });
  await loadOrders();
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.status;
    renderOrders();
  });
});

// ── Statistics ────────────────────────────────────────────
async function loadStats() {
  const q = query(collection(db, 'orders'));
  const snap = await getDocs(q);
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const now = new Date();
  const oneWeek  = new Date(now - 7  * 24 * 60 * 60 * 1000);
  const oneMonth = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const countNew     = orders.filter(o => o.status === 'new').length;
  const countShipped = orders.filter(o => o.status === 'shipped').length;

  const sold = orders.filter(o => o.status !== 'new');
  const salesWeek  = sold
    .filter(o => o.createdAt?.toDate?.() >= oneWeek)
    .reduce((s, o) => s + (o.total || 0), 0);
  const salesMonth = sold
    .filter(o => o.createdAt?.toDate?.() >= oneMonth)
    .reduce((s, o) => s + (o.total || 0), 0);
  const salesTotal = sold.reduce((s, o) => s + (o.total || 0), 0);

  document.getElementById('stats-grid').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">🆕 הזמנות חדשות</div>
      <div class="stat-value">${countNew}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">📦 נשלחו</div>
      <div class="stat-value">${countShipped}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">💰 מכירות שבוע</div>
      <div class="stat-value money">₪${salesWeek}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">💰 מכירות חודש</div>
      <div class="stat-value money">₪${salesMonth}</div>
    </div>
    <div class="stat-card" style="grid-column:1/-1">
      <div class="stat-label">💎 סה"כ מכירות</div>
      <div class="stat-value money">₪${salesTotal}</div>
    </div>
  `;

  // Top products
  const qtys = {};
  orders.forEach(o => {
    o.items?.forEach(i => {
      qtys[i.name] = (qtys[i.name] || 0) + (i.qty || 0);
    });
  });
  const top = Object.entries(qtys).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topEl = document.getElementById('top-products-list');
  if (top.length === 0) {
    topEl.innerHTML = '<p style="color:var(--gray)">אין נתונים עדיין</p>';
    return;
  }
  topEl.innerHTML = top.map(([name, qty], i) => `
    <div class="top-product-row">
      <span class="top-rank">${i + 1}</span>
      <span class="top-name">${name}</span>
      <span class="top-qty">×${qty}</span>
    </div>
  `).join('');
}
