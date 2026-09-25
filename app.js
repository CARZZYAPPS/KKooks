const STORAGE_KEYS = {
  recipes: 'kkooks-created-recipes',
  favorites: 'kkooks-favorites',
  menus: 'kkooks-menus',
  content: 'kkooks-site-content',
  kklubRequests: 'kkooks-kklub-requests'
};

const DEFAULT_ROLE_CONFIG = {
  ownerEmails: [],
  adminEmails: [],
  kklubEmails: []
};

const ACCOUNT_ROLES = {
  USER: 'user',
  KKLUB: 'kklub',
  ADMIN: 'admin',
  OWNER: 'owner',
  CEO: 'ceo'
};

const PROTECTED_CEO_EMAIL = 'carzzyapps@gmail.com';

const firebaseConfig = {
  apiKey: 'AIzaSyBJvA5q7ba31qS_ULZLagi8O4bG80vTeRI',
  authDomain: 'kkooks-app.firebaseapp.com',
  projectId: 'kkooks-app',
  storageBucket: 'kkooks-app.firebasestorage.app',
  messagingSenderId: '569396783402',
  appId: '1:569396783402:web:7847e4a45f1f57608bd653'
};

const firebaseApp = window.firebase && window.firebase.apps && window.firebase.apps.length
  ? window.firebase.apps[0]
  : (window.firebase ? window.firebase.initializeApp(firebaseConfig) : null);
const auth = firebaseApp ? window.firebase.auth() : null;
const db = firebaseApp ? window.firebase.firestore() : null;

const serverTimestamp = () => (window.firebase && window.firebase.firestore ? window.firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString());

const DEFAULT_CONTENT = {
  brand: 'KKooks',
  heroLead: 'Cook kosher.',
  heroAccent: 'Boldly.',
  heroDescription: 'Fresh recipes, smart menus, and a community of home chefs - all in one dark, delicious place.'
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=900&q=85';
const PAGE_MAP = {
  home: 'index.html',
  recipes: 'recipes.html',
  shop: 'shop.html',
  account: 'account.html',
  authentication: 'authentication.html',
  create: 'create.html',
  favorites: 'favorites.html',
  menus: 'menus.html',
  admin: 'admin.html'
};

const state = {
  page: document.body.dataset.page || 'home',
  query: '',
  authMode: 'login',
  accountTab: 'overview',
  currentUser: null,
  recipes: readStorage(STORAGE_KEYS.recipes, []),
  favorites: readStorage(STORAGE_KEYS.favorites, []),
  menus: readStorage(STORAGE_KEYS.menus, []),
  content: readStorage(STORAGE_KEYS.content, DEFAULT_CONTENT),
  kklubEmails: readStorage('kkooks-kklub-emails', []),
  roleConfig: readStorage('kkooks-role-config', DEFAULT_ROLE_CONFIG),
  kklubRequests: readStorage(STORAGE_KEYS.kklubRequests, [])
};

let firebaseSyncInFlight = false;
let authStateReady = false;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getRoleConfig() {
  const config = state.roleConfig || DEFAULT_ROLE_CONFIG;
  return {
    ownerEmails: Array.isArray(config.ownerEmails) ? config.ownerEmails.map(normalizeEmail).filter(Boolean) : [],
    adminEmails: Array.isArray(config.adminEmails) ? config.adminEmails.map(normalizeEmail).filter(Boolean) : [],
    kklubEmails: Array.isArray(config.kklubEmails) ? config.kklubEmails.map(normalizeEmail).filter(Boolean) : []
  };
}

function persistRoleConfig(nextConfig = state.roleConfig) {
  const config = {
    ownerEmails: [...new Set((nextConfig.ownerEmails || []).map(normalizeEmail).filter(Boolean))],
    adminEmails: [...new Set((nextConfig.adminEmails || []).map(normalizeEmail).filter(Boolean))],
    kklubEmails: [...new Set((nextConfig.kklubEmails || []).map(normalizeEmail).filter(Boolean))]
  };

  state.roleConfig = config;
  persistStorage('kkooks-role-config', config);

  if (db) {
    db.collection('siteContent').doc('main').set({
      roleConfig: config,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch((error) => console.error('Unable to save role config:', error));
  }
}

function hasAnyRoleConfig() {
  const config = getRoleConfig();
  return Boolean(config.ownerEmails.length || config.adminEmails.length || config.kklubEmails.length);
}

function ensureCurrentUserRole(user = getCurrentUser()) {
  if (!user || !user.email) return;

  const config = getRoleConfig();
  const normalizedEmail = normalizeEmail(user.email);
  if (hasAnyRoleConfig()) return;

  persistRoleConfig({
    ownerEmails: [normalizedEmail],
    adminEmails: [],
    kklubEmails: []
  });
}

function getUserRoleByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const config = getRoleConfig();

  if (normalizedEmail === PROTECTED_CEO_EMAIL) return ACCOUNT_ROLES.CEO;
  if (!hasAnyRoleConfig()) return ACCOUNT_ROLES.OWNER;
  if (config.ownerEmails.includes(normalizedEmail)) return ACCOUNT_ROLES.OWNER;
  if (config.adminEmails.includes(normalizedEmail)) return ACCOUNT_ROLES.ADMIN;
  if (config.kklubEmails.includes(normalizedEmail) || getKklubEmails().includes(normalizedEmail)) return ACCOUNT_ROLES.KKLUB;
  return ACCOUNT_ROLES.USER;
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function persistStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function showNotice(message) {
  const notice = document.querySelector('#notice');
  if (!notice) return;

  notice.textContent = message;
  notice.hidden = false;

  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    notice.hidden = true;
  }, 2400);
}

function showInlineAuthError(message) {
  const errorNode = document.querySelector('[data-auth-error]');
  if (!errorNode) return;

  errorNode.textContent = message || '';
  errorNode.hidden = !message;
}

function isFirebaseAvailable() {
  return Boolean(db && auth && navigator && navigator.onLine !== false);
}

async function withFirebaseTimeout(task, timeoutMs = 1500) {
  if (!isFirebaseAvailable()) {
    throw new Error('Firebase unavailable');
  }

  return Promise.race([
    task(),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error('Firebase request timed out')), timeoutMs);
    })
  ]);
}

async function loadFirebaseData() {
  if (!isFirebaseAvailable() || firebaseSyncInFlight) return;

  firebaseSyncInFlight = true;

  try {
    const recipesSnapshot = await withFirebaseTimeout(() => db.collection('recipes').where('status', '==', 'published').get());
    const recipes = recipesSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    if (recipes.length) {
      state.recipes = recipes;
      persistStorage(STORAGE_KEYS.recipes, recipes);
    }

    const contentSnapshot = await withFirebaseTimeout(() => db.collection('siteContent').doc('main').get());
    if (contentSnapshot.exists) {
      const firebaseContent = contentSnapshot.data();
      state.content = { ...state.content, ...firebaseContent };
      if (firebaseContent.roleConfig) {
        state.roleConfig = {
          ownerEmails: Array.isArray(firebaseContent.roleConfig.ownerEmails) ? firebaseContent.roleConfig.ownerEmails : [],
          adminEmails: Array.isArray(firebaseContent.roleConfig.adminEmails) ? firebaseContent.roleConfig.adminEmails : [],
          kklubEmails: Array.isArray(firebaseContent.roleConfig.kklubEmails) ? firebaseContent.roleConfig.kklubEmails : []
        };
        persistStorage('kkooks-role-config', state.roleConfig);
      }
      if (Array.isArray(firebaseContent.kklubEmails)) {
        persistKklubEmails(firebaseContent.kklubEmails);
      }
      persistStorage(STORAGE_KEYS.content, state.content);
    }
  } catch (error) {
    console.warn('Firebase sync skipped because the client is offline or slow.', error);
  } finally {
    firebaseSyncInFlight = false;
  }
}

async function saveRecipeToFirebase(recipe) {
  if (!db || !auth || !auth.currentUser || !navigator.onLine) return recipe;

  const docRef = await withFirebaseTimeout(() => db.collection('recipes').add({
    ...recipe,
    status: recipe.status || 'published',
    ownerId: auth.currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  return { ...recipe, id: docRef.id };
}

async function saveSiteContentToFirebase() {
  if (!db || !navigator.onLine) return;

  await withFirebaseTimeout(() => db.collection('siteContent').doc('main').set({
    ...state.content,
    kklubEmails: state.kklubEmails,
    updatedAt: serverTimestamp()
  }, { merge: true }));
}

function isOwnerUser(user = null) {
  return Boolean(user && user.email && (getUserRoleByEmail(user.email) === ACCOUNT_ROLES.OWNER || getUserRoleByEmail(user.email) === ACCOUNT_ROLES.CEO));
}

function isAdminUser(user = null) {
  return Boolean(user && user.email && getRoleConfig().adminEmails.includes(normalizeEmail(user.email)));
}

function canAccessAdminDashboard(user = null) {
  if (!user || !user.email) return false;
  if (!hasAnyRoleConfig()) return true;
  const role = getUserRoleByEmail(user.email);
  return role === ACCOUNT_ROLES.ADMIN || role === ACCOUNT_ROLES.OWNER || role === ACCOUNT_ROLES.CEO;
}

function getKklubEmails() {
  return state.kklubEmails || [];
}

function getKklubRequests() {
  return Array.isArray(state.kklubRequests) ? state.kklubRequests : [];
}

function persistKklubRequests(list) {
  state.kklubRequests = [...new Map((list || []).map((request) => [normalizeEmail(request.email), {
    email: normalizeEmail(request.email),
    requestedBy: normalizeEmail(request.requestedBy || ''),
    requestedAt: request.requestedAt || new Date().toISOString(),
    status: request.status || 'pending'
  }])).values()];
  persistStorage(STORAGE_KEYS.kklubRequests, state.kklubRequests);
}

function canManageKklubRequests(user = null) {
  return Boolean(user && (isOwnerUser(user) || isAdminUser(user)));
}

function sendEmailToRecipients(recipients, subject, body) {
  const targetEmails = (Array.isArray(recipients) ? recipients : [recipients])
    .map(normalizeEmail)
    .filter(Boolean);

  if (!targetEmails.length) return;

  const mailto = `mailto:${targetEmails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;
}

function sendRoleChangeEmail(email, previousRole, nextRole) {
  const safeEmail = normalizeEmail(email);
  if (!safeEmail) return;

  const previousLabel = previousRole && previousRole !== 'user' ? previousRole : 'No access';
  const nextLabel = nextRole && nextRole !== 'user' ? nextRole : 'User';
  const roleRank = {
    [ACCOUNT_ROLES.USER]: 0,
    [ACCOUNT_ROLES.KKLUB]: 1,
    [ACCOUNT_ROLES.ADMIN]: 2,
    [ACCOUNT_ROLES.OWNER]: 3
  };
  const isUpgrade = (roleRank[nextRole] ?? 0) > (roleRank[previousRole] ?? 0);
  const isDowngrade = (roleRank[nextRole] ?? 0) < (roleRank[previousRole] ?? 0);
  const subject = isUpgrade
    ? 'Congratulations on your new KKooks role'
    : isDowngrade
      ? 'An update to your KKooks role'
      : 'Your KKooks role has changed';
  const message = isUpgrade
    ? `Congratulations! Your KKooks role has been upgraded from ${previousLabel} to ${nextLabel}. We are excited to have you take on this new level of access.`
    : isDowngrade
      ? `We are sorry to let you know that your KKooks role has changed from ${previousLabel} to ${nextLabel}. Thank you for being part of KKooks.`
      : `Your KKooks role has changed from ${previousLabel} to ${nextLabel}.`;

  sendEmailToRecipients(
    safeEmail,
    subject,
    `Hi,\n\n${message}\n\nBest,\nKKooks team`
  );
}

function requestKklubApproval(email, requestedBy) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRequester = normalizeEmail(requestedBy);

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    showNotice('Enter a valid email address.');
    return;
  }

  const pendingRequests = getKklubRequests();
  if (pendingRequests.some((request) => normalizeEmail(request.email) === normalizedEmail && request.status !== 'rejected')) {
    showNotice('A KKlub approval request is already pending for that email.');
    return;
  }

  const nextRequest = {
    email: normalizedEmail,
    requestedBy: normalizedRequester,
    requestedAt: new Date().toISOString(),
    status: 'pending'
  };

  persistKklubRequests([...pendingRequests, nextRequest]);

  const ownerEmails = getRoleConfig().ownerEmails;
  sendEmailToRecipients(
    ownerEmails,
    'KKlub approval requested',
    `A KKlub access request was submitted for ${normalizedEmail}.\nRequested by: ${normalizedRequester || 'Unknown admin'}.\nPlease open the admin dashboard and approve or reject the request.`
  );

  showNotice('KKlub access request sent to owners for approval.');
  renderApp();
}

function approveKklubRequest(email) {
  const normalizedEmail = normalizeEmail(email);
  const pendingRequests = getKklubRequests();
  const matched = pendingRequests.find((request) => normalizeEmail(request.email) === normalizedEmail && request.status !== 'rejected');

  if (!matched) {
    showNotice('No pending KKlub request was found for that email.');
    return;
  }

  const previousRole = getUserRoleByEmail(normalizedEmail);
  assignRoleForEmail(normalizedEmail, ACCOUNT_ROLES.KKLUB);
  persistKklubRequests(pendingRequests.filter((request) => normalizeEmail(request.email) !== normalizedEmail));
  sendRoleChangeEmail(normalizedEmail, previousRole, ACCOUNT_ROLES.KKLUB);
  showNotice('KKlub request approved.');
  renderApp();
}

function rejectKklubRequest(email) {
  const normalizedEmail = normalizeEmail(email);
  const nextRequests = getKklubRequests().map((request) => normalizeEmail(request.email) === normalizedEmail ? { ...request, status: 'rejected' } : request);
  persistKklubRequests(nextRequests);

  const currentRole = getUserRoleByEmail(normalizedEmail);
  if (currentRole === ACCOUNT_ROLES.KKLUB) {
    assignRoleForEmail(normalizedEmail, ACCOUNT_ROLES.USER);
  }

  sendEmailToRecipients(
    normalizedEmail,
    'KKlub request update',
    'Your KKooks KKlub request was not approved at this time. You will remain on your current access level unless another change is made.'
  );

  showNotice('KKlub request rejected.');
  renderApp();
}

function persistKklubEmails(list) {
  state.kklubEmails = [...new Set((list || []).map(normalizeEmail).filter(Boolean))].sort();
  persistStorage('kkooks-kklub-emails', state.kklubEmails);

  const config = getRoleConfig();
  config.kklubEmails = [...new Set(state.kklubEmails)];
  persistRoleConfig(config);

  if (db) {
    db.collection('siteContent').doc('main').set({
      kklubEmails: state.kklubEmails,
      updatedAt: serverTimestamp()
    }, { merge: true }).catch((error) => console.error('Unable to save KKlub emails:', error));
  }
}

function canContributeRecipes(user = null) {
  if (!user || !user.email) return false;
  const role = getUserRoleByEmail(user.email);
  return role === ACCOUNT_ROLES.KKLUB || role === ACCOUNT_ROLES.ADMIN || role === ACCOUNT_ROLES.OWNER || role === ACCOUNT_ROLES.CEO;
}

function isKklubMember(user = null) {
  if (!user || !user.email) return false;
  const role = getUserRoleByEmail(user.email);
  return role === ACCOUNT_ROLES.KKLUB || role === ACCOUNT_ROLES.ADMIN || role === ACCOUNT_ROLES.OWNER || role === ACCOUNT_ROLES.CEO;
}

function navigate(page) {
  const target = PAGE_MAP[page] || PAGE_MAP.home;
  window.location.href = target;
}

function getFilteredRecipes() {
  const term = state.query.trim().toLowerCase();

  return state.recipes.filter((recipe) => {
    const text = `${recipe.title} ${recipe.chef} ${recipe.mood}`.toLowerCase();
    return !term || text.includes(term);
  });
}

function getCurrentUser() {
  if (auth && auth.currentUser) return auth.currentUser;
  return state.currentUser;
}

function getAccountDestination() {
  return getCurrentUser() ? 'account' : 'authentication';
}

function buildHeader() {
  const currentUser = getCurrentUser();
  const accountDestination = getAccountDestination();
  const accountLabel = currentUser ? 'Account' : 'Log in / Sign up';
  const canViewAdmin = Boolean(currentUser && canAccessAdminDashboard(currentUser));

  return `
    <header class="site-header">
      <div class="header-main">
        <button class="logo" type="button" data-go="home">
          <span>♨</span>${escapeHtml(state.content.brand || 'KKooks')}
        </button>

        <form class="header-search" data-search-form>
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search KKooks" placeholder="Search KKooks" value="${escapeHtml(state.query)}" />
        </form>

        <div class="header-actions">
          <button type="button" title="Favorites" aria-label="Favorites" data-go="recipes">
            ♡<b>${state.favorites.length || ''}</b>
          </button>
          <button type="button" title="Account" aria-label="Account" data-go="${accountDestination}">
            <span class="action-label">♙ ${escapeHtml(accountLabel)}</span>
          </button>
        </div>
      </div>

      <nav>
        <button type="button" data-go="home">Home</button>
        <button type="button" data-go="recipes">Recipes</button>
        <button type="button" data-go="${accountDestination}">${escapeHtml(accountLabel)}</button>
        ${canViewAdmin ? '<button type="button" data-go="admin">Admin</button>' : ''}
      </nav>
    </header>
  `;
}

function buildFooter() {
  const currentUser = getCurrentUser();
  const accountDestination = getAccountDestination();
  const accountLabel = currentUser ? 'Account' : 'Log in / Sign up';
  const canViewAdmin = Boolean(currentUser && canAccessAdminDashboard(currentUser));

  return `
    <footer>
      <div class="footer-brand">
        <button class="logo" type="button" data-go="home">
          <span>♨</span>${escapeHtml(state.content.brand || 'KKooks')}
        </button>

        <h3>Get our app</h3>
        <div class="app-links">
          <a href="https://apps.apple.com" target="_blank" rel="noreferrer">Download on the App Store</a>
          <a href="https://play.google.com" target="_blank" rel="noreferrer">Get it on Google Play</a>
        </div>

        <h3>Follow us on social media</h3>
        <div class="socials">
          <a href="https://instagram.com" target="_blank" rel="noreferrer">Instagram</a>
          <a href="https://facebook.com" target="_blank" rel="noreferrer">Facebook</a>
          <a href="https://youtube.com" target="_blank" rel="noreferrer">YouTube</a>
        </div>
      </div>

      <div>
        <h4>Explore</h4>
        <button type="button" data-go="home">Home</button>
        <button type="button" data-go="recipes">Recipes</button>
        <button type="button" data-go="${accountDestination}">${escapeHtml(accountLabel)}</button>
      </div>

      <div>
        <h4>Account</h4>
        <button type="button" data-go="${accountDestination}">${escapeHtml(accountLabel)}</button>
        <button type="button" data-go="recipes">Browse recipes</button>
        ${canViewAdmin ? '<button type="button" data-go="admin">Admin</button>' : ''}
      </div>

      <small class="copyright">© 2025 KKooks. Cook something good.</small>
    </footer>
  `;
}

function buildRecipeCard(recipe) {
  const isFavorite = state.favorites.includes(recipe.id);

  return `
    <article class="recipe-card">
      <div class="image-wrap">
        <img src="${escapeHtml(recipe.image || FALLBACK_IMAGE)}" alt="${escapeHtml(recipe.title)}" />
        <button type="button" data-favorite="${escapeHtml(recipe.id)}" aria-label="${isFavorite ? 'Remove from favorites' : 'Save to favorites'}">
          ${isFavorite ? '♥' : '♡'}
        </button>
      </div>

      <span class="card-kicker">${escapeHtml(recipe.mood)}</span>
      <h3>${escapeHtml(recipe.title)}</h3>
      <p>♨ ${escapeHtml(recipe.chef)}</p>
      ${recipe.description ? `<p>${escapeHtml(recipe.description)}</p>` : ''}
    </article>
  `;
}

function renderHomePage() {
  const recipes = getFilteredRecipes();

  return `
    <main>
      <section class="hero">
        <div class="hero-glow"></div>
        <span class="eyebrow">✦ KOSHER COOKING, REIMAGINED</span>
        <h1>${escapeHtml(state.content.heroLead)}<br><span>${escapeHtml(state.content.heroAccent)}</span></h1>
        <p>${escapeHtml(state.content.heroDescription)}</p>

        <form class="hero-search" data-hero-search>
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search 5,000+ recipes" placeholder="Search 5,000+ recipes" value="${escapeHtml(state.query)}" />
          <button type="submit">Search</button>
        </form>

        <div class="hero-traits">
          <span>♨ Trending now</span>
          <span>◷ 30-min meals</span>
          <span>♨ Chef-tested</span>
        </div>
      </section>

      <section class="content-section">
        <div class="section-heading">
          <div>
            <span class="eyebrow">Your kitchen starts here</span>
            <h2>Find your next favorite.</h2>
            <p>Browse recipes, save the ones you love, and build a menu around them.</p>
          </div>
          <button type="button" data-go="recipes">Browse all <span aria-hidden="true">→</span></button>
        </div>

        ${recipes.length ? `<div class="recipe-grid">${recipes.slice(0, 5).map(buildRecipeCard).join('')}</div>` : '<p class="empty-state">No recipes published yet. Create a recipe to start your collection.</p>'}
      </section>

      <section class="make-section">
        <div>
          <h2>Make KKooks yours</h2>
          <p>Save favorites, build menus, and share your own recipes with the community.</p>
        </div>

        <div class="make-grid">
          <button type="button" data-go="recipes">
            <span>♨</span>
            <h3>Explore recipes</h3>
            <p>Browse the collection and save the dishes you love most.</p>
          </button>

          <button type="button" data-go="account">
            <span>♙</span>
            <h3>View account</h3>
            <p>Sign in, track favorites, and keep your kitchen organized.</p>
          </button>
        </div>
      </section>

      <section class="newsletter">
        <span class="eyebrow">✉ NEWSLETTER</span>
        <h2>Tasty recipes, straight to your inbox</h2>
        <p>Get our newest recipes, tips, and picks - no spam, just good food.</p>

        <form data-newsletter>
          <input type="email" aria-label="Your email" placeholder="Your email" required />
          <button type="submit">Subscribe</button>
        </form>

        <small data-newsletter-status></small>
      </section>
    </main>
  `;
}

function renderRecipesPage() {
  const recipes = getFilteredRecipes();

  return `
    <main class="recipes-page">
      <div class="recipes-heading">
        <span class="eyebrow">The collection</span>
        <h1>Your recipe collection.</h1>
        <p>Recipes you publish or save will appear here.</p>

        <form class="recipe-search" data-search-form>
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search recipes" placeholder="Search recipes" value="${escapeHtml(state.query)}" />
        </form>

        <form class="recipe-creator" data-create-form>
          <label>
            Recipe name
            <input name="title" required placeholder="Sunday roast" />
          </label>
          <label>
            By
            <input name="chef" value="My kitchen" />
          </label>
          <label>
            Category
            <select name="mood">
              <option>Weeknight</option>
              <option>Shabbat</option>
              <option>Holiday</option>
              <option>Dairy</option>
              <option>Salads</option>
              <option>Desserts</option>
            </select>
          </label>
          <label>
            Image URL
            <input name="image" type="url" placeholder="Optional image URL" />
          </label>
          <label>
            Description
            <textarea name="description" rows="3" placeholder="Short introduction"></textarea>
          </label>
          <button type="submit" class="primary-button">Add recipe</button>
        </form>
      </div>

      ${recipes.length ? `<div class="recipe-grid">${recipes.map(buildRecipeCard).join('')}</div>` : '<p class="empty-state">No recipes published yet. Create your first recipe to start your collection.</p>'}
    </main>
  `;
}

function renderCreatePage() {
  return `
    <main class="create-page">
      <button class="logo" type="button" data-go="home">
        <span>♨</span>KKooks
      </button>

      <section class="create-card">
        <span class="eyebrow">Your kitchen</span>
        <h1>Share a recipe.</h1>
        <p>Add your favorite family dish or a fresh creation for the community.</p>

        <form class="recipe-creator" data-create-form>
          <label>
            Recipe name
            <input name="title" required placeholder="Sunday roast" />
          </label>
          <label>
            By
            <input name="chef" value="My kitchen" />
          </label>
          <label>
            Category
            <select name="mood">
              <option>Weeknight</option>
              <option>Shabbat</option>
              <option>Holiday</option>
              <option>Dairy</option>
              <option>Salads</option>
              <option>Desserts</option>
            </select>
          </label>
          <label>
            Image URL
            <input name="image" type="url" placeholder="Optional image URL" />
          </label>
          <label>
            Description
            <textarea name="description" rows="4" placeholder="Short introduction"></textarea>
          </label>
          <button type="submit" class="primary-button">Save recipe</button>
        </form>
      </section>
    </main>
  `;
}

function renderFavoritesPage() {
  const recipes = state.recipes.filter((recipe) => state.favorites.includes(recipe.id));

  return `
    <main class="recipes-page">
      <div class="recipes-heading">
        <span class="eyebrow">Saved by you</span>
        <h1>Favorites.</h1>
        <p>${recipes.length ? `${recipes.length} saved recipe${recipes.length === 1 ? '' : 's'}.` : 'Your saved recipes will appear here.'}</p>
      </div>

      ${recipes.length ? `<div class="recipe-grid">${recipes.map(buildRecipeCard).join('')}</div>` : '<p class="empty-state">Nothing saved yet. Browse recipes and tap the heart to save one.</p>'}
    </main>
  `;
}

function renderMenusPage() {
  return `
    <main class="recipes-page">
      <div class="recipes-heading">
        <span class="eyebrow">Plan ahead</span>
        <h1>Build your menus.</h1>
        <p>Group recipes for Shabbat, holidays, or the week ahead.</p>
      </div>

      <section class="menu-list">
        ${state.menus.length ? state.menus.map((menu) => `<article class="menu-item"><h3>${escapeHtml(menu.name)}</h3><p>${escapeHtml(menu.recipes.join(' · ') || 'No recipes added yet.')}</p></article>`).join('') : '<p class="empty-state">No menus saved yet. Create one from the recipe collection.</p>'}
      </section>
    </main>
  `;
}

function renderShopPage() {
  return `
    <main class="recipes-page">
      <div class="recipes-heading">
        <span class="eyebrow">Shop</span>
        <h1>Shoppables are coming soon.</h1>
        <p>Your kitchen favorites will appear here.</p>
      </div>
    </main>
  `;
}

function renderAdminPage() {
  const currentUser = getCurrentUser();
  const canAdmin = Boolean(currentUser && canAccessAdminDashboard(currentUser));
  const isOwner = Boolean(currentUser && isOwnerUser(currentUser));
  const isAdmin = Boolean(currentUser && isAdminUser(currentUser));
  const roleConfig = getRoleConfig();
  const pendingKklubRequests = getKklubRequests().filter((request) => request.status !== 'rejected');

  if (!canAdmin) {
    return `
      <main class="account-page">
        <button class="logo" type="button" data-go="home">
          <span>♨</span>KKooks
        </button>

        <section class="account-card locked-card">
          <span class="eyebrow">Restricted</span>
          <h1>Admin access required.</h1>
          <p>This dashboard is only available to KKooks admins and owners.</p>
          <button type="button" class="primary-button" data-go="account">Back to account</button>
        </section>
      </main>
    `;
  }

  const allManagedRoles = [
    { email: PROTECTED_CEO_EMAIL, role: ACCOUNT_ROLES.CEO, protected: true },
    ...roleConfig.ownerEmails.map((email) => ({ email, role: ACCOUNT_ROLES.OWNER })),
    ...roleConfig.adminEmails.map((email) => ({ email, role: ACCOUNT_ROLES.ADMIN })),
    ...roleConfig.kklubEmails.map((email) => ({ email, role: ACCOUNT_ROLES.KKLUB }))
  ];

  return `
    <main class="admin-page">
      <header class="admin-bar">
        <button class="logo" type="button" data-go="home">
          <span>♨</span>KKooks admin
        </button>
        <button class="secondary-button" type="button" data-go="home">View site</button>
      </header>

      <section class="admin-workspace">
        <span class="eyebrow">Private workspace</span>
        <h1>Manage KKooks.</h1>
        <p>Publish content and shape the homepage from one place.</p>

        <div class="admin-form">
          <label>
            Brand
            <input value="${escapeHtml(state.content.brand || 'KKooks')}" data-site-brand />
          </label>
          <label>
            Hero lead
            <input value="${escapeHtml(state.content.heroLead || 'Cook kosher.')}" data-site-lead />
          </label>
          <label>
            Hero accent
            <input value="${escapeHtml(state.content.heroAccent || 'Boldly.')}" data-site-accent />
          </label>
          <label>
            Hero description
            <textarea rows="4" data-site-description>${escapeHtml(state.content.heroDescription || '')}</textarea>
          </label>
          <button class="primary-button" type="button" data-save-content>Save homepage</button>
        </div>

        ${isOwner ? `
          <div class="admin-form" style="margin-top: 24px;">
            <h2>User roles</h2>
            <form data-role-form>
              <label>
                User email
                <input name="email" type="email" placeholder="member@email.com" required />
              </label>
              <label>
                Role
                <select name="role">
                  <option value="user">user</option>
                  <option value="kklub">kklub</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              </label>
              <button class="primary-button" type="submit">Save role</button>
            </form>

            <div class="mini-grid" style="margin-top: 16px;">
              ${allManagedRoles.length ? allManagedRoles.map((entry) => `
                <div class="mini-item">
                  <strong>${escapeHtml(entry.email)}</strong>
                  <span>${escapeHtml(entry.role)}</span>
                  ${entry.protected ? '<span>Protected</span>' : `<button type="button" class="secondary-button" data-remove-role="${escapeHtml(entry.email)}">Clear</button>`}
                </div>
              `).join('') : '<p>No roles assigned yet.</p>'}
            </div>
          </div>
        ` : ''}

        ${(isOwner || isAdmin) ? `
          <div class="admin-form" style="margin-top: 24px;">
            <h2>KKlub requests</h2>
            ${pendingKklubRequests.length ? pendingKklubRequests.map((request) => `
              <div class="mini-item">
                <strong>${escapeHtml(request.email)}</strong>
                <div class="inline-actions">
                  ${isOwner ? `<button type="button" class="primary-button" data-approve-kklub-request="${escapeHtml(request.email)}">Approve</button>` : ''}
                  ${isOwner ? `<button type="button" class="secondary-button" data-reject-kklub-request="${escapeHtml(request.email)}">Reject</button>` : ''}
                </div>
              </div>
            `).join('') : '<p>No pending KKlub requests.</p>'}
          </div>
        ` : ''}

        ${(isOwner || isAdmin) ? `
          <div class="admin-form" style="margin-top: 24px;">
            <h2>KKlub access</h2>
            <form data-kklub-form>
              <label>
                Add member email
                <input name="email" type="email" placeholder="member@email.com" required />
              </label>
              <button class="primary-button" type="submit">Add KKlub member</button>
            </form>

            <div class="mini-grid" style="margin-top: 16px;">
              ${getKklubEmails().length ? getKklubEmails().map((email) => `
                <div class="mini-item">
                  <strong>${escapeHtml(email)}</strong>
                  <button type="button" class="secondary-button" data-remove-kklub="${escapeHtml(email)}">Remove</button>
                </div>
              `).join('') : '<p>No KKlub members added yet.</p>'}
            </div>
          </div>
        ` : ''}
      </section>
    </main>
  `;
}

function renderAccountPage() {
  const currentUser = getCurrentUser();
  const role = currentUser && currentUser.email ? getUserRoleByEmail(currentUser.email) : 'guest';
  const kklubUnlocked = isKklubMember(currentUser);
  const canAccessDashboard = Boolean(currentUser && canAccessAdminDashboard(currentUser));

  return `
    <main class="account-dashboard-page">
      <div class="account-dashboard">
        <aside class="account-sidebar">
          <div class="account-identity">
            <span class="eyebrow">Account</span>
            <h1>${currentUser ? escapeHtml(currentUser.email || 'Member') : 'Guest access'}</h1>
            <p>${currentUser ? `Role: ${escapeHtml(role)}` : 'Not signed in yet.'}</p>
          </div>

          <nav class="account-tabs" aria-label="Account navigation">
            <button type="button" class="${state.accountTab === 'overview' ? 'active' : ''}" data-account-tab="overview">Overview</button>
            <button type="button" class="${state.accountTab === 'favorites' ? 'active' : ''}" data-account-tab="favorites">Favorites</button>
            <button type="button" class="${state.accountTab === 'kklub' ? 'active' : ''}" data-account-tab="kklub">KKlub</button>
            ${canAccessDashboard ? '<button type="button" data-go="admin">Admin dashboard</button>' : ''}
            ${currentUser ? '<button type="button" data-sign-out>Sign out / switch</button>' : '<button type="button" data-go="authentication">Sign in</button>'}
          </nav>
        </aside>

        <section class="account-panel">
          ${!currentUser ? `
            <div class="account-card locked-card">
              <span class="eyebrow">Secure area</span>
              <h2>Sign in to view your dashboard.</h2>
              <p>Track your recipes, manage favorites, and unlock KKlub access once you’re approved.</p>
              <button type="button" class="primary-button" data-go="authentication">Open authentication</button>
            </div>
          ` : ''}

          ${currentUser && state.accountTab === 'overview' ? `
            <div class="account-card dashboard-card">
              <span class="eyebrow">Profile</span>
              <h2>Welcome back.</h2>
              <p>Your account is active and you’re currently set as <strong>${escapeHtml(role)}</strong>.</p>

              <div class="stats-grid">
                <div><span>Favorites</span><strong>${state.favorites.length}</strong></div>
                <div><span>Saved recipes</span><strong>${state.recipes.length}</strong></div>
                <div><span>KKlub status</span><strong>${kklubUnlocked ? 'Approved' : 'Pending'}</strong></div>
              </div>
            </div>
          ` : ''}

          ${currentUser && state.accountTab === 'favorites' ? `
            <div class="account-card dashboard-card">
              <span class="eyebrow">Favorites</span>
              <h2>Your saved recipes.</h2>
              ${state.favorites.length ? `<div class="mini-grid">${state.recipes.filter((recipe) => state.favorites.includes(recipe.id)).map((recipe) => `<div class="mini-item"><strong>${escapeHtml(recipe.title)}</strong><span>${escapeHtml(recipe.mood)}</span></div>`).join('')}</div>` : '<p>No favorites saved yet.</p>'}
            </div>
          ` : ''}

          ${currentUser && state.accountTab === 'kklub' ? `
            <div class="account-card ${kklubUnlocked ? 'kklub-access' : 'kklub-gate'}">
              <span class="eyebrow">KKlub</span>
              <h2>${kklubUnlocked ? 'KKlub access approved.' : 'Invalid credentials. Try again later.'}</h2>
              <p>${kklubUnlocked ? 'You have access to the private KKlub collection and recipe contribution tools.' : 'This area is reserved for KKlub members only. Requests are reviewed and access is granted by invite.'}</p>
              ${kklubUnlocked ? `
                <div class="kklub-perks">
                  <span>Private recipe access</span>
                  <span>Contributor tools</span>
                  <span>Invite-only community</span>
                </div>
              ` : ''}
            </div>
          ` : ''}
        </section>
      </div>
    </main>
  `;
}

async function signInWithGoogle() {
  if (!auth || !window.firebase || !window.firebase.auth) {
    showNotice('Firebase Auth is not configured.');
    return;
  }

  if (!navigator.onLine) {
    showNotice('You appear to be offline. Reconnect to sign in with Google.');
    return;
  }

  try {
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await auth.signInWithPopup(provider);
    state.currentUser = result ? result.user || auth.currentUser : null;
    ensureCurrentUserRole(state.currentUser);
    showInlineAuthError('');
    showNotice('Signed in with Google.');
    state.page = 'account';
    renderApp();
    navigate('account');
  } catch (error) {
    console.error('Google sign-in failed:', error);
    showInlineAuthError(error.message || 'Google sign-in failed.');
    showNotice(error.message || 'Google sign-in failed.');
  }
}

async function signOutUser() {
  if (!auth) {
    showNotice('Firebase Auth is not configured.');
    return;
  }

  try {
    await auth.signOut();
    state.currentUser = null;
    authStateReady = true;
    state.page = 'authentication';
    state.authMode = 'login';
    renderApp();
    showNotice('Signed out.');
  } catch (error) {
    console.error('Sign out failed:', error);
    showNotice(error.message || 'Unable to sign out.');
  }
}

function renderAuthenticationPage() {
  const authConfig = {
    login: {
      title: 'Welcome back.',
      helper: 'Log in to manage favorites, recipes, and your profile.',
      buttonLabel: 'Log in',
      switchText: 'Need an account? Create one',
      mode: 'login'
    },
    signup: {
      title: 'Create your account.',
      helper: 'Join KKooks and begin saving recipes and building your kitchen.',
      buttonLabel: 'Create account',
      switchText: 'Already have an account? Log in',
      mode: 'signup'
    },
    forgot: {
      title: 'Reset your password.',
      helper: 'Enter your email and we will send a reset link.',
      buttonLabel: 'Send reset link',
      switchText: 'Remember it now? Log in',
      mode: 'forgot'
    }
  };

  const config = authConfig[state.authMode] || authConfig.login;

  return `
    <main class="account-page">
      <button class="logo" type="button" data-go="home">
        <span>♨</span>KKooks
      </button>

      <section class="account-card auth-card">
        <span class="eyebrow">Your kitchen</span>
        <h1>${config.title}</h1>
        <p>${config.helper}</p>

        <div class="auth-tabs">
          <button type="button" class="${state.authMode === 'login' ? 'active' : ''}" data-auth-mode="login">Login</button>
          <button type="button" class="${state.authMode === 'signup' ? 'active' : ''}" data-auth-mode="signup">Create</button>
          <button type="button" class="${state.authMode === 'forgot' ? 'active' : ''}" data-auth-mode="forgot">Forgot password</button>
        </div>

        ${state.authMode !== 'forgot' ? `
          <button type="button" data-google-signin style="display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin:12px 0 8px;padding:13px 16px;border:1px solid rgba(146,161,153,0.28);border-radius:12px;background:#ffffff;color:#1f1f1f;font-weight:700;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,0.12);">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.72 1.23 9.23 3.64l6.85-6.85C35.94 2.71 30.48 0 24 0 14.64 0 6.55 5.38 2.56 13.22l7.98 6.2C12.19 14.42 17.52 9.5 24 9.5Z"/>
              <path fill="#4285F4" d="M46.5 24.55c0-1.64-.15-3.21-.42-4.73H24v9h12.67c-.54 2.93-2.2 5.41-4.68 7.09l7.58 5.88c4.41-4.06 7.93-10.06 7.93-17.24Z"/>
              <path fill="#FBBC05" d="M32 35.8c-2.3 1.54-5.26 2.45-8 2.45-6.48 0-11.99-4.37-13.95-10.25l-8.04 6.24C4.96 42.36 13.08 48 24 48c7.35 0 13.52-2.42 18.02-6.57l-10.02-5.63Z"/>
              <path fill="#34A853" d="M11.05 28c-.63-1.86-.98-3.85-.98-5.99s.35-4.13.98-5.99L2.56 13.22A23.89 23.89 0 0 0 0 22c0 3.83.92 7.45 2.56 10.78l8.49-6.78Z"/>
            </svg>
            Continue with Google
          </button>
        ` : ''}

        ${state.authMode === 'forgot' ? `
          <form data-forgot-form>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
            <div data-auth-error hidden></div>
            <button type="submit" class="primary-button">${config.buttonLabel}</button>
          </form>
        ` : `
          <form data-account-form>
            <label>
              Email
              <input name="email" type="email" required />
            </label>

            <label>
              Password
              <input name="password" type="password" minlength="6" required />
            </label>

            <div data-auth-error hidden style="min-height: 20px; margin: 6px 0 12px; color: #ff9d9d; font-size: 0.92rem; font-weight: 600;"></div>
            <button type="submit" class="primary-button">${config.buttonLabel}</button>
          </form>
        `}

        <button type="button" class="account-switch" data-auth-switch>
          ${config.switchText}
        </button>
      </section>
    </main>
  `;
}

function renderAccountPageOld() {
  return `
    <main class="account-page">
      <button class="logo" type="button" data-go="home">
        <span>♨</span>KKooks
      </button>

      <section class="account-card">
        <span class="eyebrow">Your kitchen</span>
        <h1>${state.authMode === 'signup' ? 'Create your account.' : 'Welcome back.'}</h1>
        <p>Save favorites, build your own recipe collection, and keep your dishes in one place.</p>

        <form data-account-form>
          <label>
            Email
            <input name="email" type="email" required />
          </label>

          <label>
            Password
            <input name="password" type="password" minlength="6" required />
          </label>

          <button type="submit" class="primary-button">${state.authMode === 'signup' ? 'Create account' : 'Log in'}</button>
        </form>

        <button type="button" class="account-switch" data-auth-switch>
          ${state.authMode === 'signup' ? 'Already have an account? Log in' : 'New here? Create an account'}
        </button>
      </section>
    </main>
  `;
}

function syncPageForAuthState(user) {
  authStateReady = true;

  if (user) {
    state.page = state.page === 'authentication' ? 'account' : (state.page === 'home' ? 'home' : state.page);
    state.authMode = 'login';
    return;
  }

  if (state.page === 'account' || state.page === 'admin') {
    state.page = 'authentication';
    state.authMode = 'login';
  }
}

function renderApp() {
  const currentUser = getCurrentUser();

  if (authStateReady && state.page === 'authentication' && currentUser) {
    state.page = 'account';
  }

  if (authStateReady && state.page === 'account' && !currentUser) {
    state.page = 'authentication';
    state.authMode = 'login';
  }

  if (authStateReady && state.page === 'admin' && (!currentUser || !canAccessAdminDashboard(currentUser))) {
    state.page = 'account';
  }

  const pageMarkup = {
    home: renderHomePage,
    recipes: renderRecipesPage,
    shop: renderShopPage,
    account: renderAccountPage,
    authentication: renderAuthenticationPage,
    create: renderCreatePage,
    favorites: renderFavoritesPage,
    menus: renderMenusPage,
    admin: renderAdminPage
  }[state.page] || renderHomePage;

  document.querySelector('#app').innerHTML = `
    <div class="site-shell">
      ${buildHeader()}
      ${pageMarkup()}
      ${buildFooter()}
    </div>
  `;

  bindEvents();
}

function assignRoleForEmail(email, roleName) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    showNotice('Enter a valid email address.');
    return;
  }

  if (normalizedEmail === PROTECTED_CEO_EMAIL) {
    showNotice('The CEO role is protected and cannot be changed.');
    return;
  }

  const previousRole = getUserRoleByEmail(normalizedEmail);

  const config = getRoleConfig();
  const normalizedRole = String(roleName || 'user');

  config.ownerEmails = config.ownerEmails.filter((item) => item !== normalizedEmail);
  config.adminEmails = config.adminEmails.filter((item) => item !== normalizedEmail);
  config.kklubEmails = config.kklubEmails.filter((item) => item !== normalizedEmail);

  if (normalizedRole === ACCOUNT_ROLES.OWNER) config.ownerEmails.push(normalizedEmail);
  if (normalizedRole === ACCOUNT_ROLES.ADMIN) config.adminEmails.push(normalizedEmail);
  if (normalizedRole === ACCOUNT_ROLES.KKLUB) config.kklubEmails.push(normalizedEmail);

  persistRoleConfig(config);
  state.kklubEmails = [...new Set([...state.kklubEmails.filter((item) => item !== normalizedEmail), ...(normalizedRole === ACCOUNT_ROLES.KKLUB ? [normalizedEmail] : [])])].sort();
  persistStorage('kkooks-kklub-emails', state.kklubEmails);

  if (previousRole !== normalizedRole) {
    sendRoleChangeEmail(normalizedEmail, previousRole, normalizedRole);
  }

  showNotice(`Role updated to ${normalizedRole}.`);
  renderApp();
}

function bindEvents() {
  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.go));
  });

  document.querySelectorAll('[data-search-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = form.querySelector('input');
      state.query = input ? input.value.trim() : '';
      navigate('recipes');
    });
  });

  document.querySelector('[data-hero-search]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = event.target.querySelector('input');
    state.query = input ? input.value.trim() : '';
    navigate('recipes');
  });

  document.querySelectorAll('[data-favorite]').forEach((button) => {
    button.addEventListener('click', () => {
      const recipeId = button.dataset.favorite;
      state.favorites = state.favorites.includes(recipeId)
        ? state.favorites.filter((item) => item !== recipeId)
        : [...state.favorites, recipeId];

      persistStorage(STORAGE_KEYS.favorites, state.favorites);
      renderApp();
    });
  });

  document.querySelector('[data-newsletter]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.target.querySelector('input');
    const status = document.querySelector('[data-newsletter-status]');

    if (!input || !input.value.trim()) return;
    const email = input.value.trim();

    if (db) {
      try {
        await db.collection('newsletterSubscribers').doc(email.toLowerCase()).set({
          email: email.toLowerCase(),
          subscribedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.error('Unable to save subscriber:', error);
      }
    }

    input.value = '';
    if (status) status.textContent = 'You are on the list.';
  });

  document.querySelector('[data-role-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();

    if (!isOwnerUser(getCurrentUser())) {
      showNotice('Only owners can manage roles.');
      return;
    }

    const formData = new FormData(event.target);
    const email = normalizeEmail(formData.get('email'));
    const roleName = String(formData.get('role') || 'user');
    assignRoleForEmail(email, roleName);
  });

  document.querySelectorAll('[data-remove-role]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!isOwnerUser(getCurrentUser())) {
        showNotice('Only owners can manage roles.');
        return;
      }

      const email = normalizeEmail(button.dataset.removeRole);
      assignRoleForEmail(email, 'user');
    });
  });

  document.querySelector('[data-kklub-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();

    const currentUser = getCurrentUser();
    if (!canManageKklubRequests(currentUser)) {
      showNotice('Only owners and admins can manage KKlub access.');
      return;
    }

    const formData = new FormData(event.target);
    const email = normalizeEmail(formData.get('email'));

    if (!email || !email.includes('@')) {
      showNotice('Enter a valid email.');
      return;
    }

    if (getKklubEmails().includes(email)) {
      showNotice('That email is already in KKlub.');
      return;
    }

    if (!isOwnerUser(currentUser)) {
      requestKklubApproval(email, currentUser ? currentUser.email : 'admin');
      return;
    }

    persistKklubEmails([...getKklubEmails(), email]);
    showNotice('KKlub invite added.');
    renderApp();
  });

  document.querySelectorAll('[data-approve-kklub-request]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!isOwnerUser(getCurrentUser())) {
        showNotice('Only owners can approve KKlub requests.');
        return;
      }

      const email = normalizeEmail(button.dataset.approveKklubRequest);
      if (!email) return;

      approveKklubRequest(email);
    });
  });

  document.querySelectorAll('[data-reject-kklub-request]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!isOwnerUser(getCurrentUser())) {
        showNotice('Only owners can reject KKlub requests.');
        return;
      }

      const email = normalizeEmail(button.dataset.rejectKklubRequest);
      if (!email) return;

      rejectKklubRequest(email);
    });
  });

  document.querySelectorAll('[data-remove-kklub]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!isOwnerUser(getCurrentUser())) {
        showNotice('Only owners can manage KKlub invites.');
        return;
      }

      const email = normalizeEmail(button.dataset.removeKklub);
      if (!email) return;

      persistKklubEmails(getKklubEmails().filter((item) => item !== email));
      showNotice('KKlub member removed.');
      renderApp();
    });
  });

  document.querySelector('[data-create-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const currentUser = getCurrentUser();
    if (!currentUser || !canContributeRecipes(currentUser)) {
      showNotice('Invite-only: only admins or KKlub members can contribute recipes.');
      return;
    }

    const formData = new FormData(event.target);
    const title = String(formData.get('title') || '').trim();
    const chef = String(formData.get('chef') || '').trim() || 'My kitchen';
    const mood = String(formData.get('mood') || 'Weeknight');
    const image = String(formData.get('image') || '').trim() || FALLBACK_IMAGE;
    const description = String(formData.get('description') || '').trim();

    if (!title) {
      showNotice('Enter a recipe name.');
      return;
    }

    const recipe = {
      title,
      chef,
      mood,
      image,
      description,
      status: 'published'
    };

    let savedRecipe = {
      id: `recipe-${Date.now()}`,
      ...recipe
    };

    if (db && auth && auth.currentUser && navigator.onLine !== false) {
      try {
        savedRecipe = await saveRecipeToFirebase({ ...recipe, ownerId: auth.currentUser.uid });
      } catch (error) {
        console.error('Unable to publish recipe to Firebase; saving locally instead:', error);
        showNotice('Online publishing failed, so the recipe was saved on this device.');
      }
    }

    state.recipes.unshift(savedRecipe);
    persistStorage(STORAGE_KEYS.recipes, state.recipes);
    if (savedRecipe.id && !String(savedRecipe.id).startsWith('recipe-')) {
      showNotice('Recipe published.');
    } else if (!document.querySelector('#notice')?.textContent.includes('saved on this device')) {
      showNotice('Recipe saved.');
    }
    navigate('recipes');
  });

  document.querySelector('[data-account-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!auth) {
      showNotice('Firebase Auth is not configured.');
      return;
    }

    const formData = new FormData(event.target);
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');

    if (!email || !password) {
      showNotice('Enter an email and password.');
      return;
    }

    try {
      let signedInUser = null;
      showInlineAuthError('');

      if (state.authMode === 'signup') {
        signedInUser = await auth.createUserWithEmailAndPassword(email, password);
        showNotice('Account created.');
      } else if (state.authMode === 'login') {
        signedInUser = await auth.signInWithEmailAndPassword(email, password);
        showNotice('Signed in successfully.');
      }

      state.currentUser = signedInUser ? signedInUser.user || signedInUser : null;
      ensureCurrentUserRole(state.currentUser);
      const destination = state.page === 'authentication' ? 'account' : 'home';
      state.page = destination;
      state.authMode = 'login';
      renderApp();
      navigate(destination);
    } catch (error) {
      showInlineAuthError(error.message || 'Authentication failed.');
      showNotice(error.message || 'Authentication failed.');
    }
  });

  document.querySelector('[data-forgot-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!auth) {
      showNotice('Firebase Auth is not configured.');
      return;
    }

    const formData = new FormData(event.target);
    const email = String(formData.get('email') || '').trim();

    if (!email) {
      showNotice('Enter your email to reset the password.');
      return;
    }

    try {
      showInlineAuthError('');
      await auth.sendPasswordResetEmail(email);
      showNotice('Password reset email sent.');
      state.authMode = 'login';
      renderApp();
    } catch (error) {
      showInlineAuthError(error.message || 'Unable to send reset email.');
      showNotice(error.message || 'Unable to send reset email.');
    }
  });

  document.querySelector('[data-google-signin]')?.addEventListener('click', () => {
    signInWithGoogle();
  });

  document.querySelector('[data-sign-out]')?.addEventListener('click', () => {
    signOutUser();
  });

  document.querySelector('[data-auth-switch]')?.addEventListener('click', () => {
    if (state.authMode === 'login') {
      state.authMode = 'signup';
    } else if (state.authMode === 'signup') {
      state.authMode = 'login';
    } else {
      state.authMode = 'login';
    }
    renderApp();
  });

  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.authMode = button.dataset.authMode || 'login';
      renderApp();
    });
  });

  document.querySelectorAll('[data-account-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.accountTab = button.dataset.accountTab || 'overview';
      renderApp();
    });
  });

  document.querySelector('[data-save-content]')?.addEventListener('click', async () => {
    const brand = document.querySelector('[data-site-brand]')?.value || state.content.brand || 'KKooks';
    const lead = document.querySelector('[data-site-lead]')?.value || state.content.heroLead || 'Cook kosher.';
    const accent = document.querySelector('[data-site-accent]')?.value || state.content.heroAccent || 'Boldly.';
    const description = document.querySelector('[data-site-description]')?.value || state.content.heroDescription || '';

    state.content = { ...state.content, brand, heroLead: lead, heroAccent: accent, heroDescription: description };
    persistStorage(STORAGE_KEYS.content, state.content);

    if (db) {
      try {
        await saveSiteContentToFirebase();
      } catch (error) {
        console.error('Unable to save content to Firebase:', error);
      }
    }

    showNotice('Homepage content saved.');
    renderApp();
  });
}

if (auth) {
  auth.onAuthStateChanged((user) => {
    state.currentUser = user || null;
    syncPageForAuthState(user);

    if (user) {
      ensureCurrentUserRole(user);
    }

    if (!user || !navigator.onLine || !db || firebaseSyncInFlight) {
      renderApp();
      return;
    }

    withFirebaseTimeout(() => db.collection('users').doc(user.uid).set({
      email: user.email,
      uid: user.uid,
      role: getUserRoleByEmail(user.email),
      updatedAt: serverTimestamp()
    }, { merge: true })).catch((error) => console.warn('Skipped user profile sync while Firebase is unavailable.', error));

    renderApp();
  });
}

window.addEventListener('offline', () => {
  firebaseSyncInFlight = false;
});

renderApp();
if (navigator.onLine) {
  loadFirebaseData().catch((error) => console.warn('Firebase sync skipped.', error));
}
