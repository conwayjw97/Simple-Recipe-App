# 🍳 RecipeBox - Lightweight Mobile Recipe App & Scraper Guide

A distraction-free, high-performance recipe viewer and manager designed for mobile cooking, with Google Drive sync and instant tag filtering.

---

## 🚀 1. How to Launch & Install on Android

### Quick Start (Local Network):
1. In your terminal, run:
   ```powershell
   python run_app.py
   ```
2. The script will automatically open the app on your desktop browser (`http://localhost:8000`) and display a **Mobile Wi-Fi URL** (e.g. `http://192.168.1.xxx:8000`).
3. On your Android phone (connected to the same Wi-Fi):
   - Open **Chrome** and navigate to that URL.
   - Tap Chrome's **3 dots (menu)** in the top right.
   - Select **"Install app"** or **"Add to Home screen"**.
4. The app will now appear on your phone's home screen as a standalone, native-feeling app.
   > **Offline note:** Because of the built-in Service Worker, once opened, all 233+ recipes remain fully searchable and readable even when you disconnect from Wi-Fi!

### Permanent Cloud Hosting (Optional):
You can also deploy the contents of the `app/` folder to **GitHub Pages**, **Vercel**, or **Cloudflare Pages** (all 100% free) for a permanent `https://...` URL accessible anywhere.

---

## 🍲 2. Features in the App

* **Cook Mode (Screen Stays Awake):**
  When you open any recipe, the app activates the Web Screen Wake Lock API (`🔆 Cook Mode: Screen ON`). Your screen will never dim or sleep while cooking. Exiting the recipe automatically releases the lock.
* **Instant Tag Search:**
  Browse horizontally scrollable tag chips (`Beef`, `Poultry`, `Seafood`, `Italian`, `Vegetarian`, etc.) or type `#pasta` / `#seafood` directly into the search bar.
* **Interactive Ingredients Checklist:**
  Tap any ingredient to cross it off as you measure or prep.
* **Interactive Step Tracker:**
  Tap any instruction step to highlight where you are in the cooking process.
* **Kitchen Reading Size (`A-` / `A+`):**
  Increase font size with one tap so you can read instructions from across the counter.

---

## ☁️ 3. Google Drive Integration

1. Click the **⚙️ (Settings)** icon or **☁️ Sync** in the top bar.
2. Enter your Google OAuth Web Client ID (from Google Cloud Console) and your Drive folder name (default: `Recipes`).
3. Click **"Sign in with Google"** and authorize access.
4. Tapping **"Sync"** pulls all `.txt` recipe files directly from your Google Drive folder into the app's local offline library.
5. Creating or editing a recipe in the app automatically uploads the `.txt` file back to your Google Drive.

---

## 🌐 4. Adding Recipes via URL (`scrape_recipe.py`)

Whenever you find a recipe online, use the built-in scraper to generate a ready-to-use text file:

```powershell
# 1. Quick scrape (auto-detects title, tags, ingredients, steps):
python scrape_recipe.py "https://www.bbcgoodfood.com/recipes/chicken-biryani-pilau"

# 2. Scrape with custom tags:
python scrape_recipe.py "https://example.com/recipe" --tags "Pasta, Italian, Quick"

# 3. Interactive prompt (prompts you for URL and tags):
python scrape_recipe.py
```

The resulting file is saved to `recipes_exported/<Tag>/<Title>.txt`. You can drop it directly into your Google Drive folder, or import it into the web app using the **📂 Import Recipe Text Files** button in Settings.
