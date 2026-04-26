import { db } from './firebase-config.js';
import {
  collection, getDocs, addDoc, query, orderBy, limit, startAfter, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Config ────────────────────────────────────────────────
const WHATSAPP_NUMBERS = ['+972542403520'];  // add 2nd number here when ready
const PAGE_SIZE = 24;

// ── State ─────────────────────────────────────────────────
let allProducts   = [];   // full list loaded from Firestore
let filteredProducts = []; // after search filter
let cart          = {};   // { productId: { ...product, qty } }
let currentPage   = 1;

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
      <img src="${product.imageUrl || ''}" alt="${product.name}" loading="lazy"
           onerror="this.style.background='#f3eeff';this.src=''">
      <div class="product-info">
        <div class="product-name">${product.name}</div>
        <div class="product-price">₪${product.price}</div>
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
      <img src="${item.imageUrl || ''}" alt="${item.name}"
           onerror="this.style.background='#f3eeff';this.src=''">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">₪${item.price} ליחידה</div>
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

// ── Order Submission ──────────────────────────────────────
async function submitOrder(name, phone, notes) {
  const items = Object.values(cart).map(i => ({
    productId: i.id,
    name:      i.name,
    price:     i.price,
    qty:       i.qty,
  }));
  const total = cartTotal();

  await addDoc(collection(db, 'orders'), {
    customerName: name,
    phone,
    notes,
    items,
    total,
    status: 'new',
    createdAt: serverTimestamp(),
  });

  return { name, phone, notes, items, total };
}

function buildWhatsAppMessage({ name, phone, notes, items, total }) {
  const lines = items.map(i => `• ${i.name} ×${i.qty} = ₪${i.price * i.qty}`).join('\n');
  let msg = `הזמנה חדשה מ-${name}!\nטלפון: ${phone}\n\nפריטים:\n${lines}\n\nסה"כ: ₪${total}`;
  if (notes) msg += `\n\nהערות: ${notes}`;
  return encodeURIComponent(msg);
}

function openWhatsApp(orderData) {
  const msg = buildWhatsAppMessage(orderData);
  WHATSAPP_NUMBERS.forEach(num => {
    const clean = num.replace(/\D/g, '');
    window.open(`https://wa.me/${clean}?text=${msg}`, '_blank');
  });
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
  showScreen('order');
});

// Back to cart
document.getElementById('btn-back-cart').addEventListener('click', () => showScreen('cart'));

// Submit order
document.getElementById('order-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn  = document.getElementById('btn-submit-order');
  const name  = document.getElementById('customer-name').value.trim();
  const phone = document.getElementById('customer-phone').value.trim();
  const notes = document.getElementById('customer-notes').value.trim();

  btn.disabled = true;
  btn.textContent = 'שולח...';

  try {
    const orderData = await submitOrder(name, phone, notes);
    cart = {};
    updateCartBadge();
    showScreen('confirm');
    openWhatsApp(orderData);
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
