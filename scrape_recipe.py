import os
import sys
import re
import json
import argparse
import requests
from bs4 import BeautifulSoup
from recipe_scrapers import scrape_html

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
}

def clean_filename(name):
    cleaned = re.sub(r'[\\/*?:"<>|]', '', name).strip()
    return cleaned[:100] if cleaned else "Recipe"

def clean_text(text):
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text).strip()

def unamp_url(url):
    m = re.match(r'^https?://www\.google\.[a-z.]+/amp/s/(.*)', url)
    if m:
        target = 'https://' + m.group(1)
        return re.sub(r'(/amp|%3famp.*)$', '', target)
    return url

def extract_recipe_from_url(url):
    clean_url = unamp_url(url.strip())
    resp = requests.get(clean_url, headers=HEADERS, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP Error {resp.status_code} while fetching URL: {clean_url}")
    
    html = resp.text
    title = None
    ingredients = []
    instructions = []
    tags = set()

    # Strategy 1: recipe-scrapers library
    try:
        scraper = scrape_html(html, org_url=clean_url)
        title = scraper.title()
        ingredients = [clean_text(i) for i in scraper.ingredients() if clean_text(i)]
        instructions = [clean_text(i) for i in scraper.instructions_list() if clean_text(i)]
        
        # Extract potential tags / cuisine / category
        for attr in ['category', 'cuisine']:
            val = getattr(scraper, attr, lambda: None)()
            if val:
                for item in str(val).split(','):
                    t = clean_text(item)
                    if t:
                        tags.add(t.capitalize())
    except Exception:
        pass

    # Strategy 2: Schema.org JSON-LD parsing
    if not (ingredients and instructions):
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
                        if not title:
                            title = item.get('name')
                        
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
                                
                        if raw_ing and inst_list:
                            ingredients = [clean_text(i) for i in raw_ing if clean_text(i)]
                            instructions = inst_list
                            
                        # Categories / keywords
                        for cat_field in ['recipeCategory', 'recipeCuisine', 'keywords']:
                            c_val = item.get(cat_field)
                            if isinstance(c_val, list):
                                for cv in c_val:
                                    if cv:
                                        tags.add(clean_text(str(cv)).capitalize())
                            elif isinstance(c_val, str):
                                for cv in c_val.split(','):
                                    if cv:
                                        tags.add(clean_text(cv).capitalize())
                        break

    if not title:
        soup = BeautifulSoup(html, 'html.parser')
        title_tag = soup.find('title')
        title = title_tag.get_text().strip() if title_tag else "New Recipe"
        title = re.sub(r'\s*[-|]\s*(BBC Good Food|Allrecipes|Food Network|Simply Recipes).*$', '', title, flags=re.IGNORECASE)

    return {
        'title': title or "Untitled Recipe",
        'url': clean_url,
        'tags': sorted(list(tags)),
        'ingredients': ingredients,
        'instructions': instructions
    }

def format_recipe_content(title, tags, url, ingredients, instructions):
    lines = []
    lines.append(f"Title: {title}")
    if tags:
        lines.append(f"Tags: {', '.join(tags)}")
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
        
    return "\n".join(lines) + "\n"

def main():
    parser = argparse.ArgumentParser(description="Convert any Recipe URL to standard Google Drive recipe text file")
    parser.add_argument("url", nargs="?", help="URL of the recipe to extract")
    parser.add_argument("--tags", "-t", help="Comma-separated list of tags (e.g. 'Pasta, Italian, Dinner')")
    parser.add_argument("--outdir", "-o", default=None, help="Output directory (defaults to recipes_exported/<Category> or recipes_exported)")
    args = parser.parse_args()

    url = args.url
    if not url:
        url = input("Enter Recipe URL: ").strip()
        if not url:
            print("No URL provided. Exiting.")
            sys.exit(1)

    print(f"Fetching and parsing recipe from:\n{url} ...")
    try:
        recipe = extract_recipe_from_url(url)
    except Exception as e:
        print(f"Error extracting recipe: {e}")
        sys.exit(1)

    # Merge tags
    final_tags = set(recipe['tags'])
    if args.tags:
        for t in args.tags.split(','):
            cleaned = clean_text(t)
            if cleaned:
                final_tags.add(cleaned.capitalize())

    # If no tags found, ask or default
    if not final_tags:
        user_tags = input("No tags detected. Enter tags (comma-separated, e.g. Pasta, Italian): ").strip()
        if user_tags:
            for t in user_tags.split(','):
                cleaned = clean_text(t)
                if cleaned:
                    final_tags.add(cleaned.capitalize())

    sorted_tags = sorted(list(final_tags))

    formatted_text = format_recipe_content(
        title=recipe['title'],
        tags=sorted_tags,
        url=recipe['url'],
        ingredients=recipe['ingredients'],
        instructions=recipe['instructions']
    )

    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Determine destination folder
    if args.outdir:
        dest_dir = os.path.abspath(args.outdir)
    else:
        # Default into primary tag folder under recipes_exported if available, else recipes_exported
        primary_folder = sorted_tags[0] if sorted_tags else "General"
        dest_dir = os.path.join(workspace_dir, "recipes_exported", clean_filename(primary_folder))

    os.makedirs(dest_dir, exist_ok=True)
    filename = clean_filename(recipe['title']) + ".txt"
    file_path = os.path.join(dest_dir, filename)

    # Avoid overwriting
    counter = 1
    base_name = clean_filename(recipe['title'])
    while os.path.exists(file_path):
        filename = f"{base_name}_{counter}.txt"
        file_path = os.path.join(dest_dir, filename)
        counter += 1

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(formatted_text)

    print("\n--- Recipe Successfully Converted! ---")
    print(f"Title: {recipe['title']}")
    print(f"Tags: {', '.join(sorted_tags) if sorted_tags else 'None'}")
    print(f"Ingredients: {len(recipe['ingredients'])} items")
    print(f"Instructions: {len(recipe['instructions'])} steps")
    print(f"Saved to: {file_path}")

if __name__ == "__main__":
    main()
