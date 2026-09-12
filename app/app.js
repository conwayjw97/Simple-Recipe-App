/**
 * RecipeBox - Super-Lightweight Recipe Manager & Google Drive Client
 * Built for high performance, zero-bloat UI, and Cook Mode screen wake-lock.
 */

// ================= State Management =================
const STATE = {
  recipes: [],
  activeTag: null,
  searchQuery: '',
  currentRecipe: null,
  fontSizeMultiplier: 1.0,
  wakeLock: null,
  gdrive: {
    clientId: localStorage.getItem('rb_gdrive_client_id') || '',
    folderName: localStorage.getItem('rb_gdrive_folder') || 'Recipes',
    accessToken: null,
    folderId: null,
    isConnected: false
  }
};

const STORAGE_KEY = 'recipebox_library_v1';

// ================= DOM References =================
const DOM = {
  // Views
  listView: document.getElementById('listView'),
  detailView: document.getElementById('detailView'),
  recipeList: document.getElementById('recipeList'),
  tagBar: document.getElementById('tagBar'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  recipeCountBadge: document.getElementById('recipeCountBadge'),
  activeFilterNotice: document.getElementById('activeFilterNotice'),
  filterTagLabel: document.getElementById('filterTagLabel'),
  clearFilterBtn: document.getElementById('clearFilterBtn'),
  emptyState: document.getElementById('emptyState'),

  // Detail View
  backBtn: document.getElementById('backBtn'),
  cookModeBadge: document.getElementById('cookModeBadge'),
  fontDownBtn: document.getElementById('fontDownBtn'),
  fontUpBtn: document.getElementById('fontUpBtn'),
  detailTitle: document.getElementById('detailTitle'),
  detailTags: document.getElementById('detailTags'),
  detailSourceWrapper: document.getElementById('detailSourceWrapper'),
  detailSourceLink: document.getElementById('detailSourceLink'),
  detailIngredients: document.getElementById('detailIngredients'),
  detailInstructions: document.getElementById('detailInstructions'),
  ingredientCount: document.getElementById('ingredientCount'),
  instructionCount: document.getElementById('instructionCount'),
  editRecipeBtn: document.getElementById('editRecipeBtn'),
  shareRecipeBtn: document.getElementById('shareRecipeBtn'),
  recipeArticle: document.getElementById('recipeArticle'),

  // Recipe Modal
  recipeModal: document.getElementById('recipeModal'),
  modalTitle: document.getElementById('modalTitle'),
  recipeForm: document.getElementById('recipeForm'),
  formTitle: document.getElementById('formTitle'),
  formTags: document.getElementById('formTags'),
  formUrl: document.getElementById('formUrl'),
  formIngredients: document.getElementById('formIngredients'),
  formInstructions: document.getElementById('formInstructions'),
  closeModalBtn: document.getElementById('closeModalBtn'),
  cancelModalBtn: document.getElementById('cancelModalBtn'),
  addRecipeBtn: document.getElementById('addRecipeBtn'),

  // Settings Modal
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  gdriveClientId: document.getElementById('gdriveClientId'),
  gdriveFolderName: document.getElementById('gdriveFolderName'),
  connectDriveBtn: document.getElementById('connectDriveBtn'),
  forceSyncBtn: document.getElementById('forceSyncBtn'),
  syncDriveBtn: document.getElementById('syncDriveBtn'),
  syncStatus: document.getElementById('syncStatus'),
  localFileInput: document.getElementById('localFileInput'),
  exportAllBtn: document.getElementById('exportAllBtn'),
  resetLibraryBtn: document.getElementById('resetLibraryBtn')
};

// ================= Parser & Serializer =================

/**
 * Parses raw .txt recipe files (both new format with headers and legacy format).
 */
function parseRecipeText(text, filename = '', folderName = '') {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd());
  let title = filename ? filename.replace(/\.(txt|md)$/i, '') : 'Untitled Recipe';
  const tags = new Set();
  if (folderName && folderName !== 'recipes_exported') {
    tags.add(capitalize(folderName));
  }
  let url = '';
  const ingredients = [];
  const instructions = [];

  let inIngredients = false;
  let inInstructions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();

    // Check Headers
    if (lower.startsWith('title:')) {
      title = trimmed.slice(6).trim();
      continue;
    }
    if (lower.startsWith('tags:') || lower.startsWith('category:')) {
      const parts = trimmed.split(':')[1].split(',');
      for (const p of parts) {
        const t = p.trim();
        if (t) tags.add(capitalize(t));
      }
      continue;
    }
    if (lower.startsWith('source:') || lower.startsWith('url:')) {
      url = trimmed.substring(trimmed.indexOf(':') + 1).trim();
      continue;
    }
    if (lower === '[ingredients]' || lower === 'ingredients:') {
      inIngredients = true;
      inInstructions = false;
      continue;
    }
    if (lower === '[instructions]' || lower === 'instructions:') {
      inIngredients = false;
      inInstructions = true;
      continue;
    }

    // Step detection: starting with bullet, dash, or number
    if (/^[-*•]\s+/.test(trimmed) || /^\d+[\.\)]\s+/.test(trimmed)) {
      inInstructions = true;
      inIngredients = false;
      instructions.push(trimmed.replace(/^[-*•\d\.\)]+\s*/, ''));
    } else if (inInstructions) {
      instructions.push(trimmed.replace(/^[-*•\d\.\)]+\s*/, ''));
    } else {
      ingredients.push(trimmed);
    }
  }

  return {
    id: 'rec_' + Math.random().toString(36).substr(2, 9),
    title: title || 'Untitled Recipe',
    tags: Array.from(tags).sort(),
    url: url || '',
    ingredients,
    instructions
  };
}

/**
 * Serializes recipe object back to standard .txt format.
 */
function serializeRecipeToText(recipe) {
  const lines = [];
  lines.push(`Title: ${recipe.title}`);
  if (recipe.tags && recipe.tags.length > 0) {
    lines.push(`Tags: ${recipe.tags.join(', ')}`);
  }
  if (recipe.url) {
    lines.push(`Source: ${recipe.url}`);
  }
  lines.push('');
  lines.push('[Ingredients]');
  for (const ing of recipe.ingredients) {
    lines.push(ing);
  }
  lines.push('');
  lines.push('[Instructions]');
  for (const step of recipe.instructions) {
    lines.push(`- ${step}`);
  }
  return lines.join('\n') + '\n';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ================= Persistence =================

function loadRecipes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      STATE.recipes = JSON.parse(raw);
    } else if (window.INITIAL_RECIPES && Array.from(window.INITIAL_RECIPES).length > 0) {
      STATE.recipes = window.INITIAL_RECIPES;
      saveRecipes();
    }
  } catch (e) {
    console.error('Failed to load recipes:', e);
    STATE.recipes = window.INITIAL_RECIPES || [];
  }
  renderAll();
}

function saveRecipes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE.recipes));
  } catch (e) {
    console.warn('LocalStorage save failed:', e);
  }
}

// ================= Wake Lock (Cook Mode) =================

async function acquireWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      STATE.wakeLock = await navigator.wakeLock.request('screen');
      updateWakeLockUI(true);
      STATE.wakeLock.addEventListener('release', () => {
        updateWakeLockUI(false);
      });
    } catch (err) {
      console.warn('Wake Lock request failed:', err);
      updateWakeLockUI(false);
    }
  } else {
    updateWakeLockUI(false);
  }
}

function releaseWakeLock() {
  if (STATE.wakeLock !== null) {
    STATE.wakeLock.release().catch(() => {});
    STATE.wakeLock = null;
    updateWakeLockUI(false);
  }
}

function updateWakeLockUI(active) {
  if (!DOM.cookModeBadge) return;
  if (active) {
    DOM.cookModeBadge.className = 'cook-mode-badge';
    DOM.cookModeBadge.innerHTML = '<span class="wake-icon">🔆</span><span class="wake-text">Cook Mode: Screen ON</span>';
  } else {
    DOM.cookModeBadge.className = 'cook-mode-badge inactive';
    DOM.cookModeBadge.innerHTML = '<span class="wake-icon">💤</span><span class="wake-text">Screen Awake: Inactive</span>';
  }
}

// Auto-reacquire when returning to tab/app
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && STATE.currentRecipe && !STATE.wakeLock) {
    await acquireWakeLock();
  }
});

// ================= Rendering & Search Engine =================

function getAllTagsWithCounts() {
  const tagCounts = new Map();
  for (const r of STATE.recipes) {
    if (r.tags && Array.isArray(r.tags)) {
      for (const t of r.tags) {
        if (!t) continue;
        const norm = capitalize(t.trim());
        tagCounts.set(norm, (tagCounts.get(norm) || 0) + 1);
      }
    }
  }
  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function renderTagBar() {
  const tagsWithCounts = getAllTagsWithCounts();
  const totalCount = STATE.recipes.length;

  DOM.tagBar.innerHTML = '';

  // "All" chip
  const allChip = document.createElement('button');
  allChip.className = `tag-chip ${STATE.activeTag === null ? 'active' : ''}`;
  allChip.innerHTML = `All <span class="tag-count">${totalCount}</span>`;
  allChip.onclick = () => selectTag(null);
  DOM.tagBar.appendChild(allChip);

  for (const { tag, count } of tagsWithCounts) {
    const chip = document.createElement('button');
    chip.className = `tag-chip ${STATE.activeTag === tag ? 'active' : ''}`;
    chip.innerHTML = `${tag} <span class="tag-count">${count}</span>`;
    chip.onclick = () => selectTag(tag);
    DOM.tagBar.appendChild(chip);
  }
}

function selectTag(tag) {
  if (STATE.activeTag === tag) {
    STATE.activeTag = null; // toggle off
  } else {
    STATE.activeTag = tag;
  }
  renderAll();
}

function getFilteredRecipes() {
  let list = STATE.recipes;

  // Tag filter
  if (STATE.activeTag) {
    list = list.filter(r => r.tags && r.tags.some(t => t.toLowerCase() === STATE.activeTag.toLowerCase()));
  }

  // Search input query
  const q = STATE.searchQuery.trim().toLowerCase();
  if (q) {
    // If user searched "#tag"
    if (q.startsWith('#')) {
      const tagQuery = q.slice(1);
      list = list.filter(r => r.tags && r.tags.some(t => t.toLowerCase().includes(tagQuery)));
    } else {
      list = list.filter(r => {
        // Title match
        if (r.title && r.title.toLowerCase().includes(q)) return true;
        // Tag match
        if (r.tags && r.tags.some(t => t.toLowerCase().includes(q))) return true;
        // Ingredients match
        if (r.ingredients && r.ingredients.some(i => i.toLowerCase().includes(q))) return true;
        return false;
      });
    }
  }

  return list;
}

function renderRecipeList() {
  const filtered = getFilteredRecipes();
  DOM.recipeList.innerHTML = '';

  // Update counter & notices
  DOM.recipeCountBadge.textContent = filtered.length;

  if (STATE.activeTag) {
    DOM.activeFilterNotice.classList.remove('hidden');
    DOM.filterTagLabel.textContent = STATE.activeTag;
  } else {
    DOM.activeFilterNotice.classList.add('hidden');
  }

  if (filtered.length === 0) {
    DOM.emptyState.classList.remove('hidden');
    return;
  }
  DOM.emptyState.classList.add('hidden');

  const fragment = document.createDocumentFragment();

  for (const recipe of filtered) {
    const card = document.createElement('article');
    card.className = 'recipe-card';
    card.tabIndex = 0;

    const tagsHtml = (recipe.tags || [])
      .slice(0, 3)
      .map(t => `<span class="mini-tag">${escapeHtml(t)}</span>`)
      .join('');

    card.innerHTML = `
      <div>
        <h3 class="recipe-card-title">${escapeHtml(recipe.title)}</h3>
        <div class="recipe-card-tags">${tagsHtml}</div>
      </div>
      <div class="recipe-card-meta">
        <span>🥕 ${recipe.ingredients ? recipe.ingredients.length : 0} items</span>
        <span>📝 ${recipe.instructions ? recipe.instructions.length : 0} steps</span>
      </div>
    `;

    card.onclick = () => openRecipe(recipe);
    card.onkeydown = (e) => { if (e.key === 'Enter') openRecipe(recipe); };
    fragment.appendChild(card);
  }

  DOM.recipeList.appendChild(fragment);
}

function renderAll() {
  renderTagBar();
  renderRecipeList();
}

// ================= Detail View (Cook Mode) =================

async function openRecipe(recipe) {
  STATE.currentRecipe = recipe;

  DOM.detailTitle.textContent = recipe.title;

  // Render detail tags
  DOM.detailTags.innerHTML = (recipe.tags || [])
    .map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`)
    .join('');

  // Source URL
  if (recipe.url) {
    DOM.detailSourceWrapper.classList.remove('hidden');
    DOM.detailSourceLink.href = recipe.url;
    DOM.detailSourceLink.textContent = recipe.url;
  } else {
    DOM.detailSourceWrapper.classList.add('hidden');
  }

  // Ingredients checklist
  DOM.detailIngredients.innerHTML = '';
  DOM.ingredientCount.textContent = `(${recipe.ingredients ? recipe.ingredients.length : 0})`;
  if (recipe.ingredients) {
    recipe.ingredients.forEach(ing => {
      const li = document.createElement('li');
      li.className = 'checklist-item';
      li.innerHTML = `
        <span class="checkbox-circle">✓</span>
        <span>${escapeHtml(ing)}</span>
      `;
      li.onclick = () => li.classList.toggle('checked');
      DOM.detailIngredients.appendChild(li);
    });
  }

  // Instructions step cards
  DOM.detailInstructions.innerHTML = '';
  DOM.instructionCount.textContent = `(${recipe.instructions ? recipe.instructions.length : 0})`;
  if (recipe.instructions) {
    recipe.instructions.forEach((step, idx) => {
      const li = document.createElement('li');
      li.className = 'step-item';
      li.innerHTML = `
        <span class="step-number">${idx + 1}</span>
        <span class="step-text">${escapeHtml(step)}</span>
      `;
      li.onclick = () => li.classList.toggle('active');
      DOM.detailInstructions.appendChild(li);
    });
  }

  // Switch views
  DOM.listView.classList.add('hidden');
  document.querySelector('.search-section').classList.add('hidden');
  DOM.detailView.classList.remove('hidden');
  window.scrollTo(0, 0);

  // Activate Cook Mode Screen Wake Lock
  await acquireWakeLock();
}

function closeRecipeDetail() {
  releaseWakeLock();
  STATE.currentRecipe = null;
  DOM.detailView.classList.add('hidden');
  DOM.listView.classList.remove('hidden');
  document.querySelector('.search-section').classList.remove('hidden');
}

function adjustFontSize(delta) {
  STATE.fontSizeMultiplier = Math.max(0.8, Math.min(1.8, STATE.fontSizeMultiplier + delta));
  DOM.recipeArticle.style.setProperty('--recipe-font-size', `${STATE.fontSizeMultiplier * 1.05}rem`);
}

// ================= Add / Edit Recipe Modal =================

let editingRecipeId = null;

function openAddModal(recipeToEdit = null) {
  editingRecipeId = recipeToEdit ? recipeToEdit.id : null;
  DOM.modalTitle.textContent = recipeToEdit ? 'Edit Recipe' : 'Add New Recipe';

  if (recipeToEdit) {
    DOM.formTitle.value = recipeToEdit.title;
    DOM.formTags.value = (recipeToEdit.tags || []).join(', ');
    DOM.formUrl.value = recipeToEdit.url || '';
    DOM.formIngredients.value = (recipeToEdit.ingredients || []).join('\n');
    DOM.formInstructions.value = (recipeToEdit.instructions || []).join('\n');
  } else {
    DOM.recipeForm.reset();
  }

  DOM.recipeModal.classList.remove('hidden');
  DOM.formTitle.focus();
}

function closeRecipeModal() {
  DOM.recipeModal.classList.add('hidden');
  editingRecipeId = null;
}

DOM.recipeForm.onsubmit = async (e) => {
  e.preventDefault();

  const title = DOM.formTitle.value.trim();
  const tags = DOM.formTags.value
    .split(',')
    .map(t => capitalize(t.trim()))
    .filter(t => t.length > 0);
  const url = DOM.formUrl.value.trim();
  const ingredients = DOM.formIngredients.value
    .split('\n')
    .map(i => i.trim())
    .filter(i => i.length > 0);
  const instructions = DOM.formInstructions.value
    .split('\n')
    .map(s => s.trim().replace(/^[-*•\d\.\)]+\s*/, ''))
    .filter(s => s.length > 0);

  let updatedRecipe;
  if (editingRecipeId) {
    const idx = STATE.recipes.findIndex(r => r.id === editingRecipeId);
    if (idx !== -1) {
      STATE.recipes[idx] = {
        ...STATE.recipes[idx],
        title,
        tags,
        url,
        ingredients,
        instructions
      };
      updatedRecipe = STATE.recipes[idx];
    }
  } else {
    const newRecipe = {
      id: 'rec_' + Date.now(),
      title,
      tags,
      url,
      ingredients,
      instructions
    };
    STATE.recipes.unshift(newRecipe);
    updatedRecipe = newRecipe;
  }

  saveRecipes();
  closeRecipeModal();
  renderAll();

  // If currently in detail view, update it
  if (STATE.currentRecipe && STATE.currentRecipe.id === editingRecipeId) {
    openRecipe(updatedRecipe);
  }

  // If Google Drive is connected, upload .txt file
  if (STATE.gdrive.isConnected && STATE.gdrive.accessToken) {
    uploadRecipeToDrive(updatedRecipe);
  }
};

// ================= Google Drive API Integration =================

let tokenClient = null;

function initGoogleDriveAuth() {
  DOM.gdriveClientId.value = STATE.gdrive.clientId;
  DOM.gdriveFolderName.value = STATE.gdrive.folderName;

  if (window.google && window.google.accounts && STATE.gdrive.clientId) {
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: STATE.gdrive.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
        callback: async (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            STATE.gdrive.accessToken = tokenResponse.access_token;
            STATE.gdrive.isConnected = true;
            DOM.syncStatus.textContent = '✅ Connected to Google Drive';
            DOM.forceSyncBtn.disabled = false;
            await syncGoogleDrive();
          }
        }
      });
    } catch (e) {
      console.warn('Google Identity initialization error:', e);
    }
  }
}

async function requestDriveSignIn() {
  const clientId = DOM.gdriveClientId.value.trim();
  if (!clientId) {
    alert('Please enter your Google OAuth Client ID first.\n(See settings note for how to get a free Web Client ID).');
    return;
  }
  STATE.gdrive.clientId = clientId;
  STATE.gdrive.folderName = DOM.gdriveFolderName.value.trim() || 'Recipes';
  localStorage.setItem('rb_gdrive_client_id', clientId);
  localStorage.setItem('rb_gdrive_folder', STATE.gdrive.folderName);

  if (!tokenClient) {
    initGoogleDriveAuth();
  }

  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  } else {
    alert('Google Identity Services script is loading or unavailable. Please check your internet connection.');
  }
}

async function syncGoogleDrive() {
  if (!STATE.gdrive.accessToken) {
    requestDriveSignIn();
    return;
  }

  DOM.syncStatus.textContent = '⏳ Locating Google Drive folder...';

  try {
    const folderInput = STATE.gdrive.folderName || 'Recipes';
    let rootFolderId = null;

    // Direct folder ID or search by name (supports both personal and shared folders)
    if (/^[a-zA-Z0-9_-]{25,}$/.test(folderInput)) {
      rootFolderId = folderInput;
    } else {
      const folderQuery = `name = '${folderInput}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(folderQuery)}&fields=files(id, name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
        headers: { Authorization: `Bearer ${STATE.gdrive.accessToken}` }
      });
      const folderData = await folderRes.json();

      if (folderData.files && folderData.files.length > 0) {
        rootFolderId = folderData.files[0].id;
      } else {
        // Create folder
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${STATE.gdrive.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: folderInput,
            mimeType: 'application/vnd.google-apps.folder'
          })
        });
        const created = await createRes.json();
        rootFolderId = created.id;
      }
    }
    STATE.gdrive.folderId = rootFolderId;

    // 2. Discover all subfolders (categories like Beef, Seafood, Italian)
    DOM.syncStatus.textContent = '⏳ Scanning category folders...';
    const subfolderQuery = `'${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const subfolderRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subfolderQuery)}&fields=files(id, name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
      headers: { Authorization: `Bearer ${STATE.gdrive.accessToken}` }
    });
    const subfolderData = await subfolderRes.json();
    const folderMap = new Map(); // folderId -> folderName
    folderMap.set(rootFolderId, '');

    if (subfolderData.files) {
      for (const sf of subfolderData.files) {
        folderMap.set(sf.id, sf.name);
      }
    }

    // 3. Fetch .txt files from root folder and all subfolders
    DOM.syncStatus.textContent = `⏳ Syncing files across ${folderMap.size} folder(s)...`;
    let totalSynced = 0;

    for (const [fId, fName] of folderMap.entries()) {
      const fileQuery = `'${fId}' in parents and (mimeType = 'text/plain' or fileExtension = 'txt' or fileExtension = 'md') and trashed = false`;
      const filesRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}&fields=files(id, name)&pageSize=1000`, {
        headers: { Authorization: `Bearer ${STATE.gdrive.accessToken}` }
      });
      const filesData = await filesRes.json();

      if (filesData.files && filesData.files.length > 0) {
        for (const file of filesData.files) {
          try {
            const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
              headers: { Authorization: `Bearer ${STATE.gdrive.accessToken}` }
            });
            const text = await contentRes.text();
            const parsed = parseRecipeText(text, file.name, fName);

            // Update or insert into local storage
            const existingIdx = STATE.recipes.findIndex(r => r.title.toLowerCase() === parsed.title.toLowerCase());
            if (existingIdx !== -1) {
              STATE.recipes[existingIdx] = { ...parsed, id: STATE.recipes[existingIdx].id };
            } else {
              STATE.recipes.push(parsed);
            }
            totalSynced++;
          } catch (err) {
            console.warn('Failed downloading file:', file.name, err);
          }
        }
      }
    }

    saveRecipes();
    renderAll();
    DOM.syncStatus.textContent = `✅ Successfully synced ${totalSynced} recipes from Google Drive!`;
  } catch (err) {
    console.error('Sync error:', err);
    DOM.syncStatus.textContent = `❌ Sync failed: ${err.message}`;
  }
}

async function uploadRecipeToDrive(recipe) {
  if (!STATE.gdrive.accessToken || !STATE.gdrive.folderId) return;

  try {
    const filename = `${recipe.title.replace(/[\\/*?:"<>|]/g, '')}.txt`;
    const content = serializeRecipeToText(recipe);

    const metadata = {
      name: filename,
      parents: [STATE.gdrive.folderId],
      mimeType: 'text/plain'
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
      content +
      closeDelimiter;

    await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STATE.gdrive.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    console.log(`Uploaded "${filename}" to Google Drive`);
  } catch (e) {
    console.warn('Failed to upload recipe to Drive:', e);
  }
}

// ================= File Import / Export =================

DOM.localFileInput.onchange = async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  // If single JSON backup file
  if (files.length === 1 && files[0].name.endsWith('.json')) {
    try {
      const text = await files[0].text();
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        STATE.recipes = data;
        saveRecipes();
        renderAll();
        alert(`Successfully imported ${data.length} recipes from backup!`);
        return;
      }
    } catch (err) {
      alert('Error parsing JSON backup file: ' + err.message);
      return;
    }
  }

  let added = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = parseRecipeText(text, file.name);
      STATE.recipes.unshift(parsed);
      added++;
    } catch (err) {
      console.warn('Failed reading file:', file.name, err);
    }
  }

  saveRecipes();
  renderAll();
  alert(`Successfully imported ${added} recipe files!`);
};

DOM.exportAllBtn.onclick = () => {
  const blob = new Blob([JSON.stringify(STATE.recipes, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `recipes_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

DOM.resetLibraryBtn.onclick = () => {
  if (confirm('Reset to the initial 233 recipes library? Any local edits will be refreshed.')) {
    STATE.recipes = window.INITIAL_RECIPES || [];
    saveRecipes();
    renderAll();
  }
};

// ================= Event Listeners =================

// Search input
DOM.searchInput.oninput = (e) => {
  STATE.searchQuery = e.target.value;
  DOM.clearSearchBtn.classList.toggle('hidden', !STATE.searchQuery);
  renderRecipeList();
};

DOM.clearSearchBtn.onclick = () => {
  DOM.searchInput.value = '';
  STATE.searchQuery = '';
  DOM.clearSearchBtn.classList.add('hidden');
  renderRecipeList();
};

DOM.clearFilterBtn.onclick = () => selectTag(null);

// Detail view buttons
DOM.backBtn.onclick = closeRecipeDetail;
DOM.fontDownBtn.onclick = () => adjustFontSize(-0.1);
DOM.fontUpBtn.onclick = () => adjustFontSize(+0.1);

DOM.editRecipeBtn.onclick = () => {
  if (STATE.currentRecipe) openAddModal(STATE.currentRecipe);
};

DOM.shareRecipeBtn.onclick = async () => {
  if (!STATE.currentRecipe) return;
  const text = serializeRecipeToText(STATE.currentRecipe);
  try {
    await navigator.clipboard.writeText(text);
    alert('Recipe copied to clipboard!');
  } catch (e) {
    alert(text);
  }
};

// Add Recipe Modal
DOM.addRecipeBtn.onclick = () => openAddModal(null);
DOM.closeModalBtn.onclick = closeRecipeModal;
DOM.cancelModalBtn.onclick = closeRecipeModal;

// Settings Modal
DOM.settingsBtn.onclick = () => DOM.settingsModal.classList.remove('hidden');
DOM.closeSettingsBtn.onclick = () => DOM.settingsModal.classList.add('hidden');
DOM.syncDriveBtn.onclick = syncGoogleDrive;
DOM.connectDriveBtn.onclick = requestDriveSignIn;
DOM.forceSyncBtn.onclick = syncGoogleDrive;

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.log('Service Worker registration skipped:', err);
    });
  });
}

// Global escape key
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeRecipeModal();
    DOM.settingsModal.classList.add('hidden');
    if (STATE.currentRecipe) closeRecipeDetail();
  }
});

// Init on load
document.addEventListener('DOMContentLoaded', () => {
  loadRecipes();
  setTimeout(initGoogleDriveAuth, 500);
});

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
