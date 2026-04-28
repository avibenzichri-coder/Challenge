import { db } from './firebase-config.js';
import {
  collection, getDocs, addDoc, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Config ────────────────────────────────────────────────
const WHATSAPP_NUMBERS = ['+972542403520'];  // add 2nd number here when ready
const PAGE_SIZE = 24;
const DELIVERY_FEES = { haifa: 15, outside: 20 };

// ── Helpers ───────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(n) {
  return Number.isInteger(n) ? n : n.toFixed(2);
}

// ── State ─────────────────────────────────────────────────
let allProducts      = [];
let filteredProducts = [];
let cart             = {};
let currentPage      = 1;

// ── Screens ───────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── Load Products ─────────────────────────────────────────
async function loadProducts() {
  try {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    allProducts = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.available);
    filteredProducts = allProducts;
    renderProducts();
  } catch (e) {
    console.error('Failed to load products:', e);
    document.getElementById('products-container').innerHTML =
      '<div class="empty-state"><div class="emoji">😕</div><p>שגיאה בטעינת המוצרים. נסה שוב.</p></div>';
  }
}

// ── Render Products ───────────────────────────────────────
function renderProducts() {
  const container = document.getElementById('products-container');
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredProducts.slice(start, start + PAGE_SIZE);

  if (filteredProducts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="emoji">🔍</div><p>לא נמצאו מוצרים</p></div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'products-grid';

  page.forEach(product => {
    const inCart = !!cart[product.id];
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy"
           onerror="this.style.background='#f3eeff';this.src=''">
      <div class="product-info">
        <div class="product-name">${escapeHtml(product.name)}</div>
        <div class="product-price">₪${formatPrice(product.price)}</div>
        <button class="btn-add ${inCart ? 'in-cart' : ''}" data-id="${product.id}">
          ${inCart ? '✓ בעגלה' : 'הוסף לעגלה'}
        </button>
      </div>
    `;
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
  renderPagination();
}

// ── Pagination ────────────────────────────────────────────
function renderPagination() {
  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  pag.innerHTML = '';
  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    if (i === currentPage) btn.classList.add('active');
    btn.addEventListener('click', () => {
      currentPage = i;
      renderProducts();
      window.scrollTo(0, 0);
    });
    pag.appendChild(btn);
  }
}

// ── Search ────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  const term = e.target.value.trim().toLowerCase();
  filteredProducts = term
    ? allProducts.filter(p => p.name.toLowerCase().includes(term))
    : allProducts;
  currentPage = 1;
  renderProducts();
});

// ── Cart ──────────────────────────────────────────────────
function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  if (cart[productId]) {
    cart[productId].qty += 1;
  } else {
    cart[productId] = { ...product, qty: 1 };
  }
  updateCartBadge();
  renderProducts();
}

function updateQty(productId, delta) {
  if (!cart[productId]) return;
  cart[productId].qty += delta;
  if (cart[productId].qty <= 0) delete cart[productId];
  updateCartBadge();
  renderCart();
}

function updateCartBadge() {
  const total = Object.values(cart).reduce((s, i) => s + i.qty, 0);
  document.getElementById('cart-count').textContent = total;
}

function cartTotal() {
  return Object.values(cart).reduce((s, i) => s + i.price * i.qty, 0);
}

function renderCart() {
  const list = document.getElementById('cart-list');
  const items = Object.values(cart);

  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="emoji">🛒</div><p>העגלה ריקה</p></div>';
    document.getElementById('cart-total').textContent = '₪0';
    return;
  }

  list.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cart-item';
    el.innerHTML = `
      <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}"
           onerror="this.style.background='#f3eeff';this.src=''">
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        <div class="cart-item-price">₪${formatPrice(item.price)} ליחידה</div>
      </div>
      <div class="qty-control">
        <button class="qty-btn" data-id="${item.id}" data-delta="-1">−</button>
        <span class="qty-value">${item.qty}</span>
        <button class="qty-btn" data-id="${item.id}" data-delta="1">+</button>
      </div>
    `;
    list.appendChild(el);
  });

  document.getElementById('cart-total').textContent = `₪${cartTotal()}`;
}

// ── Delivery & Order Summary ──────────────────────────────
function getDeliveryFee() {
  const deliveryMethod = document.querySelector('input[name="delivery"]:checked')?.value;
  if (deliveryMethod !== 'delivery') return 0;
  const area = document.querySelector('input[name="area"]:checked')?.value;
  return DELIVERY_FEES[area] || 0;
}

function updateOrderSummary() {
  const itemsTotal   = cartTotal();
  const deliveryFee  = getDeliveryFee();
  const grandTotal   = itemsTotal + deliveryFee;

  document.getElementById('summary-items').textContent      = `₪${itemsTotal}`;
  document.getElementById('summary-grand-total').textContent = `₪${grandTotal}`;

  const deliveryRow = document.getElementById('summary-delivery-row');
  if (deliveryFee > 0) {
    document.getElementById('summary-delivery').textContent = `₪${deliveryFee}`;
    deliveryRow.style.display = 'flex';
  } else {
    deliveryRow.style.display = 'none';
  }
}

// Show/hide delivery details
document.querySelectorAll('input[name="delivery"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const details = document.getElementById('delivery-details');
    const isDelivery = radio.value === 'delivery';
    details.style.display = isDelivery ? 'block' : 'none';
    document.getElementById('delivery-address').required = isDelivery;
    updateOrderSummary();
  });
});

// Update summary when area changes
document.querySelectorAll('input[name="area"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const fee = DELIVERY_FEES[radio.value];
    document.getElementById('delivery-fee-note').textContent = `דמי משלוח: ₪${fee}`;
    updateOrderSummary();
  });
});

// ── Order Submission ──────────────────────────────────────
async function submitOrder({ name, phone, notes, payment, delivery, address, area }) {
  const items = Object.values(cart).map(i => ({
    productId: i.id,
    name:      i.name,
    price:     i.price,
    qty:       i.qty,
  }));
  const itemsTotal  = cartTotal();
  const deliveryFee = delivery === 'delivery' ? (DELIVERY_FEES[area] || 0) : 0;
  const total       = itemsTotal + deliveryFee;

  await addDoc(collection(db, 'orders'), {
    customerName: name,
    phone,
    notes,
    payment,
    delivery,
    address: address || '',
    area:    area || '',
    deliveryFee,
    items,
    total,
    status: 'new',
    createdAt: serverTimestamp(),
  });

  return { name, phone, notes, payment, delivery, address, area, deliveryFee, items, total };
}

function buildWhatsAppMessage({ name, phone, notes, payment, delivery, address, area, deliveryFee, items, total }) {
  const paymentLabel  = payment === 'cash' ? 'מזומן' : 'ביט';
  const deliveryLabel = delivery === 'self' ? 'איסוף עצמי' : 'משלוח';
  const lines = items.map(i => `• ${i.name} ×${i.qty} = ₪${i.price * i.qty}`).join('\n');

  let msg = `הזמנה חדשה מ-${name}!\nטלפון: ${phone}\n\nפריטים:\n${lines}\n\nסכום פריטים: ₪${total - deliveryFee}`;
  if (deliveryFee > 0) msg += `\nדמי משלוח (${area === 'haifa' ? 'חיפה' : 'מחוץ לחיפה'}): ₪${deliveryFee}`;
  msg += `\n\nסה"כ לתשלום: ₪${total}`;
  msg += `\nתשלום: ${paymentLabel}`;
  msg += `\nאופן קבלה: ${deliveryLabel}`;
  if (address) msg += `\nכתובת: ${address}`;
  if (notes)   msg += `\n\nהערות: ${notes}`;

  return encodeURIComponent(msg);
}

// ── Event Listeners ───────────────────────────────────────

// Add to cart (delegated)
document.getElementById('products-container').addEventListener('click', e => {
  const btn = e.target.closest('.btn-add');
  if (btn) addToCart(btn.dataset.id);
});

// Cart qty buttons (delegated)
document.getElementById('cart-list').addEventListener('click', e => {
  const btn = e.target.closest('.qty-btn');
  if (btn) updateQty(btn.dataset.id, parseInt(btn.dataset.delta));
});

// Open cart
document.getElementById('btn-open-cart').addEventListener('click', () => {
  renderCart();
  showScreen('cart');
});

// Back to store
document.getElementById('btn-back-store').addEventListener('click', () => showScreen('store'));

// Go to order form
document.getElementById('btn-to-order').addEventListener('click', () => {
  if (Object.keys(cart).length === 0) {
    alert('העגלה ריקה! הוסף מוצרים לפני ההזמנה.');
    return;
  }
  updateOrderSummary();
  showScreen('order');
});

// Back to cart
document.getElementById('btn-back-cart').addEventListener('click', () => showScreen('cart'));

// Submit order
document.getElementById('order-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn      = document.getElementById('btn-submit-order');
  const name     = document.getElementById('customer-name').value.trim();
  const phone    = document.getElementById('customer-phone').value.trim();
  const notes    = document.getElementById('customer-notes').value.trim();
  const payment  = document.querySelector('input[name="payment"]:checked')?.value;
  const delivery = document.querySelector('input[name="delivery"]:checked')?.value;
  const address  = document.getElementById('delivery-address').value.trim();
  const area     = document.querySelector('input[name="area"]:checked')?.value;

  if (!payment) { alert('נא לבחור אמצעי תשלום'); return; }
  if (!delivery) { alert('נא לבחור אופן קבלה'); return; }
  if (delivery === 'delivery' && !address) { alert('נא להזין כתובת למשלוח'); return; }
  if (delivery === 'delivery' && !area) { alert('נא לבחור אזור משלוח'); return; }

  btn.disabled = true;
  btn.textContent = 'שולח...';

  try {
    const orderData = await submitOrder({ name, phone, notes, payment, delivery, address, area });

    // Build WhatsApp URL before clearing cart (synchronous)
    const msg = buildWhatsAppMessage(orderData);
    const waUrl = `https://wa.me/${WHATSAPP_NUMBERS[0].replace(/\D/g, '')}?text=${msg}`;
    document.getElementById('btn-whatsapp').href = waUrl;

    cart = {};
    updateCartBadge();
    document.getElementById('order-form').reset();
    document.getElementById('delivery-details').style.display = 'none';
    showScreen('confirm');
  } catch (err) {
    console.error('Order failed:', err);
    alert('שגיאה בשליחת ההזמנה. נסה שוב.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'שלח הזמנה 🎉';
  }
});

// Back home from confirmation
document.getElementById('btn-back-home').addEventListener('click', () => {
  showScreen('store');
});

// ── Init ──────────────────────────────────────────────────
loadProducts();
