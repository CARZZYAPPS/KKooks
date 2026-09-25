const STORAGE_KEYS = {
  recipes: 'kkooks-created-recipes',
  favorites: 'kkooks-favorites',
  menus: 'kkooks-menus',
  content: 'kkooks-site-content'
};

const OWNER_EMAILS = ['carzzyapps@gmail.com'];
const ADMIN_EMAILS = ['avishayowitz@gmail.com, daniel.kamienny@gmail.com'];

const ACCOUNT_ROLES = {
  USER: 'user',
  KKLUB: 'kklub',
  ADMIN: 'admin',
  OWNER: 'owner'
};

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
  recipes: readStorage(STORAGE_KEYS.recipes, []),
  favorites: readStorage(STORAGE_KEYS.favorites, []),
  menus: readStorage(STORAGE_KEYS.menus, []),
  content: readStorage(STORAGE_KEYS.content, DEFAULT_CONTENT),
  kklubEmails: readStorage('kkooks-kklub-emails', [])
};

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getUserRoleByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  if (OWNER_EMAILS.includes(normalizedEmail)) return ACCOUNT_ROLES.OWNER;
  if (ADMIN_EMAILS.includes(normalizedEmail)) return ACCOUNT_ROLES.ADMIN;
  if (getKklubEmails().includes(normalizedEmail)) return ACCOUNT_ROLES.KKLUB;
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

function isFirebaseAvailable() {
  return Boolean(db && navigator && navigator.onLine !== false);
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
  if (!isFirebaseAvailable()) return;

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
      if (Array.isArray(firebaseContent.kklubEmails)) {
        persistKklubEmails(firebaseContent.kklubEmails);
      }
      persistStorage(STORAGE_KEYS.content, state.content);
    }
  } catch (error) {
    console.warn('Firebase sync skipped because the client is offline or slow.', error);
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
  return Boolean(user && user.email && OWNER_EMAILS.includes(normalizeEmail(user.email)));
}

function isAdminUser(user = null) {
  return Boolean(user && user.email && ADMIN_EMAILS.includes(normalizeEmail(user.email)));
}

function canAccessAdminDashboard(user = null) {
  if (!user || !user.email) return false;
  const role = getUserRoleByEmail(user.email);
  return role === ACCOUNT_ROLES.ADMIN || role === ACCOUNT_ROLES.OWNER;
}

function getKklubEmails() {
  return state.kklubEmails || [];
}

function persistKklubEmails(list) {
  state.kklubEmails = [...new Set((list || []).map(normalizeEmail).filter(Boolean))].sort();
  persistStorage('kkooks-kklub-emails', state.kklubEmails);

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
  return role === ACCOUNT_ROLES.KKLUB || role === ACCOUNT_ROLES.ADMIN || role === ACCOUNT_ROLES.OWNER;
}

function isKklubMember(user = null) {
  if (!user || !user.email) return false;
  const role = getUserRoleByEmail(user.email);
  return role === ACCOUNT_ROLES.KKLUB || role === ACCOUNT_ROLES.ADMIN || role === ACCOUNT_ROLES.OWNER;
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

function getAccountDestination() {
  return auth && auth.currentUser ? 'account' : 'authentication';
}

function buildHeader() {
  const accountDestination = getAccountDestination();
  const accountLabel = auth && auth.currentUser ? 'Account' : 'Log in / Sign up';

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
            <span class="action-label"><i class="far fa-user" style="color:#00d1b2"></i> ${escapeHtml(accountLabel)}</span>
          </button>
        </div>
      </div>

      <nav>
        <button type="button" data-go="home">Home</button>
        <button type="button" data-go="recipes">Recipes</button>
        <button type="button" data-go="${accountDestination}">${escapeHtml(accountLabel)}</button>
      </nav>
    </header>
  `;
}

function buildFooter() {
  const accountDestination = getAccountDestination();
  const accountLabel = auth && auth.currentUser ? 'Account' : 'Log in / Sign up';

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
            <input name="title" required placeholder="Shabbos roast" />
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
      </section>
    </main>
  `;
}

function renderAccountPage() {
  const currentUser = auth ? auth.currentUser : null;
  const role = currentUser && currentUser.email ? getUserRoleByEmail(currentUser.email) : 'guest';
  const kklubUnlocked = isKklubMember(currentUser);

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
            ${currentUser ? '<button type="button" data-go="authentication">Sign out / switch</button>' : '<button type="button" data-go="authentication">Sign in</button>'}
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

        ${state.authMode === 'forgot' ? `
          <form data-forgot-form>
            <label>
              Email
              <input name="email" type="email" required />
            </label>
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

function renderApp() {
  if (state.page === 'account' && (!auth || !auth.currentUser)) {
    state.page = 'authentication';
    state.authMode = 'login';
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

  document.querySelector('[data-kklub-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();

    if (!isOwnerUser(auth ? auth.currentUser : null)) {
      showNotice('Only owners can manage KKlub invites.');
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

    persistKklubEmails([...getKklubEmails(), email]);
    showNotice('KKlub invite added.');
    renderApp();
  });

  document.querySelectorAll('[data-remove-kklub]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!isOwnerUser(auth ? auth.currentUser : null)) {
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

    const currentUser = auth ? auth.currentUser : null;
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

    if (!title) return;

    const recipe = {
      title,
      chef,
      mood,
      image,
      description,
      status: 'published'
    };

    if (db && auth && auth.currentUser) {
      const saved = await saveRecipeToFirebase({ ...recipe, ownerId: auth.currentUser.uid });
      state.recipes.unshift(saved);
    } else {
      state.recipes.unshift({
        id: `recipe-${Date.now()}`,
        ...recipe
      });
    }

    persistStorage(STORAGE_KEYS.recipes, state.recipes);
    showNotice('Recipe saved.');
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
      if (state.authMode === 'signup') {
        await auth.createUserWithEmailAndPassword(email, password);
        showNotice('Account created.');
      } else if (state.authMode === 'login') {
        await auth.signInWithEmailAndPassword(email, password);
        showNotice('Signed in successfully.');
      }
      if (state.page === 'authentication') {
        navigate('account');
      } else {
        navigate('home');
      }
    } catch (error) {
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
      await auth.sendPasswordResetEmail(email);
      showNotice('Password reset email sent.');
      state.authMode = 'login';
      renderApp();
    } catch (error) {
      showNotice(error.message || 'Unable to send reset email.');
    }
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
    if (!user || !navigator.onLine || !db) return;
    withFirebaseTimeout(() => db.collection('users').doc(user.uid).set({
      email: user.email,
      uid: user.uid,
      role: getUserRoleByEmail(user.email),
      updatedAt: serverTimestamp()
    }, { merge: true })).catch((error) => console.warn('Skipped user profile sync while Firebase is unavailable.', error));
  });
}

renderApp();
loadFirebaseData().catch((error) => console.warn('Firebase sync skipped.', error));
