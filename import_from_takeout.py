import os
import re
import sys
import json
import zipfile
import argparse
from bs4 import BeautifulSoup

def clean_filename(name):
    cleaned = re.sub(r'[\\/*?:"<>|]', '', name).strip()
    return cleaned[:100] if cleaned else "Untitled Recipe"

def clean_text(text):
    if not text:
        return ""
    return re.sub(r'\s+', ' ', text).strip()

def format_recipe_to_txt(title, tags, url, ingredients, instructions, raw_text=""):
    lines = []
    lines.append(f"Title: {title}")
    if tags:
        lines.append(f"Tags: {', '.join(sorted(list(set(tags))))}")
    if url:
        lines.append(f"Source: {url}")
    lines.append("")

    if ingredients or instructions:
        if ingredients:
            lines.append("[Ingredients]")
            for ing in ingredients:
                lines.append(ing)
            lines.append("")
        if instructions:
            lines.append("[Instructions]")
            for step in instructions:
                step_text = re.sub(r'^[-\u2022\*\d\.]+\s*', '', step).strip()
                lines.append(f"- {step_text}")
    elif raw_text:
        lines.append(raw_text.strip())

    return "\n".join(lines) + "\n"

def parse_note_content(text):
    ingredients = []
    instructions = []
    urls = []

    found_urls = re.findall(r'https?://[^\s]+', text or '')
    if found_urls:
        urls.extend(found_urls)

    lines = [l.strip() for l in (text or '').splitlines() if l.strip()]
    in_instructions = False

    for line in lines:
        if re.match(r'^https?://[^\s]+$', line):
            urls.append(line)
            continue
        
        lower = line.lower()
        if 'method' in lower or 'instruction' in lower or 'direction' in lower or 'steps' in lower:
            in_instructions = True
            continue
        if 'ingredient' in lower:
            in_instructions = False
            continue

        if line.startswith('- ') or re.match(r'^\d+[\.\)]\s+', line):
            in_instructions = True
            instructions.append(line)
        elif in_instructions:
            instructions.append(line)
        else:
            ingredients.append(line)

    return ingredients, instructions, (urls[0] if urls else "")

def parse_json_note(data):
    title = data.get('title', '').strip()
    raw_text = data.get('textContent', '')
    
    # Checklists
    list_items = data.get('listContent', [])
    ingredients = []
    instructions = []
    urls = []

    if list_items:
        for item in list_items:
            t = clean_text(item.get('text', ''))
            if not t:
                continue
            if re.search(r'https?://[^\s]+', t):
                urls.extend(re.findall(r'https?://[^\s]+', t))
            if re.match(r'^(step|\d+[\.\)]|preheat|bake|fry|cook|mix|boil|heat|serve)', t, re.IGNORECASE):
                instructions.append(t)
            else:
                ingredients.append(t)
        url = urls[0] if urls else ""
    else:
        ingredients, instructions, url = parse_note_content(raw_text)

    # Labels / Tags
    labels = [lbl.get('name', '') for lbl in data.get('labels', []) if lbl.get('name')]
    
    # Annotations URL check
    for annot in data.get('annotations', []):
        if annot.get('url'):
            url = annot.get('url')
            break

    return {
        'title': title,
        'tags': labels,
        'url': url,
        'ingredients': ingredients,
        'instructions': instructions,
        'raw_text': raw_text
    }

def parse_html_note(html_str):
    soup = BeautifulSoup(html_str, 'html.parser')
    title_el = soup.find(class_='title')
    title = title_el.get_text().strip() if title_el else ""
    
    content_el = soup.find(class_='content')
    raw_text = content_el.get_text('\n').strip() if content_el else soup.get_text('\n').strip()
    
    # Labels in HTML takeout
    labels = []
    for label_el in soup.find_all(class_='label'):
        labels.append(label_el.get_text().strip())

    ingredients, instructions, url = parse_note_content(raw_text)
    return {
        'title': title,
        'tags': labels,
        'url': url,
        'ingredients': ingredients,
        'instructions': instructions,
        'raw_text': raw_text
    }

def main():
    parser = argparse.ArgumentParser(description="Import recipes from Google Takeout (Keep export zip or folder)")
    parser.add_argument("source", help="Path to Google Takeout .zip file or extracted 'Keep' folder")
    parser.add_argument("--outdir", default="recipes_exported", help="Output directory (default: recipes_exported)")
    args = parser.parse_args()

    source = os.path.abspath(args.source)
    if not os.path.exists(source):
        print(f"Error: Source '{source}' not found.")
        sys.exit(1)

    notes = []

    if zipfile.is_zipfile(source):
        print(f"Reading Google Takeout archive: {source}")
        with zipfile.ZipFile(source, 'r') as z:
            for filename in z.namelist():
                if filename.endswith('.json') and not filename.startswith('__MACOSX'):
                    try:
                        content = z.read(filename).decode('utf-8')
                        data = json.loads(content)
                        notes.append(parse_json_note(data))
                    except Exception:
                        pass
                elif filename.endswith('.html') and not filename.startswith('__MACOSX'):
                    try:
                        content = z.read(filename).decode('utf-8')
                        notes.append(parse_html_note(content))
                    except Exception:
                        pass
    else:
        # Directory
        print(f"Reading Google Takeout directory: {source}")
        for root, _, files in os.walk(source):
            for file in files:
                filepath = os.path.join(root, file)
                if file.endswith('.json'):
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            notes.append(parse_json_note(data))
                    except Exception:
                        pass
                elif file.endswith('.html'):
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            notes.append(parse_html_note(f.read()))
                    except Exception:
                        pass

    print(f"Found {len(notes)} notes in Takeout.")

    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    out_base = os.path.join(workspace_dir, args.outdir)
    os.makedirs(out_base, exist_ok=True)

    imported_count = 0
    for idx, note in enumerate(notes, 1):
        title = note['title']
        if not title:
            if note['ingredients']:
                title = note['ingredients'][0][:40]
            elif note['raw_text']:
                title = note['raw_text'].splitlines()[0][:40]
            else:
                title = f"Keep Recipe {idx}"

        clean_t = clean_filename(title)
        tags = [t for t in note['tags'] if t.lower() not in ['recipe', 'recipes']]
        primary_cat = tags[0] if tags else "General"
        target_dir = os.path.join(out_base, clean_filename(primary_cat))
        os.makedirs(target_dir, exist_ok=True)

        txt_path = os.path.join(target_dir, f"{clean_t}.txt")
        counter = 1
        while os.path.exists(txt_path):
            txt_path = os.path.join(target_dir, f"{clean_t}_{counter}.txt")
            counter += 1

        formatted = format_recipe_to_txt(
            title=clean_t,
            tags=tags,
            url=note['url'],
            ingredients=note['ingredients'],
            instructions=note['instructions'],
            raw_text=note['raw_text']
        )

        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(formatted)
        
        imported_count += 1
        print(f" [{imported_count}/{len(notes)}] {clean_t} -> {primary_cat}/")

    print(f"\nDone! Successfully imported {imported_count} recipes into '{args.outdir}'.")

if __name__ == "__main__":
    main()
