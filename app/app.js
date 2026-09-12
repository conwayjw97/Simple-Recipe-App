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
  currentServings: null,
  fontSizeMultiplier: 1.0,
  wakeLock: null,
  gdrive: {
    clientId: localStorage.getItem('rb_gdrive_client_id') || '',
    userEmail: localStorage.getItem('rb_gdrive_email') || 'conwayjw97@gmail.com',
    folderName: localStorage.getItem('rb_gdrive_folder') || 'Recipes',
    accessToken: null,
    folderId: null,
    isConnected: false
  }
};
window.STATE = STATE;

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

  // Servings Scaling Controls
  servingsBar: document.getElementById('servingsBar'),
  detailServingsCount: document.getElementById('detailServingsCount'),
  servingsScaledNotice: document.getElementById('servingsScaledNotice'),
  servingsDownBtn: document.getElementById('servingsDownBtn'),
  servingsUpBtn: document.getElementById('servingsUpBtn'),
  servingsCurrentVal: document.getElementById('servingsCurrentVal'),
  servingsPresets: document.getElementById('servingsPresets'),
  servingsResetBtn: document.getElementById('servingsResetBtn'),

  // Recipe Modal
  recipeModal: document.getElementById('recipeModal'),
  modalTitle: document.getElementById('modalTitle'),
  recipeForm: document.getElementById('recipeForm'),
  formTitle: document.getElementById('formTitle'),
  formTags: document.getElementById('formTags'),
  formServings: document.getElementById('formServings'),
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
  gdriveUserEmail: document.getElementById('gdriveUserEmail'),
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
  let servings = null;
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
    const servHeaderMatch = trimmed.match(/^(?:servings?|serves?|yield)\s*[:=-]?\s*(\d+)/i);
    if (servHeaderMatch) {
      servings = parseInt(servHeaderMatch[1], 10);
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

    if (inIngredients) {
      ingredients.push(trimmed.replace(/^[-*•✓✔]\s*/, ''));
    } else if (inInstructions) {
      instructions.push(trimmed.replace(/^[-*•\d\.\)]+\s*/, ''));
    } else if (/^[-*•]\s+/.test(trimmed) || /^\d+[\.\)]\s+/.test(trimmed)) {
      // Legacy format with no explicit [Ingredients] header: first bullet indicates instructions
      inInstructions = true;
      instructions.push(trimmed.replace(/^[-*•\d\.\)]+\s*/, ''));
    } else {
      ingredients.push(trimmed);
    }
  }

  if (!servings) {
    const titleMatch = title.match(/\bfor\s+(\d+)\b/i);
    const textMatch = text.match(/\bserves?\s*(\d+)\b/i);
    servings = titleMatch ? parseInt(titleMatch[1], 10) : (textMatch ? parseInt(textMatch[1], 10) : 4);
  }

  const recipe = {
    id: 'rec_' + Math.random().toString(36).substr(2, 9),
    title: title || 'Untitled Recipe',
    tags: Array.from(tags).sort(),
    servings: servings || 4,
    url: url || '',
    ingredients,
    instructions
  };

  cleanRecipeIngredients(recipe);
  return recipe;
}

/**
 * Sanitizes recipe ingredients: strips stray section headers, bullets,
 * and rogue "Servings: X" lines, while setting recipe.servings.
 */
function cleanRecipeIngredients(recipe) {
  if (!recipe) return;
  if (!recipe.ingredients || !Array.isArray(recipe.ingredients)) {
    recipe.ingredients = [];
  }

  const cleaned = [];
  for (const item of recipe.ingredients) {
    if (typeof item !== 'string') continue;
    let line = item.trim();
    if (!line) continue;

    // Strip leading dashes, bullets, or checkmarks
    line = line.replace(/^[-*•✓✔]\s*/, '').trim();

    // Check if this line is actually a Servings/Yield/Serves header
    const servMatch = line.match(/^(?:servings?|serves?|yield)\s*[:=-]?\s*(\d+)/i);
    if (servMatch) {
      const foundServings = parseInt(servMatch[1], 10);
      if (foundServings > 0 && (!recipe.servings || recipe.servings === 4)) {
        recipe.servings = foundServings;
      }
      continue; // Strip from ingredients!
    }

    // Skip stray section headers
    if (/^\[?(?:ingredients|instructions|tags|title|source|url)\]?:?$/i.test(line)) {
      continue;
    }

    cleaned.push(line);
  }
  recipe.ingredients = cleaned;
  recipe.servings = parseInt(recipe.servings, 10) || 4;
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
  lines.push(`Servings: ${recipe.servings || 4}`);
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

// ================= Ingredient Scaling Engine =================

const UNICODE_FRACTIONS = {
  '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1/6, '⅚': 5/6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875
};

function formatQuantity(num) {
  if (num === 0) return '0';
  
  const rounded = Math.round(num);
  if (Math.abs(num - rounded) < 0.035) {
    return String(rounded);
  }

  const intPart = Math.floor(num);
  const fracPart = num - intPart;

  const fractions = [
    { val: 0.125, str: '⅛' },
    { val: 0.25,  str: '¼' },
    { val: 0.333, str: '⅓' },
    { val: 0.375, str: '⅜' },
    { val: 0.5,   str: '½' },
    { val: 0.625, str: '⅝' },
    { val: 0.667, str: '⅔' },
    { val: 0.75,  str: '¾' },
    { val: 0.875, str: '⅞' }
  ];

  for (const f of fractions) {
    if (Math.abs(fracPart - f.val) < 0.045) {
      return intPart > 0 ? `${intPart} ${f.str}` : f.str;
    }
  }

  if (num >= 10) {
    return String(Math.round(num));
  }

  return parseFloat(num.toFixed(2)).toString();
}

function parseNumber(str) {
  str = str.trim();
  if (UNICODE_FRACTIONS[str]) return UNICODE_FRACTIONS[str];

  const mixedUni = str.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/);
  if (mixedUni) {
    return parseInt(mixedUni[1], 10) + UNICODE_FRACTIONS[mixedUni[2]];
  }

  const mixedSlash = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedSlash) {
    return parseInt(mixedSlash[1], 10) + (parseInt(mixedSlash[2], 10) / parseInt(mixedSlash[3], 10));
  }

  const slash = str.match(/^(\d+)\/(\d+)$/);
  if (slash) {
    return parseInt(slash[1], 10) / parseInt(slash[2], 10);
  }

  const val = parseFloat(str);
  return isNaN(val) ? null : val;
}

function scaleIngredient(line, factor) {
  if (factor === 1 || !line || typeof line !== 'string') return line;

  const prefixMatch = line.match(/^(\s*(?:about|approx\.?|ca\.?)\s+)/i);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const rest = prefixMatch ? line.slice(prefix.length) : line;

  // 1. Range at start: e.g. "2-3", "1 to 2", "½ - 1"
  const rangeRegex = /^((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))\s*(?:-|to)\s*((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))(\s*[a-zA-Z%]+.*)?$/;
  const rangeMatch = rest.match(rangeRegex);
  if (rangeMatch) {
    const num1 = parseNumber(rangeMatch[1]);
    const num2 = parseNumber(rangeMatch[2]);
    if (num1 !== null && num2 !== null) {
      const scaled1 = formatQuantity(num1 * factor);
      const scaled2 = formatQuantity(num2 * factor);
      const sep = rest.includes('to') ? ' to ' : '-';
      const remainder = rangeMatch[3] || '';
      return prefix + scaled1 + sep + scaled2 + remainder;
    }
  }

  // 2. Single quantity at start: "2 tbsp", "350g", "1 1/2 tsp", "½ tsp"
  const singleRegex = /^((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?\s*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|\d+(?:\.\d+)?|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))(\s*)([a-zA-Z%]+.*)?$/;
  const singleMatch = rest.match(singleRegex);
  if (singleMatch) {
    const rawNum = singleMatch[1];
    const spacing = singleMatch[2];
    const remainder = singleMatch[3] || '';

    const attachedUnitMatch = rawNum.match(/^(\d+(?:\.\d+)?)([a-zA-Z]+)$/);
    if (attachedUnitMatch) {
      const n = parseFloat(attachedUnitMatch[1]);
      const unit = attachedUnitMatch[2];
      const scaled = formatQuantity(n * factor);
      return prefix + scaled + unit + spacing + remainder;
    }

    const num = parseNumber(rawNum);
    if (num !== null) {
      const scaled = formatQuantity(num * factor);
      return prefix + scaled + spacing + remainder;
    }
  }

  // 3. Italian / suffix style: e.g. "Pomodori pelati 400 g" or "Peperoni rossi 1"
  const suffixMatch = rest.match(/^(.*?\s+)(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|tbsp|tsp)?$/i);
  if (suffixMatch) {
    const leadText = suffixMatch[1];
    const num = parseFloat(suffixMatch[2]);
    const unit = suffixMatch[3] ? ' ' + suffixMatch[3] : '';
    if (!isNaN(num)) {
      return prefix + leadText + formatQuantity(num * factor) + unit;
    }
  }

  return line;
}

// ================= Persistence =================

function loadRecipes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      STATE.recipes = JSON.parse(raw);
    } else if (window.INITIAL_RECIPES && Array.from(window.INITIAL_RECIPES).length > 0) {
      STATE.recipes = JSON.parse(JSON.stringify(window.INITIAL_RECIPES));
      saveRecipes();
    }

    // Ensure any newly added built-in recipes are merged in
    let needsSave = false;
    if (window.INITIAL_RECIPES && Array.isArray(window.INITIAL_RECIPES)) {
      for (const ir of window.INITIAL_RECIPES) {
        if (!STATE.recipes.some(r => r.title.toLowerCase() === ir.title.toLowerCase())) {
          STATE.recipes.push(JSON.parse(JSON.stringify(ir)));
          needsSave = true;
        }
      }
    }

    // Ensure all loaded recipes have valid servings, clean ingredients, and heal misparsed recipes
    for (const r of STATE.recipes) {
      const oldLen = (r.ingredients || []).length;
      const oldServ = r.servings;
      cleanRecipeIngredients(r);

      const match = (window.INITIAL_RECIPES || []).find(ir => ir.title.toLowerCase() === r.title.toLowerCase());
      if (match) {
        // Auto-heal recipes that were previously misparsed (e.g. Pasta e Tonno had 1 ingredient instead of 10)
        if (match.ingredients && match.ingredients.length > (r.ingredients || []).length) {
          r.ingredients = JSON.parse(JSON.stringify(match.ingredients));
          r.instructions = JSON.parse(JSON.stringify(match.instructions));
          r.servings = match.servings;
        }
      }

      if (!r.servings) {
        if (match && match.servings) {
          r.servings = match.servings;
        } else {
          const m = (r.title || '').match(/\bfor\s+(\d+)\b/i);
          r.servings = m ? parseInt(m[1], 10) : 4;
        }
      }
      r.servings = parseInt(r.servings, 10) || 4;

      if ((r.ingredients || []).length !== oldLen || r.servings !== oldServ) {
        needsSave = true;
      }
    }
    if (needsSave) {
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
      // Split by comma if user separated ingredients with commas (e.g. "chicken, garlic"),
      // otherwise split by whitespace (e.g. "chicken garlic")
      const terms = q.includes(',')
        ? q.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : q.split(/\s+/).filter(t => t.length > 0);

      list = list.filter(r => {
        // Every search term must match in title, tags, or anywhere in ingredients
        return terms.every(term => {
          if (r.title && r.title.toLowerCase().includes(term)) return true;
          if (r.tags && r.tags.some(t => t.toLowerCase().includes(term))) return true;
          if (r.ingredients && r.ingredients.some(i => i.toLowerCase().includes(term))) return true;
          return false;
        });
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
        <span>👥 ${recipe.servings || 4} ${(recipe.servings || 4) === 1 ? 'serving' : 'servings'}</span>
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

function renderDetailIngredients(preserveChecked = false) {
  if (!STATE.currentRecipe) return;
  cleanRecipeIngredients(STATE.currentRecipe);
  const recipe = STATE.currentRecipe;
  const baseServings = parseInt(recipe.servings, 10) || 4;
  if (!STATE.currentServings) {
    STATE.currentServings = baseServings;
  }
  const currentServings = parseInt(STATE.currentServings, 10) || baseServings;
  const factor = currentServings / baseServings;

  // Preserve checked state
  const checkedIndices = new Set();
  if (preserveChecked && DOM.detailIngredients && typeof DOM.detailIngredients.querySelectorAll === 'function') {
    const existingItems = DOM.detailIngredients.querySelectorAll('.checklist-item');
    existingItems.forEach((el, idx) => {
      if (el.classList.contains('checked')) {
        checkedIndices.add(idx);
      }
    });
  }

  // Update Servings Bar UI
  if (DOM.detailServingsCount) {
    DOM.detailServingsCount.textContent = `${baseServings} ${baseServings === 1 ? 'serving' : 'servings'}`;
  }
  if (DOM.servingsCurrentVal) {
    DOM.servingsCurrentVal.textContent = currentServings;
  }

  const isScaled = currentServings !== baseServings;
  if (DOM.servingsScaledNotice) {
    if (isScaled) {
      const mult = factor % 1 === 0 ? factor.toString() : factor.toFixed(2);
      DOM.servingsScaledNotice.textContent = `(scaled from ${baseServings}, ${mult}x)`;
      DOM.servingsScaledNotice.classList.remove('hidden');
    } else {
      DOM.servingsScaledNotice.classList.add('hidden');
    }
  }

  if (DOM.servingsResetBtn) {
    DOM.servingsResetBtn.classList.toggle('hidden', !isScaled);
  }

  // Update active state on preset chips
  if (DOM.servingsPresets && typeof DOM.servingsPresets.querySelectorAll === 'function') {
    const chips = DOM.servingsPresets.querySelectorAll('.preset-chip');
    chips.forEach(chip => {
      const scale = parseFloat(chip.dataset.scale);
      const expected = Math.max(1, Math.round(baseServings * scale));
      chip.classList.toggle('active', currentServings === expected);
    });
  }

  // Render scaled ingredients
  if (DOM.detailIngredients) {
    DOM.detailIngredients.innerHTML = '';
    const ingredients = recipe.ingredients || [];
    if (DOM.ingredientCount) {
      DOM.ingredientCount.textContent = `(${ingredients.length})`;
    }
    ingredients.forEach((ing, idx) => {
      const scaledText = scaleIngredient(ing, factor);
      const li = document.createElement('li');
      li.className = 'checklist-item' + (checkedIndices.has(idx) ? ' checked' : '');
      li.innerHTML = `
        <span class="checkbox-circle">✓</span>
        <span>${escapeHtml(scaledText)}</span>
      `;
      li.onclick = () => li.classList.toggle('checked');
      DOM.detailIngredients.appendChild(li);
    });
  }
}

function setDetailServings(newServings) {
  newServings = Math.max(1, Math.min(100, Math.round(Number(newServings) || 4)));
  if (newServings === STATE.currentServings) return;
  STATE.currentServings = newServings;
  renderDetailIngredients(true);
}

// Global window helpers for direct button actions
window.changeServings = function(delta) {
  if (!STATE.currentRecipe) return;
  const base = parseInt(STATE.currentRecipe.servings, 10) || 4;
  const cur = parseInt(STATE.currentServings, 10) || base;
  setDetailServings(cur + delta);
};

window.setServingsPreset = function(scale) {
  if (!STATE.currentRecipe) return;
  const base = parseInt(STATE.currentRecipe.servings, 10) || 4;
  const target = Math.max(1, Math.round(base * parseFloat(scale)));
  setDetailServings(target);
};

window.resetServings = function() {
  if (!STATE.currentRecipe) return;
  const base = parseInt(STATE.currentRecipe.servings, 10) || 4;
  setDetailServings(base);
};

async function openRecipe(recipe) {
  cleanRecipeIngredients(recipe);
  STATE.currentRecipe = recipe;
  STATE.currentServings = parseInt(recipe.servings, 10) || 4;

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

  // Ingredients checklist & Servings Controls
  renderDetailIngredients(false);

  // Instructions step cards
  DOM.detailInstructions.innerHTML = '';
  const instructions = recipe.instructions || [];
  DOM.instructionCount.textContent = `(${instructions.length})`;
  instructions.forEach((step, idx) => {
    const li = document.createElement('li');
    li.className = 'step-item';
    li.innerHTML = `
      <span class="step-number">${idx + 1}</span>
      <span class="step-text">${escapeHtml(step)}</span>
    `;
    li.onclick = () => li.classList.toggle('active');
    DOM.detailInstructions.appendChild(li);
  });

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
    if (DOM.formServings) DOM.formServings.value = recipeToEdit.servings || 4;
    DOM.formUrl.value = recipeToEdit.url || '';
    DOM.formIngredients.value = (recipeToEdit.ingredients || []).join('\n');
    DOM.formInstructions.value = (recipeToEdit.instructions || []).join('\n');
  } else {
    DOM.recipeForm.reset();
    if (DOM.formServings) DOM.formServings.value = 4;
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
  const servings = DOM.formServings ? (parseInt(DOM.formServings.value, 10) || 4) : 4;
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
        servings,
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
      servings,
      url,
      ingredients,
      instructions
    };
    STATE.recipes.unshift(newRecipe);
    updatedRecipe = newRecipe;
  }

  cleanRecipeIngredients(updatedRecipe);
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
  if (DOM.gdriveUserEmail) DOM.gdriveUserEmail.value = STATE.gdrive.userEmail;
  DOM.gdriveFolderName.value = STATE.gdrive.folderName;

  if (window.google && window.google.accounts && STATE.gdrive.clientId) {
    try {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: STATE.gdrive.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
        prompt: 'select_account',
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
  const email = DOM.gdriveUserEmail ? DOM.gdriveUserEmail.value.trim() : '';
  STATE.gdrive.clientId = clientId;
  STATE.gdrive.userEmail = email;
  STATE.gdrive.folderName = DOM.gdriveFolderName.value.trim() || 'Recipes';
  localStorage.setItem('rb_gdrive_client_id', clientId);
  localStorage.setItem('rb_gdrive_email', email);
  localStorage.setItem('rb_gdrive_folder', STATE.gdrive.folderName);

  if (!tokenClient) {
    initGoogleDriveAuth();
  }

  if (tokenClient) {
    const opts = { prompt: 'select_account' };
    if (email) {
      opts.hint = email;
    }
    tokenClient.requestAccessToken(opts);
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
    const subfolderRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(subfolderQuery)}&fields=files(id, name)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100`, {
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

    // 3. Scan all folders in parallel
    DOM.syncStatus.textContent = `⏳ Scanning ${folderMap.size} folders in parallel...`;
    const allFileEntries = [];

    await Promise.all(Array.from(folderMap.entries()).map(async ([fId, fName]) => {
      try {
        const fileQuery = `'${fId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}&fields=files(id, name, mimeType)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
          headers: { Authorization: `Bearer ${STATE.gdrive.accessToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.files && data.files.length > 0) {
            for (const file of data.files) {
              const lower = (file.name || '').toLowerCase();
              if (lower.endsWith('.txt') || lower.endsWith('.md') || file.mimeType === 'text/plain') {
                allFileEntries.push({ file, folderName: fName });
              }
            }
          }
        } else {
          const errBody = await res.text();
          console.warn('Folder scan error for', fName, errBody);
        }
      } catch (err) {
        console.warn('Folder scan network error for', fName, err);
      }
    }));

    if (allFileEntries.length === 0) {
      DOM.syncStatus.textContent = '✅ Drive folder is empty (0 recipes found).';
      return;
    }

    DOM.syncStatus.textContent = `⏳ Downloading ${allFileEntries.length} recipes...`;

    // 4. Download files concurrently (12 parallel streams)
    const CONCURRENCY = 12;
    let completedCount = 0;
    const downloadedRecipes = [];
    let currentIndex = 0;

    async function downloadWorker() {
      while (currentIndex < allFileEntries.length) {
        const idx = currentIndex++;
        const { file, folderName } = allFileEntries[idx];

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout per file

          const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${STATE.gdrive.accessToken}` },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (contentRes.ok) {
            const text = await contentRes.text();
            const parsed = parseRecipeText(text, file.name, folderName);
            downloadedRecipes.push(parsed);
          }
        } catch (err) {
          console.warn('Failed downloading file:', file.name, err);
        } finally {
          completedCount++;
          if (completedCount % 5 === 0 || completedCount === allFileEntries.length) {
            const pct = Math.round((completedCount / allFileEntries.length) * 100);
            DOM.syncStatus.textContent = `⏳ Syncing ${completedCount}/${allFileEntries.length} recipes (${pct}%)...`;
          }
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, allFileEntries.length); i++) {
      workers.push(downloadWorker());
    }
    await Promise.all(workers);

    // Merge recipes into local storage
    for (const r of downloadedRecipes) {
      const existingIdx = STATE.recipes.findIndex(ex => ex.title.toLowerCase() === r.title.toLowerCase());
      if (existingIdx !== -1) {
        STATE.recipes[existingIdx] = { ...r, id: STATE.recipes[existingIdx].id };
      } else {
        STATE.recipes.push(r);
      }
    }

    saveRecipes();
    renderAll();
    DOM.syncStatus.textContent = `✅ Successfully synced ${downloadedRecipes.length} recipes!`;
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
  if (confirm('Reset to the initial 246 recipes library? Any local edits will be refreshed.')) {
    STATE.recipes = JSON.parse(JSON.stringify(window.INITIAL_RECIPES || []));
    for (const r of STATE.recipes) {
      cleanRecipeIngredients(r);
    }
    saveRecipes();
    renderAll();
    if (DOM.settingsModal) DOM.settingsModal.classList.add('hidden');
    alert(`Library successfully reset to ${STATE.recipes.length} recipes!`);
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

// Servings controls in Detail View
if (DOM.servingsDownBtn) {
  DOM.servingsDownBtn.onclick = (e) => {
    e.preventDefault();
    window.changeServings(-1);
  };
}

if (DOM.servingsUpBtn) {
  DOM.servingsUpBtn.onclick = (e) => {
    e.preventDefault();
    window.changeServings(1);
  };
}

if (DOM.servingsResetBtn) {
  DOM.servingsResetBtn.onclick = (e) => {
    e.preventDefault();
    window.resetServings();
  };
}

if (DOM.servingsPresets) {
  DOM.servingsPresets.onclick = (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip) return;
    e.preventDefault();
    const scale = parseFloat(chip.dataset.scale);
    window.setServingsPreset(scale);
  };
}

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
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        reg.update();
      })
      .catch(err => {
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
