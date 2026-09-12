import os
import re
import json
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
from recipe_scrapers import scrape_html

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
}

def clean_filename(name):
    cleaned = re.sub(r'[\\/*?:"<>|]', '', name).strip()
    return cleaned[:100] if cleaned else "Recipe"

def unamp_url(url):
    m = re.match(r'^https?://www\.google\.[a-z.]+/amp/s/(.*)', url)
    if m:
        target = 'https://' + m.group(1)
        target = re.sub(r'(/amp|%3famp.*)$', '', target)
        return target
    return url

def clean_text(text):
    if not text:
        return ""
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def parse_single_recipe(url, bookmark_title, category):
    original_url = url
    url = unamp_url(url)
    
    if 'youtube.com' in url or 'youtu.be' in url:
        return {
            'title': bookmark_title or 'YouTube Recipe',
            'category': category,
            'ingredients': [],
            'instructions': [f"Video Recipe: {original_url}"],
            'url': original_url,
            'status': 'video'
        }

    try:
        resp = requests.get(url, headers=HEADERS, timeout=12)
        if resp.status_code != 200:
            return {
                'title': bookmark_title,
                'category': category,
                'ingredients': [],
                'instructions': [f"Failed to fetch (HTTP {resp.status_code}). URL: {original_url}"],
                'url': original_url,
                'status': 'error'
            }
        html = resp.text
    except Exception as e:
        return {
            'title': bookmark_title,
            'category': category,
            'ingredients': [],
            'instructions': [f"Request error: {str(e)}. URL: {original_url}"],
            'url': original_url,
            'status': 'error'
        }

    # Strategy 1: recipe-scrapers
    try:
        scraper = scrape_html(html, org_url=url)
        title = scraper.title() or bookmark_title
        ingredients = scraper.ingredients()
        instructions = scraper.instructions_list()
        
        ingredients = [clean_text(i) for i in ingredients if clean_text(i)]
        instructions = [clean_text(i) for i in instructions if clean_text(i)]
        
        servings = None
        y = getattr(scraper, 'yields', lambda: None)()
        if y:
            m = re.search(r'(?i)(?:serves?|servings?|makes?|yield|for)\s*[:=-]?\s*(\d+)', str(y))
            if m:
                servings = int(m.group(1))
            else:
                m2 = re.search(r'\b(\d+)\b', str(y))
                if m2:
                    servings = int(m2.group(1))

        if not servings:
            m_title = re.search(r'(?i)\bfor\s+(\d+)\b', title)
            if m_title:
                servings = int(m_title.group(1))

        if ingredients and instructions:
            return {
                'title': title,
                'category': category,
                'servings': servings or 4,
                'ingredients': ingredients,
                'instructions': instructions,
                'url': original_url,
                'status': 'success'
            }
    except Exception:
        pass

    # Strategy 2: Direct Schema.org JSON-LD
    try:
        soup = BeautifulSoup(html, 'html.parser')
        scripts = soup.find_all('script', type=re.compile(r'application/ld\+json'))
        for s in scripts:
            if not s.string:
                continue
            try:
                data = json.loads(s.string)
            except Exception:
                continue
            items = data if isinstance(data, list) else data.get('@graph', [data])
            for item in items:
                if isinstance(item, dict):
                    t = item.get('@type', '')
                    if t == 'Recipe' or (isinstance(t, list) and 'Recipe' in t):
                        title = item.get('name') or bookmark_title
                        raw_ing = item.get('recipeIngredient', [])
                        raw_inst = item.get('recipeInstructions', [])
                        
                        inst_list = []
                        for inst in raw_inst:
                            if isinstance(inst, dict):
                                if inst.get('@type') == 'HowToSection' and 'itemListElement' in inst:
                                    for sub in inst['itemListElement']:
                                        text = sub.get('text', '') if isinstance(sub, dict) else str(sub)
                                        if text:
                                            inst_list.append(clean_text(text))
                                else:
                                    text = inst.get('text', '')
                                    if text:
                                        inst_list.append(clean_text(text))
                            elif isinstance(inst, str):
                                inst_list.append(clean_text(inst))
                                
                        clean_ing = [clean_text(i) for i in raw_ing if clean_text(i)]
                        clean_ins = [clean_text(i) for i in inst_list if clean_text(i)]
                        
                        servings = None
                        if item.get('recipeYield'):
                            ry = str(item.get('recipeYield'))
                            m = re.search(r'(?i)(?:serves?|servings?|makes?|yield|for)\s*[:=-]?\s*(\d+)', ry)
                            if m:
                                servings = int(m.group(1))
                            else:
                                m2 = re.search(r'\b(\d+)\b', ry)
                                if m2:
                                    servings = int(m2.group(1))

                        if not servings:
                            m_title = re.search(r'(?i)\bfor\s+(\d+)\b', title)
                            if m_title:
                                servings = int(m_title.group(1))

                        if clean_ing and clean_ins:
                            return {
                                'title': title,
                                'category': category,
                                'servings': servings or 4,
                                'ingredients': clean_ing,
                                'instructions': clean_ins,
                                'url': original_url,
                                'status': 'success'
                            }
    except Exception:
        pass

    return {
        'title': bookmark_title,
        'category': category,
        'servings': 4,
        'ingredients': [],
        'instructions': [f"Could not automatically extract recipe. URL: {original_url}"],
        'url': original_url,
        'status': 'unparsed'
    }

def format_recipe_body(title, category, servings, url, ingredients, instructions):
    lines = []
    lines.append(f"Title: {title}")
    if category:
        lines.append(f"Tags: {category}")
    lines.append(f"Servings: {servings or 4}")
    if url:
        lines.append(f"Source: {url}")
    lines.append("")
    
    lines.append("[Ingredients]")
    for ing in ingredients:
        lines.append(ing)
    
    lines.append("")
    lines.append("[Instructions]")
    for step in instructions:
        step_text = re.sub(r'^[-\u2022\*\d\.]+\s*', '', step).strip()
        lines.append(f"- {step_text}")
        
    return "\n".join(lines)

def extract_bookmarks_from_html(html_file):
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()

    soup = BeautifulSoup(content, 'html.parser')
    cooking_h3 = None
    for h3 in soup.find_all('h3'):
        if h3.get_text(strip=True).lower() == 'cooking':
            cooking_h3 = h3
            break

    if not cooking_h3:
        raise ValueError("Could not find 'Cooking' folder in bookmarks.html")

    cooking_dl = cooking_h3.find_next_sibling('dl')
    if not cooking_dl:
        parent = cooking_h3.parent
        cooking_dl = parent.find('dl')

    recipe_items = []
    current_category = "General"

    for item in cooking_dl.find_all(['h3', 'a']):
        if item.name == 'h3':
            current_category = item.get_text(strip=True)
        elif item.name == 'a':
            url = item.get('href', '').strip()
            title = item.get_text(strip=True)
            if url:
                recipe_items.append({
                    'url': url,
                    'title': title,
                    'category': current_category
                })

    return recipe_items

def main():
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    bookmarks_path = os.path.join(workspace_dir, "bookmarks.html")
    output_dir = os.path.join(workspace_dir, "recipes_exported")
    os.makedirs(output_dir, exist_ok=True)

    print(f"Reading bookmarks from: {bookmarks_path}")
    items = extract_bookmarks_from_html(bookmarks_path)
    print(f"Found {len(items)} recipe bookmarks across categories.")

    results = []
    success_count = 0
    video_count = 0
    failed_count = 0

    print("Beginning extraction (using 8 parallel threads)...")
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_item = {
            executor.submit(parse_single_recipe, item['url'], item['title'], item['category']): item
            for item in items
        }

        count = 0
        for future in as_completed(future_to_item):
            count += 1
            item = future_to_item[future]
            try:
                res = future.result()
            except Exception as e:
                res = {
                    'title': item['title'],
                    'category': item['category'],
                    'ingredients': [],
                    'instructions': [f"Processing error: {str(e)}"],
                    'url': item['url'],
                    'status': 'error'
                }

            formatted_body = format_recipe_body(
                title=res.get('title', item['title']),
                category=res.get('category', item['category']),
                servings=res.get('servings', 4),
                url=res.get('url', item['url']),
                ingredients=res.get('ingredients', []),
                instructions=res.get('instructions', [])
            )
            res['note_body'] = formatted_body
            results.append(res)

            # Save individual .txt file
            cat_dir = os.path.join(output_dir, clean_filename(res['category']))
            os.makedirs(cat_dir, exist_ok=True)

            file_title = clean_filename(res['title'])
            txt_path = os.path.join(cat_dir, f"{file_title}.txt")
            
            counter = 1
            while os.path.exists(txt_path):
                txt_path = os.path.join(cat_dir, f"{file_title}_{counter}.txt")
                counter += 1

            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write(formatted_body + "\n")

            if res['status'] == 'success':
                success_count += 1
            elif res['status'] == 'video':
                video_count += 1
            else:
                failed_count += 1

            if count % 25 == 0 or count == len(items):
                print(f"  Progress: {count}/{len(items)} recipes processed ({success_count} success, {video_count} video, {failed_count} unparsed)")

    json_path = os.path.join(workspace_dir, "recipes_database.json")
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print("\n--- Summary ---")
    print(f"Total recipes processed: {len(results)}")
    print(f"  Successfully parsed: {success_count}")
    print(f"  Videos: {video_count}")
    print(f"  Unparsed / manual check needed: {failed_count}")
    print(f"Exported text files saved to: {output_dir}")
    print(f"Complete database JSON saved to: {json_path}")

if __name__ == "__main__":
    main()
