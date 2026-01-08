const initialProducts = [
    { id:1, name:"Tabung Gas 12kg", price:230000, stock:5, image:"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQwpflIgpcCt9uD1vQwpcXlwmsB7H9FI9Bjeg&s", description:"Tabung gas 12kg, cocok untuk kebutuhan rumah tangga besar dan usaha kecil." },
    { id:2, name:"Tabung Gas 5kg",  price:120000, stock:10, image:"https://down-id.img.susercontent.com/file/2631ae627a23030df44d74464dedba0a", description:"Tabung gas 5kg, praktis untuk rumah tangga kecil atau portable." },
    { id:3, name:"Tabung Gas 3kg",  price:80000,  stock:15, image:"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR2qUf0OG8Lp4hkEg9v9zkQ6xhxWDEnhQA9Vg&s", description:"Tabung gas 3kg, ringan dan mudah dibawa." }
];

// Cloudinary (tetap seperti sebelumnya)
const CLOUDINARY_CLOUD_NAME = "drqzdt0r9";
const CLOUDINARY_UPLOAD_PRESET = "unsigned_products";

async function uploadToCloudinary(file) {
  if (!file) return null;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
    throw new Error('Cloudinary belum dikonfigurasi. Set CLOUDINARY_CLOUD_NAME dan CLOUDINARY_UPLOAD_PRESET di script.js untuk mengaktifkan upload gambar dari browser.');
  }
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('Upload Cloudinary gagal: ' + txt);
  }
  const data = await res.json();
  return data.secure_url;
}

// ---------------- storage helpers ----------------
function getProductsFromStorage(){
  try { return JSON.parse(localStorage.getItem('products') || 'null') || null; } catch(e){ return null; }
}
function saveProductsToStorage(arr){ localStorage.setItem('products', JSON.stringify(arr)); }
function seedProductsIfNeeded(){ if (!getProductsFromStorage()){ saveProductsToStorage(initialProducts); } }

// ---- legacy local users storage and migration (ke Firestore jika tersedia) ----
function getUsersLocal(){
  const raw = localStorage.getItem('users');
  if (!raw) {
    const empty = {};
    localStorage.setItem('users', JSON.stringify(empty));
    return empty;
  }
  try {
    const parsed = JSON.parse(raw);
    const out = {};
    Object.entries(parsed).forEach(([k,v])=>{
      if (typeof v === 'string') {
        out[k] = { password: v, role: (k === 'admin' ? 'admin' : 'user') };
      } else if (v && typeof v === 'object') {
        if (v.password && v.role) out[k] = { password: v.password, role: v.role };
        else if (v.password && v.isAdmin !== undefined) out[k] = { password: v.password, role: v.isAdmin ? 'admin' : 'user' };
        else if (v.password) out[k] = { password: v.password, role: 'user' };
        else out[k] = { password: btoa(String(v)), role: 'user' };
      } else {
        out[k] = { password: btoa(String(v)), role: 'user' };
      }
    });
    localStorage.setItem('users', JSON.stringify(out));
    return out;
  } catch(e) {
    const empty = {};
    localStorage.setItem('users', JSON.stringify(empty));
    return empty;
  }
}
function saveUsersLocal(u){ localStorage.setItem('users', JSON.stringify(u)); }

// hashing (legacy & fallback)
function hash(pw){ try { return btoa(pw); } catch(e){ return pw; } }
function base64ArrayBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
async function asyncHash(pw){
  try {
    const enc = new TextEncoder();
    const data = enc.encode(pw);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return base64ArrayBuffer(hashBuffer);
  } catch(e){
    return hash(pw);
  }
}

let currentUser = localStorage.getItem('currentUser') || null;
let currentUserRole = null; // 'user' | 'manager' | 'admin' or null
let cart = [];

// cart per user (localStorage)
function loadCartForUser(){ cart = []; if (!currentUser) return; try { cart = JSON.parse(localStorage.getItem(`cart_${currentUser}`) || '[]'); } catch(e){ cart = []; } }
function saveCartForUser(){ if (!currentUser) return; localStorage.setItem(`cart_${currentUser}`, JSON.stringify(cart)); }

// orders per user stays local
function getOrdersForUser(){ if (!currentUser) return []; try { return JSON.parse(localStorage.getItem(`orders_${currentUser}`) || '[]'); } catch(e){ return []; } }
function saveOrderForUser(order){ if (!currentUser) return; const arr = getOrdersForUser(); arr.unshift(order); localStorage.setItem(`orders_${currentUser}`, JSON.stringify(arr)); }

// utils
function escapeHtml(s){ if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function showToast(msg, type='info'){ const t = document.getElementById('toast'); if(!t) return; t.textContent = msg; t.classList.add('show'); setTimeout(()=> t.classList.remove('show'), 3000); }

// ---------------- Firebase helpers (optional) ----------------
// Expect window.firebaseAuth and window.firebaseDb (set by firebase-config.js) if Firebase dikonfigurasi.
function firebaseAvailable(){ return (window.firebaseAuth && window.firebaseDb); }

// We will use username -> "fake email" mapping: username + "@local.toko"
// NOTE: this is a convenience for a username-only UI; in production use real email addresses.
function usernameToEmail(username){ return `${username}@local.toko`; }

// fetch role doc from Firestore (if available)
async function fetchRoleFromFirestore(username){
  if (!firebaseAvailable()) return null;
  try {
    const doc = await window.firebaseDb.collection('users').doc(username).get();
    if (doc.exists) {
      const data = doc.data();
      return data.role || 'user';
    }
    return null;
  } catch(e){
    console.error('fetchRoleFromFirestore error', e);
    return null;
  }
}
async function setRoleInFirestore(username, role){
  if (!firebaseAvailable()) return false;
  try {
    await window.firebaseDb.collection('users').doc(username).set({ role }, { merge: true });
    return true;
  } catch(e){
    console.error('setRoleInFirestore', e);
    return false;
  }
}
async function fetchAllUsersFromFirestore(){
  if (!firebaseAvailable()) return {};
  try {
    const snap = await window.firebaseDb.collection('users').get();
    const out = {};
    snap.forEach(doc=> { out[doc.id] = { role: doc.data().role || 'user' }; });
    return out;
  } catch(e){
    console.error('fetchAllUsersFromFirestore', e);
    return {};
  }
}

// ---------------- product management ----------------
function getProducts(){ const p = getProductsFromStorage(); return p ? p : []; }
function findProduct(id){ return getProducts().find(x=>x.id===Number(id)); }
function getAvailableStock(id){ const prod = findProduct(id); return prod ? Number(prod.stock||0) : 0; }
function updateProductStock(id, newStock){ const prods = getProducts(); const idx = prods.findIndex(p=>p.id===Number(id)); if (idx === -1) return false; prods[idx].stock = Number(newStock); saveProductsToStorage(prods); return true; }
function addProduct(product){ const prods = getProducts(); product.id = prods.length ? (Math.max(...prods.map(p=>p.id))+1) : 1; prods.push(product); saveProductsToStorage(prods); return product.id; }
function updateProduct(product){ const prods = getProducts(); const idx = prods.findIndex(p=>p.id===Number(product.id)); if (idx === -1) return false; prods[idx] = product; saveProductsToStorage(prods); return true; }
function deleteProduct(id){ let prods = getProducts(); prods = prods.filter(p=>p.id!==Number(id)); saveProductsToStorage(prods); return true; }

// ---------------- roles & permission helpers ----------------
// Note: If Firebase digunakan, currentUserRole di-set saat login/logout.
// getUserRole fallback to local storage if needed.
function getUserRoleFromLocal(username){
  const users = getUsersLocal();
  if (!users[username]) return null;
  return users[username].role || 'user';
}
async function getUserRole(username){
  if (!username) return null;
  if (firebaseAvailable()){
    const r = await fetchRoleFromFirestore(username);
    if (r) return r;
    // fallback to local if firestore tidak punya doc:
    return getUserRoleFromLocal(username) || 'user';
  } else {
    return getUserRoleFromLocal(username);
  }
}
function isAdminUser(){ return currentUser && currentUserRole === 'admin'; }
function isManagerOrAdmin(){ return currentUser && (currentUserRole === 'admin' || currentUserRole === 'manager'); }
function requireAdminAction(){ if (!isAdminUser()){ showToast('Akses ditolak: hanya admin', 'error'); return false; } return true; }
function requireManagerOrAdmin(){ if (!isManagerOrAdmin()){ showToast('Akses ditolak: hanya admin/manager', 'error'); return false; } return true; }

// ---------------- header & auth UI ----------------
function updateHeaderUI(){
  const userInfo = document.getElementById('user-info');
  const loginBtn = document.getElementById('login-btn');
  const registerLink = document.getElementById('register-link');
  if (userInfo) userInfo.textContent = currentUser ? `👤 ${currentUser} (${currentUserRole||getUserRoleFromLocal(currentUser)||'user'})` : '';
  if (loginBtn){
    if (currentUser){
      loginBtn.textContent = 'Logout';
      loginBtn.onclick = () => { logout(); };
      if (registerLink) registerLink.style.display = 'none';
    } else {
      loginBtn.textContent = 'Login';
      loginBtn.onclick = () => { window.location.href = 'login.html'; };
      if (registerLink) registerLink.style.display = 'inline-block';
    }
  }
  const cnt = document.getElementById('cart-count'); if (cnt) cnt.textContent = cart.reduce((s,i)=>s+(i.qty||0),0);
}

// ---------------- render product list (index) ----------------
function makeProductCard(p){
  const available = getAvailableStock(p.id);
  const stockText = available > 0 ? `Stok: ${available}` : 'Kosong';
  const disabled = available <= 0;

  const div = document.createElement('div');
  div.className = 'product-card';

  const aImg = document.createElement('a');
  aImg.className = 'view-link';
  aImg.href = `product.html?id=${p.id}`;
  aImg.title = p.name;

  const img = document.createElement('img');
  img.src = p.image;
  img.alt = p.name;
  aImg.appendChild(img);
  div.appendChild(aImg);

  const h3 = document.createElement('h3');
  const aTitle = document.createElement('a');
  aTitle.className = 'view-link';
  aTitle.href = `product.html?id=${p.id}`;
  aTitle.textContent = p.name;
  h3.appendChild(aTitle);
  div.appendChild(h3);

  const priceP = document.createElement('p');
  priceP.textContent = `Rp${Number(p.price).toLocaleString()}`;
  div.appendChild(priceP);

  const stockP = document.createElement('p');
  stockP.style.margin = '6px 0 0';
  stockP.style.color = available > 0 ? '#276870' : '#c0392b';
  stockP.style.fontWeight = '600';
  stockP.textContent = stockText;
  div.appendChild(stockP);

  const actions = document.createElement('div');
  actions.className = 'product-actions';

  const viewLink = document.createElement('a');
  viewLink.className = 'view-link';
  viewLink.href = `product.html?id=${p.id}`;
  viewLink.textContent = 'Lihat';
  actions.appendChild(viewLink);

  const btn = document.createElement('button');
  btn.textContent = 'Tambah ke Keranjang';
  if (disabled) {
    btn.disabled = true;
  } else {
    btn.addEventListener('click', ()=> handleAddToCart(p.id));
  }
  actions.appendChild(btn);

  div.appendChild(actions);

  return div;
}
function renderProducts(){
  const container = document.getElementById('product-container');
  if (!container) return;
  const prods = getProducts();
  const q = (document.getElementById('search-input') && document.getElementById('search-input').value || '').toLowerCase().trim();
  const stockFilter = document.getElementById('filter-stock') ? document.getElementById('filter-stock').value : 'all';
  container.innerHTML = '';
  prods.filter(p=>{
    if (q && !p.name.toLowerCase().includes(q) && !(p.description||'').toLowerCase().includes(q)) return false;
    if (stockFilter === 'in' && getAvailableStock(p.id) <= 0) return false;
    if (stockFilter === 'out' && getAvailableStock(p.id) > 0) return false;
    return true;
  }).forEach(p => container.appendChild(makeProductCard(p)));
}

// ---------------- product detail page ----------------
function renderProductDetail(){
  const el = document.getElementById('product-detail'); if (!el) return;
  const params = new URLSearchParams(location.search); const id = parseInt(params.get('id'),10);
  const product = findProduct(id); if (!product){ el.innerHTML = `<div class="product-detail"><div style="padding:20px">Produk tidak ditemukan. <a href="index.html">Kembali</a></div></div>`; return; }
  const available = getAvailableStock(product.id);

  el.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'product-detail';

  const left = document.createElement('div');
  left.className = 'left';
  const img = document.createElement('img');
  img.src = product.image;
  img.alt = product.name;
  left.appendChild(img);

  const right = document.createElement('div');
  right.className = 'right';

  const h2 = document.createElement('h2');
  h2.textContent = product.name;
  right.appendChild(h2);

  const priceDiv = document.createElement('div');
  priceDiv.className = 'price';
  priceDiv.textContent = `Rp${product.price.toLocaleString()}`;
  right.appendChild(priceDiv);

  const descDiv = document.createElement('div');
  descDiv.className = 'desc';
  descDiv.textContent = product.description;
  right.appendChild(descDiv);

  const stockDiv = document.createElement('div');
  stockDiv.style.marginBottom = '12px';
  stockDiv.style.color = available>0 ? '#276870' : '#c0392b';
  stockDiv.style.fontWeight = '700';
  stockDiv.textContent = `Stok: ${available>0?available:'Kosong'}`;
  right.appendChild(stockDiv);

  const qtyRow = document.createElement('div');
  qtyRow.className = 'qty-row';
  const lbl = document.createElement('label');
  lbl.textContent = 'Jumlah:';
  qtyRow.appendChild(lbl);
  const minusBtn = document.createElement('button');
  minusBtn.className = 'qty-btn';
  minusBtn.textContent = '-';
  minusBtn.addEventListener('click', ()=> changeQty(-1));
  qtyRow.appendChild(minusBtn);
  const qtyInput = document.createElement('input');
  qtyInput.id = 'detail-qty';
  qtyInput.type = 'number';
  qtyInput.value = 1;
  qtyInput.min = 1;
  qtyRow.appendChild(qtyInput);
  const plusBtn = document.createElement('button');
  plusBtn.className = 'qty-btn';
  plusBtn.textContent = '+';
  plusBtn.addEventListener('click', ()=> changeQty(1));
  qtyRow.appendChild(plusBtn);
  right.appendChild(qtyRow);

  const actions = document.createElement('div');
  const addCartBtn = document.createElement('button');
  addCartBtn.className = 'add-cart-btn';
  addCartBtn.textContent = 'Tambah ke Keranjang';
  if (available <= 0) addCartBtn.disabled = true;
  addCartBtn.addEventListener('click', ()=> addFromDetail(product.id));
  actions.appendChild(addCartBtn);

  const contLink = document.createElement('a');
  contLink.href = 'index.html';
  contLink.style.marginLeft = '12px';
  contLink.style.color = '#127174';
  contLink.textContent = 'Lanjut Belanja';
  actions.appendChild(contLink);

  right.appendChild(actions);

  wrapper.appendChild(left);
  wrapper.appendChild(right);
  el.appendChild(wrapper);
}
function changeQty(delta){ const q = document.getElementById('detail-qty'); if (!q) return; let v = parseInt(q.value,10) || 1; v += delta; if (v<1) v=1; q.value = v; }
function addFromDetail(productId){
  const q = document.getElementById('detail-qty'); const qty = q ? (parseInt(q.value,10)||1) : 1;
  const available = getAvailableStock(productId); const inCart = (cart.find(i=>i.id===productId) || {}).qty || 0;
  if (qty + inCart > available){ showToast(`Stok tidak mencukupi. Tersedia: ${available - inCart}`, 'error'); return; }
  if (!currentUser){ localStorage.setItem('redirectAfterLogin', `add:${productId}:${qty}`); window.location.href='login.html'; return; }
  const prod = findProduct(productId); if (!prod) return;
  const found = cart.find(c=>c.id===productId); if (found) found.qty += qty; else cart.push({...prod, qty});
  saveCartForUser(); updateCartUI(); showToast(`${prod.name} x${qty} ditambahkan ke keranjang`);
}

// ---------------- cart actions ----------------
function handleAddToCart(productId){
  const available = getAvailableStock(productId); const inCart = (cart.find(i=>i.id===productId) || {}).qty || 0;
  if (inCart + 1 > available){ showToast('Stok tidak mencukupi', 'error'); return; }
  if (!currentUser){ localStorage.setItem('redirectAfterLogin', `add:${productId}:1`); window.location.href='login.html'; return; }
  addToCart(productId);
}
function addToCart(productId){ const prod = findProduct(productId); if (!prod) return; const found = cart.find(c=>c.id===productId); if (found) found.qty += 1; else cart.push({...prod, qty:1}); saveCartForUser(); updateCartUI(); showToast(`${prod.name} ditambahkan ke keranjang`); }
function decreaseCartQty(productId){ const item = cart.find(i=>i.id===productId); if (!item) return; if (item.qty > 1) item.qty--; else cart = cart.filter(i=>i.id!==productId); saveCartForUser(); updateCartUI(); }
function increaseCartQty(productId){ const available = getAvailableStock(productId); const item = cart.find(i=>i.id===productId); if (!item) return; if (item.qty + 1 > available){ showToast('Stok tidak mencukupi', 'error'); return; } item.qty++; saveCartForUser(); updateCartUI(); }
function removeFromCart(productId){ cart = cart.filter(i=>i.id!==productId); saveCartForUser(); updateCartUI(); }
function emptyCart(){ cart = []; saveCartForUser(); updateCartUI(); showToast('Keranjang dikosongkan'); }
function updateCartUI(){ const countEl = document.getElementById('cart-count'), list = document.getElementById('cart-items'), totalEl = document.getElementById('cart-total'); if (!countEl || !list || !totalEl) return; const totalQty = cart.reduce((s,i)=>s+(i.qty||0),0); countEl.textContent = totalQty; list.innerHTML = ''; let total = 0; cart.forEach(item=>{ total += item.price * (item.qty||0); const li = document.createElement('li');
  const nameSpan = document.createElement('span');
  nameSpan.textContent = `${item.name} x ${item.qty}`;
  li.appendChild(nameSpan);

  const controls = document.createElement('span');
  controls.style.marginLeft = '8px';

  const decBtn = document.createElement('button');
  decBtn.textContent = '-';
  decBtn.addEventListener('click', ()=> decreaseCartQty(item.id));
  controls.appendChild(decBtn);

  const incBtn = document.createElement('button');
  incBtn.textContent = '+';
  incBtn.addEventListener('click', ()=> increaseCartQty(item.id));
  controls.appendChild(incBtn);

  const remBtn = document.createElement('button');
  remBtn.textContent = 'Hapus';
  remBtn.style.marginLeft = '8px';
  remBtn.addEventListener('click', ()=> removeFromCart(item.id));
  controls.appendChild(remBtn);

  li.appendChild(controls);
  list.appendChild(li);
  }); totalEl.textContent = 'Rp' + total.toLocaleString(); saveCartForUser(); }

// ---------------- checkout & orders ----------------
function proceedToCheckout(){ if (!currentUser){ localStorage.setItem('redirectAfterLogin','showCart'); window.location.href='login.html'; return; } if (!cart.length){ showToast('Keranjang kosong', 'error'); return; } window.location.href = 'checkout.html'; }
function renderCheckoutItems(){ const el = document.getElementById('checkout-items'); if (!el) return; if (!currentUser){ window.location.href='login.html'; return; } el.innerHTML = ''; let total = 0; cart.forEach(i=>{ total += i.price * i.qty; const row = document.createElement('div'); row.textContent = `${i.name} x ${i.qty} — Rp${(i.price*i.qty).toLocaleString()}`; el.appendChild(row); }); const sub = document.createElement('div'); sub.style.marginTop = '8px'; sub.style.fontWeight = '700'; sub.textContent = `Subtotal: Rp${total.toLocaleString()}`; el.appendChild(sub); }
function placeOrder(){ if (!currentUser){ window.location.href='login.html'; return; } if (!cart.length){ showToast('Keranjang kosong', 'error'); return; } const name = document.getElementById('addr-name').value.trim(); const phone = document.getElementById('addr-phone').value.trim(); const addr = document.getElementById('addr-address').value.trim(); const ship = document.getElementById('shipping-method').value; if (!name || !phone || !addr){ showToast('Lengkapi alamat pengiriman', 'error'); return; } for (const it of cart){ const available = getAvailableStock(it.id); if (it.qty > available){ showToast(`Stok tidak cukup untuk ${it.name}. Tersedia ${available}`, 'error'); return; } } let subtotal = cart.reduce((s,i)=>s+(i.price*i.qty),0); const shipCost = ship === 'yes' ? 15000 : 0; const total = subtotal + shipCost; const now = new Date().toISOString(); const order = { id: 'ORD' + Date.now(), date: now, items: cart.map(i=>({id:i.id,name:i.name,price:i.price,qty:i.qty})), subtotal, shipMethod:ship, shipCost, total, address:{name,phone,addr} }; const prods = getProducts(); order.items.forEach(it=>{ const idx = prods.findIndex(p=>p.id===it.id); if (idx !== -1) prods[idx].stock = Math.max(0, (prods[idx].stock||0) - it.qty); }); saveProductsToStorage(prods); saveOrderForUser(order); cart = []; saveCartForUser(); showToast('Pesanan berhasil dibuat', 'success'); setTimeout(()=> window.location.href = 'orders.html', 900); }

// ---------------- orders page ----------------
function renderOrdersPage(){ if (!currentUser){ window.location.href='login.html'; return; } const wrap = document.getElementById('orders-list'); if (!wrap) return; const orders = getOrdersForUser(); if (!orders.length) { wrap.innerHTML = '<div>Tidak ada pesanan.</div>'; return; } wrap.innerHTML = ''; orders.forEach(o=>{ const div = document.createElement('div'); div.className = 'order-item'; const head = document.createElement('div'); head.style.display='flex'; head.style.justifyContent='space-between'; const strong = document.createElement('strong'); strong.textContent = o.id; const spanDate = document.createElement('span'); spanDate.textContent = new Date(o.date).toLocaleString(); head.appendChild(strong); head.appendChild(spanDate); div.appendChild(head); const itemsTitle = document.createElement('div'); itemsTitle.textContent = 'Items:'; div.appendChild(itemsTitle); const ul = document.createElement('ul'); o.items.forEach(it=>{ const li = document.createElement('li'); li.textContent = `${it.name} x ${it.qty} — Rp${(it.price*it.qty).toLocaleString()}`; ul.appendChild(li); }); div.appendChild(ul); const tot = document.createElement('div'); tot.textContent = `Total: Rp${o.total.toLocaleString()}`; div.appendChild(tot); const addrDiv = document.createElement('div'); addrDiv.textContent = `Alamat: ${o.address.name} — ${o.address.phone} — ${o.address.addr}`; div.appendChild(addrDiv); wrap.appendChild(div); }); }

// ---------------- admin page (products & users) ----------------
async function renderAdminProducts(){ if (!isManagerOrAdmin()){ showToast('Akses ditolak: hanya admin/manager', 'error'); window.location.href='index.html'; return; } const wrap = document.getElementById('admin-products'); if (!wrap) return; wrap.innerHTML = ''; getProducts().forEach(p=>{ const el = document.createElement('div'); el.className = 'admin-product'; const img = document.createElement('img'); img.src = p.image; img.alt = p.name; el.appendChild(img); const info = document.createElement('div'); info.style.flex = '1'; const title = document.createElement('div'); title.style.fontWeight = '700'; title.textContent = p.name; info.appendChild(title); const meta = document.createElement('div'); meta.textContent = `Rp${p.price.toLocaleString()} — Stok: ${p.stock}`; info.appendChild(meta); const desc = document.createElement('div'); desc.style.fontSize = '0.9em'; desc.style.color = '#556'; desc.textContent = p.description; info.appendChild(desc); el.appendChild(info); const actions = document.createElement('div'); actions.style.display='flex'; actions.style.flexDirection='column'; actions.style.gap='6px'; const editBtn = document.createElement('button'); editBtn.className='btn-primary'; editBtn.textContent='Edit'; editBtn.addEventListener('click', ()=> editProduct(p.id)); actions.appendChild(editBtn); const delBtn = document.createElement('button'); delBtn.className='btn-danger'; delBtn.textContent='Hapus'; delBtn.addEventListener('click', ()=> removeProduct(p.id)); actions.appendChild(delBtn); el.appendChild(actions); wrap.appendChild(el); }); }

function resetProductForm(){ document.getElementById('p-id').value = ''; document.getElementById('p-name').value = ''; document.getElementById('p-price').value = ''; document.getElementById('p-stock').value = ''; document.getElementById('p-desc').value = ''; document.getElementById('p-image-file').value = ''; document.getElementById('p-image-url').value = ''; }
function editProduct(id){ if (!isManagerOrAdmin()){ showToast('Akses ditolak', 'error'); return; } const p = findProduct(id); if (!p) return; document.getElementById('p-id').value = p.id; document.getElementById('p-name').value = p.name; document.getElementById('p-price').value = p.price; document.getElementById('p-stock').value = p.stock; document.getElementById('p-desc').value = p.description; document.getElementById('p-image-url').value = p.image; window.scrollTo({top:0,behavior:'smooth'}); }
function removeProduct(id){ if (!requireManagerOrAdmin()) return; if (!confirm('Hapus produk ini?')) return; deleteProduct(id); renderAdminProducts(); renderProducts(); showToast('Produk dihapus', 'success'); }

// ---------- saveProduct (upload Cloudinary if file provided) ----------
async function saveProduct(){
  if (!requireManagerOrAdmin()) return;
  const id = document.getElementById('p-id').value;
  const name = document.getElementById('p-name').value.trim();
  const price = Number(document.getElementById('p-price').value);
  const stock = Number(document.getElementById('p-stock').value);
  const desc = document.getElementById('p-desc').value.trim();
  const fileEl = document.getElementById('p-image-file');
  const urlEl = document.getElementById('p-image-url').value.trim();

  if (!name || isNaN(price) || price < 0 || isNaN(stock) || stock < 0){ showToast('Lengkapi nama, harga (>=0), stok (>=0)', 'error'); return; }

  try {
    let imgUrl = urlEl || null;
    if (fileEl && fileEl.files && fileEl.files[0]) {
      if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET){
        showToast('Upload file memerlukan konfigurasi Cloudinary. Set CLOUDINARY_CLOUD_NAME dan CLOUDINARY_UPLOAD_PRESET di script.js', 'error');
        return;
      }
      imgUrl = await uploadToCloudinary(fileEl.files[0]);
    }
    if (!imgUrl) imgUrl = 'https://via.placeholder.com/600x400?text=No+Image';

    if (id){
      const prod = { id: Number(id), name, price: Number(price), stock: Number(stock), image: imgUrl, description: desc };
      updateProduct(prod);
      showToast('Produk diperbarui', 'success');
    } else {
      const prod = { name, price: Number(price), stock: Number(stock), image: imgUrl, description: desc };
      addProduct(prod);
      showToast('Produk ditambahkan', 'success');
    }
    resetProductForm(); renderAdminProducts(); renderProducts();
  } catch (err) {
    console.error(err);
    showToast('Gagal upload gambar: ' + err.message, 'error');
  }
}

// ---------------- user management (admin) ----------------
async function renderAdminUsers(){
  if (!requireAdminAction()) return;
  const wrap = document.getElementById('admin-users'); if (!wrap) return;
  wrap.innerHTML = '';

  let usersObj = {};
  if (firebaseAvailable()){
    usersObj = await fetchAllUsersFromFirestore();
    // also merge local users for display if any exist
    const local = getUsersLocal();
    Object.entries(local).forEach(([k,v])=>{
      if (!usersObj[k]) usersObj[k] = { role: v.role || 'user' };
    });
  } else {
    usersObj = getUsersLocal();
  }

  const table = document.createElement('div'); table.style.display = 'flex'; table.style.flexDirection = 'column'; table.style.gap = '8px';
  Object.keys(usersObj).sort().forEach(username=>{
    const u = usersObj[username];
    const role = u.role || (u.role===undefined && (u.role='user')) || 'user';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.border = '1px solid #eef4f4';
    row.style.padding = '8px';
    row.style.borderRadius = '8px';
    const left = document.createElement('div');
    left.style.display='flex';
    left.style.gap='12px';
    left.style.alignItems='center';
    const nameDiv = document.createElement('div');
    nameDiv.style.fontWeight='700';
    nameDiv.textContent = username;
    left.appendChild(nameDiv);
    const roleDiv = document.createElement('div');
    roleDiv.style.color='#556';
    roleDiv.style.fontSize='0.95em';
    roleDiv.textContent = role;
    left.appendChild(roleDiv);
    row.appendChild(left);
    const right = document.createElement('div');
    right.style.display='flex';
    right.style.gap='8px';
    right.style.alignItems='center';

    if (role !== 'admin'){
      const makeAdminBtn = document.createElement('button');
      makeAdminBtn.textContent = 'Make Admin';
      makeAdminBtn.addEventListener('click', ()=> setUserRole(username,'admin'));
      right.appendChild(makeAdminBtn);
    } else {
      const setManagerBtn = document.createElement('button');
      setManagerBtn.textContent = 'Set Manager';
      setManagerBtn.addEventListener('click', ()=> setUserRole(username,'manager'));
      right.appendChild(setManagerBtn);
    }

    if (role !== 'manager'){
      const makeManagerBtn = document.createElement('button');
      makeManagerBtn.textContent = 'Make Manager';
      makeManagerBtn.addEventListener('click', ()=> setUserRole(username,'manager'));
      right.appendChild(makeManagerBtn);
    } else {
      const demoteBtn = document.createElement('button');
      demoteBtn.textContent = 'Demote to User';
      demoteBtn.addEventListener('click', ()=> setUserRole(username,'user'));
      right.appendChild(demoteBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Hapus';
    if (username === currentUser){ delBtn.disabled = true; delBtn.style.opacity = '0.6'; delBtn.style.cursor = 'not-allowed'; }
    delBtn.addEventListener('click', ()=> deleteUserAdmin(username));
    right.appendChild(delBtn);

    row.appendChild(right);
    table.appendChild(row);
  });
  wrap.appendChild(table);
}

async function setUserRole(username, role){
  if (!requireAdminAction()) return;
  // Safety check: prevent removing last admin (local+firestore combined)
  let allRoles = {};
  if (firebaseAvailable()){
    allRoles = await fetchAllUsersFromFirestore();
    const local = getUsersLocal();
    Object.entries(local).forEach(([k,v])=> { if (!allRoles[k]) allRoles[k] = { role: v.role || 'user' }; });
  } else {
    allRoles = getUsersLocal();
  }
  const adminCount = Object.values(allRoles).filter(u=>u.role==='admin').length;
  if (allRoles[username] && allRoles[username].role === 'admin' && role !== 'admin' && adminCount <= 1){
    showToast('Tidak bisa menurunkan: minimal satu admin harus tersedia', 'error'); return;
  }

  // update Firestore role if available
  if (firebaseAvailable()){
    const ok = await setRoleInFirestore(username, role);
    if (!ok){ showToast('Gagal mengubah role di Firestore', 'error'); return; }
  }
  // also update local storage mapping for fallback display
  const localUsers = getUsersLocal();
  if (!localUsers[username]) localUsers[username] = { password: '', role };
  else localUsers[username].role = role;
  saveUsersLocal(localUsers);

  // if we changed current user's role, refresh
  if (username === currentUser) currentUserRole = role;
  renderAdminUsers();
  showToast(`${username} di-set role: ${role}`, 'success');
}

async function deleteUserAdmin(username){
  if (!requireAdminAction()) return;
  if (username === currentUser){ showToast('Tidak bisa menghapus akun yang sedang login', 'error'); return; }
  if (!confirm(`Hapus user "${username}" beserta data (keranjang & pesanan)?`)) return;

  // Delete role doc in Firestore (if available) and local users mapping.
  if (firebaseAvailable()){
    try {
      await window.firebaseDb.collection('users').doc(username).delete();
    } catch(e){
      console.warn('Gagal hapus di Firestore (mungkin tidak ada):', e);
    }
    // NOTE: cannot delete other users from Firebase Auth from client-side (requires Admin SDK).
    // So auth account may persist; for production, perform deletes via server-side admin functions.
  }
  const users = getUsersLocal();
  delete users[username];
  saveUsersLocal(users);
  localStorage.removeItem(`cart_${username}`);
  localStorage.removeItem(`orders_${username}`);
  renderAdminUsers();
  showToast(`User ${username} dihapus (role & local data). Untuk menghapus Auth user di Firebase, gunakan server-side admin SDK.`, 'success');
}

// ---------------- users export / import ----------------
async function exportUsers(){
  if (!requireAdminAction()) return;
  let exportObj = {};
  if (firebaseAvailable()){
    exportObj = await fetchAllUsersFromFirestore();
    // export only roles; passwords are managed by Firebase Auth and tidak diekspor
  } else {
    exportObj = getUsersLocal();
  }
  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Export users: file diunduh', 'success');
}

async function importUsers(){
  if (!requireAdminAction()) return;
  const fileInput = document.getElementById('import-users-file'); if (!fileInput || !fileInput.files || !fileInput.files[0]){ showToast('Pilih file JSON untuk import', 'error'); return; }
  const file = fileInput.files[0];
  const mode = document.getElementById('import-mode') ? document.getElementById('import-mode').value : 'merge';
  const fr = new FileReader();
  fr.onload = async function(e){
    try {
      const parsed = JSON.parse(e.target.result);
      if (typeof parsed !== 'object'){ showToast('File tidak berisi object users valid', 'error'); return; }

      if (mode === 'replace'){
        // Replace roles in Firestore (if available) and local storage
        if (firebaseAvailable()){
          // basic check: require at least one admin in file
          const adminCount = Object.values(parsed).filter(u => (u && (u.role==='admin'))).length;
          if (adminCount === 0){ showToast('Import gagal: file tidak memiliki admin', 'error'); return; }
          // write each doc (roles only)
          const batch = window.firebaseDb.batch();
          Object.entries(parsed).forEach(([k,v])=>{
            const ref = window.firebaseDb.collection('users').doc(k);
            batch.set(ref, { role: (v && v.role) || 'user' }, { merge: true });
          });
          await batch.commit();
        }
        // replace local mapping as fallback
        const out = {};
        Object.entries(parsed).forEach(([k,v])=>{
          if (v && typeof v === 'object' && v.role) out[k] = { role: v.role, password: '' };
          else out[k] = { role: 'user', password: '' };
        });
        saveUsersLocal(out);
        showToast('Import sukses (replace)', 'success');
      } else {
        // merge
        if (firebaseAvailable()){
          const batch = window.firebaseDb.batch();
          Object.entries(parsed).forEach(([k,v])=>{
            const ref = window.firebaseDb.collection('users').doc(k);
            batch.set(ref, { role: (v && v.role) || 'user' }, { merge: true });
          });
          await batch.commit();
        }
        // merge local
        const merged = { ...getUsersLocal() };
        Object.entries(parsed).forEach(([k,v])=>{
          merged[k] = { role: (v && v.role) || 'user', password: merged[k] ? merged[k].password || '' : '' };
        });
        saveUsersLocal(merged);
        showToast('Import sukses (merge)', 'success');
      }
      renderAdminUsers();
    } catch(err){
      console.error(err);
      showToast('Error membaca file: format JSON tidak valid', 'error');
    }
  };
  fr.readAsText(file);
}

// ---------------- auth: login/register/logout (Firebase-aware) ----------------
async function performLogin(){
  const uEl = document.getElementById('login-username'); const pEl = document.getElementById('login-password'); const err = document.getElementById('login-error');
  if (!uEl || !pEl) return;
  const user = uEl.value.trim(), pass = pEl.value;
  if (!user || !pass){ if (err) err.textContent = 'Username / password tidak boleh kosong'; return; }

  if (firebaseAvailable()){
    try {
      const email = usernameToEmail(user);
      await window.firebaseAuth.signInWithEmailAndPassword(email, pass);
      // onAuthStateChanged handler akan set currentUser & currentUserRole
      showToast('Login sukses', 'success');
      window.location.href='index.html';
      return;
    } catch(e){
      console.warn('Firebase login failed', e);
      if (err) err.textContent = 'Login gagal: username / password salah';
      return;
    }
  } else {
    // Legacy local login (string match btoa or asyncHash)
    const users = getUsersLocal();
    const stored = users[user] && users[user].password;
    const legacy = hash(pass);
    let sha = null;
    try { sha = await asyncHash(pass); } catch(e){ sha = legacy; }
    if (stored && (stored === legacy || stored === sha)){
      if (stored !== sha){
        users[user].password = sha;
        saveUsersLocal(users);
      }
      currentUser = user;
      currentUserRole = users[user].role || 'user';
      localStorage.setItem('currentUser', currentUser);
      loadCartForUser();
      showToast('Login sukses', 'success');
      window.location.href='index.html';
      return;
    }
    if (err) err.textContent = 'Login gagal: username / password salah';
  }
}

async function performRegister(){
  const uEl = document.getElementById('register-username'); const pEl = document.getElementById('register-password'); const p2El = document.getElementById('register-password2'); const err = document.getElementById('register-error');
  if (!uEl || !pEl || !p2El) return;
  const user = uEl.value.trim(), pass = pEl.value, pass2 = p2El.value;
  if (!user){ if (err) err.textContent='Username tidak boleh kosong'; return; }
  if (user.length < 3){ if (err) err.textContent='Username minimal 3 karakter'; return; }
  if (!pass || pass.length < 6){ if (err) err.textContent='Password minimal 6 karakter'; return; }
  if (pass !== pass2){ if (err) err.textContent='Konfirmasi password tidak cocok'; return; }
  const users = getUsersLocal();
  if (users[user]){ if (err) err.textContent='Username sudah terdaftar'; return; }

  if (firebaseAvailable()){
    try {
      const email = usernameToEmail(user);
      // create auth user
      await window.firebaseAuth.createUserWithEmailAndPassword(email, pass);
      // set role doc in firestore
      await setRoleInFirestore(user, 'user');
      // also store fallback locally (password empty)
      users[user] = { password: '', role: 'user' };
      saveUsersLocal(users);
      currentUser = user;
      currentUserRole = 'user';
      localStorage.setItem('currentUser', currentUser);
      loadCartForUser();
      showToast('Registrasi sukses', 'success');
      window.location.href='index.html';
      return;
    } catch(e){
      console.error('Firebase register error', e);
      if (err) err.textContent = 'Registrasi gagal: ' + (e.message || e);
      return;
    }
  } else {
    // legacy local registration
    const hashed = await asyncHash(pass);
    users[user] = { password: hashed, role: 'user' };
    saveUsersLocal(users);
    currentUser = user;
    currentUserRole = 'user';
    localStorage.setItem('currentUser', currentUser);
    loadCartForUser();
    showToast('Registrasi sukses', 'success');
    window.location.href='index.html';
  }
}

async function logout(){
  if (firebaseAvailable()){
    try {
      await window.firebaseAuth.signOut();
    } catch(e) {
      console.warn('Firebase signOut error', e);
    }
  }
  currentUser = null;
  currentUserRole = null;
  localStorage.removeItem('currentUser');
  cart = [];
  showToast('Logout', 'info');
  window.location.href='login.html';
}

// ---------------- onAuthStateChanged (Firebase) ----------------
if (typeof window !== 'undefined' && window.addEventListener){
  // We'll attach a short delay to allow firebase-config.js to run
  setTimeout(()=>{
    if (firebaseAvailable()){
      window.firebaseAuth.onAuthStateChanged(async (userObj)=>{
        if (userObj && userObj.email){
          // derive username from email "username@local.toko"
          let uname = userObj.email.split('@')[0] || null;
          currentUser = uname;
          // fetch role from firestore or fallback to local
          currentUserRole = await fetchRoleFromFirestore(uname) || getUserRoleFromLocal(uname) || 'user';
          localStorage.setItem('currentUser', currentUser);
          loadCartForUser();
          updateHeaderUI();
          handleRedirectAfterLogin();
        } else {
          currentUser = localStorage.getItem('currentUser') || null;
          if (currentUser){
            // try to refresh role from Firestore if available
            if (firebaseAvailable()){
              fetchRoleFromFirestore(currentUser).then(r=>{
                if (r) currentUserRole = r;
                else currentUserRole = getUserRoleFromLocal(currentUser) || 'user';
                updateHeaderUI();
              });
            } else {
              currentUserRole = getUserRoleFromLocal(currentUser) || 'user';
              updateHeaderUI();
            }
            loadCartForUser();
          } else {
            currentUserRole = null;
            updateHeaderUI();
          }
        }
      });
    }
  }, 200);
}

// ---------------- redirect after login (intent) ----------------
function handleRedirectAfterLogin(){ const token = localStorage.getItem('redirectAfterLogin'); if (!token) return; localStorage.removeItem('redirectAfterLogin'); if (token.startsWith('add:')){ const parts = token.split(':'); const id = parseInt(parts[1],10); const qty = parts[2] ? parseInt(parts[2],10) : 1; loadCartForUser(); const available = getAvailableStock(id); const inCart = (cart.find(i=>i.id===id)||{}).qty||0; const possible = Math.min(qty, Math.max(0, available - inCart)); if (possible <= 0) { showToast('Stok tidak mencukupi', 'error'); return; } const prod = findProduct(id); if (!prod) return; const found = cart.find(i=>i.id===id); if (found) found.qty += possible; else cart.push({...prod, qty:possible}); saveCartForUser(); updateCartUI(); showToast(`${prod.name} x${possible} ditambahkan ke keranjang`); } else if (token === 'showCart'){ const panel = document.getElementById('cart'); if (panel) panel.classList.remove('hidden'); updateCartUI(); } }

// ---------------- navigation helpers ----------------
function goAdmin(){ if (!isAdminUser()){ showToast('Akses ditolak: hanya admin', 'error'); window.location.href='index.html'; return; } window.location.href = 'admin.html'; }

// ---------------- init per page ----------------
window.addEventListener('DOMContentLoaded', ()=>{
  seedProductsIfNeeded();
  currentUser = localStorage.getItem('currentUser') || null;
  loadCartForUser();

  updateHeaderUI();

  if (document.getElementById('product-container')){
    const searchInput = document.getElementById('search-input'); if (searchInput) searchInput.addEventListener('input', renderProducts);
    const filterStock = document.getElementById('filter-stock') ? document.getElementById('filter-stock') : null; if (filterStock) filterStock.addEventListener('change', renderProducts);
    renderProducts(); handleRedirectAfterLogin();
  }

  if (document.getElementById('product-detail')){ renderProductDetail(); handleRedirectAfterLogin(); }
  if (document.getElementById('checkout-items')){ renderCheckoutItems(); }
  if (document.getElementById('orders-list')){ if (!currentUser){ window.location.href='login.html'; return; } renderOrdersPage(); }

  if (document.getElementById('admin-products')){
    if (!isManagerOrAdmin()){ showToast('Akses ditolak: hanya admin/manager', 'error'); window.location.href='index.html'; return; }
    renderAdminProducts();
    if (isAdminUser()) renderAdminUsers();
  }

  if (document.getElementById('login-username')) document.getElementById('login-username').focus();
  if (document.getElementById('register-username')) document.getElementById('register-username').focus();

  updateCartUI();
});

// Expose functions to global scope used in HTML
window.handleAddToCart = handleAddToCart;
window.addFromDetail = addFromDetail;
window.changeQty = changeQty;
window.toggleCart = function(){ const panel = document.getElementById('cart'); if (!panel) return; if (!currentUser){ localStorage.setItem('redirectAfterLogin','showCart'); window.location.href='login.html'; return; } panel.classList.toggle('hidden'); updateCartUI(); };
window.proceedToCheckout = proceedToCheckout;
window.performLogin = performLogin;
window.performRegister = performRegister;
window.placeOrder = placeOrder;
window.decreaseCartQty = decreaseCartQty;
window.increaseCartQty = increaseCartQty;
window.removeFromCart = removeFromCart;
window.saveProduct = saveProduct;
window.resetProductForm = resetProductForm;
window.editProduct = editProduct;
window.removeProduct = removeProduct;
window.goAdmin = goAdmin;
window.renderAdminUsers = renderAdminUsers;
window.setUserRole = setUserRole;
window.deleteUserAdmin = deleteUserAdmin;
window.exportUsers = exportUsers;
window.importUsers = importUsers;

// Utility: migrate local users (roles) to Firestore (admin-only action)
// NOTE: This migrates only roles and usernames (NOT passwords). Auth accounts remain local or must be created in Firebase separately.
window.migrateLocalUsersToFirestore = async function(){
  if (!requireAdminAction()) return;
  if (!firebaseAvailable()){ showToast('Firebase tidak tersedia', 'error'); return; }
  const local = getUsersLocal();
  const batch = window.firebaseDb.batch();
  Object.entries(local).forEach(([k,v])=> {
    const ref = window.firebaseDb.collection('users').doc(k);
    batch.set(ref, { role: (v && v.role) || 'user' }, { merge: true });
  });
  await batch.commit();
  showToast('Migrasi roles ke Firestore selesai', 'success');
};
