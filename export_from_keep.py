import os
import re
import sys
import json
import getpass
import argparse
import gkeepapi

TOKEN_FILE = "keep_token.txt"

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
        # If parsing couldn't split cleanly, preserve full body cleanly
        lines.append(raw_text.strip())

    return "\n".join(lines) + "\n"

def parse_note_body(text, list_items=None):
    """
    Intelligently splits note text or list items into ingredients and instructions.
    """
    ingredients = []
    instructions = []
    urls = []

    # Find URLs
    found_urls = re.findall(r'https?://[^\s]+', text or '')
    if found_urls:
        urls.extend(found_urls)

    if list_items:
        # If it was a checklist in Keep
        for item in list_items:
            t = clean_text(item.text)
            if not t:
                continue
            if re.search(r'https?://[^\s]+', t):
                urls.extend(re.findall(r'https?://[^\s]+', t))
            # Determine if step or ingredient
            if re.match(r'^(step|\d+[\.\)]|preheat|bake|fry|cook|mix|boil|heat|serve)', t, re.IGNORECASE):
                instructions.append(t)
            else:
                ingredients.append(t)
        return ingredients, instructions, (urls[0] if urls else "")

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

def main():
    parser = argparse.ArgumentParser(description="Export recipe notes from Google Keep to Google Drive text format")
    parser.add_argument("--email", default="cigol1234@gmail.com", help="Google account email")
    parser.add_argument("--password", help="Google App Password (16 letters)")
    parser.add_argument("--token", help="Master token (if using gpsoauth token)")
    parser.add_argument("--label", help="Filter by specific Keep label (e.g. 'Recipe', 'Cooking'). If omitted, lists options.")
    parser.add_argument("--all-notes", action="store_true", help="Search across all notes regardless of labels")
    parser.add_argument("--dry-run", action="store_true", help="Preview matching notes without saving files")
    parser.add_argument("--outdir", default="recipes_exported", help="Output directory (default: recipes_exported)")
    args = parser.parse_args()

    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    token_path = os.path.join(workspace_dir, TOKEN_FILE)

    keep = gkeepapi.Keep()

    # Determine token or password
    token = args.token
    if not token and os.path.exists(token_path):
        with open(token_path, "r", encoding="utf-8") as f:
            token = f.read().strip()

    if token:
        print(f"Authenticating as {args.email} using saved Master Token...")
        try:
            keep.authenticate(args.email, token)
        except Exception as e:
            print(f"Master token authentication failed ({e}). Prompting for App Password...")
            token = None

    if not token:
        password = args.password
        if not password:
            password = input("Enter or paste 16-character App Password: ")
            if not password:
                print("No password provided. Exiting.")
                return

        # Strip all spaces and newlines (Google displays them in blocks of 4: 'xxxx xxxx xxxx xxxx')
        cleaned_password = re.sub(r'\s+', '', password).strip()
        print(f"Cleaned password to use: {cleaned_password} ({len(cleaned_password)} characters)")
        password = cleaned_password

        print(f"Logging in to Google Keep as {args.email}...")
        try:
            keep.login(args.email, password)
            # Save master token for future runs so password is not requested again
            try:
                master_token = keep.getMasterToken()
                if master_token:
                    with open(token_path, "w", encoding="utf-8") as f:
                        f.write(master_token)
                    print(f"Saved session token to {TOKEN_FILE} for instant future logins.")
            except Exception:
                pass
        except Exception as e:
            print(f"\nLogin failed: {e}")
            print("\nCommon reasons for 'BadAuthentication':")
            print("1. Regular password used: You MUST use a 16-letter App Password, not your standard Google password.")
            print("   (Generate one at: https://myaccount.google.com/apppasswords)")
            print("2. 2-Step Verification: Make sure 2FA is active on your Google account before generating an App Password.")
            print("3. Typo in App Password: Try generating a fresh one and pasting it.")
            print("4. Alternative: You can also use Google Takeout (zero passwords needed):")
            print("   Go to https://takeout.google.com -> select only 'Keep' -> download the zip -> run 'python import_from_takeout.py Takeout.zip'")
            return

    print("Successfully connected and synced with Google Keep!")

    # Discover available labels in Keep
    labels = keep.labels()
    label_names = [lbl.name for lbl in labels]
    print(f"\nFound {len(label_names)} labels in your Google Keep:")
    for name in sorted(label_names):
        print(f"  • {name}")

    target_label = args.label
    if not target_label and not args.all_notes:
        # Check if Recipe or Cooking exists
        recipe_label_match = next((l for l in label_names if l.lower() in ["recipe", "recipes", "cooking", "food"]), None)
        if recipe_label_match:
            print(f"\nAuto-detected primary recipe label: '{recipe_label_match}'")
            target_label = recipe_label_match
        else:
            print("\nWhich label would you like to export from? (or type 'all' for all notes)")
            choice = input("Enter label name or 'all': ").strip()
            if choice.lower() == 'all':
                args.all_notes = True
            else:
                target_label = choice

    # Query notes
    notes_to_process = []
    if args.all_notes:
        print("\nFetching all active notes...")
        notes_to_process = [n for n in keep.all() if not n.trashed]
    else:
        lbl_obj = keep.findLabel(target_label)
        if not lbl_obj:
            # Case-insensitive search
            lbl_obj = next((l for l in labels if l.name.lower() == target_label.lower()), None)

        if not lbl_obj:
            print(f"Error: Label '{target_label}' not found in Google Keep.")
            return

        print(f"\nFetching notes labeled '{lbl_obj.name}'...")
        notes_to_process = list(keep.find(labels=[lbl_obj]))

    print(f"Found {len(notes_to_process)} note(s) to process.")

    if not notes_to_process:
        print("No notes found matching your criteria.")
        return

    out_base = os.path.join(workspace_dir, args.outdir)
    os.makedirs(out_base, exist_ok=True)

    exported_count = 0

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Processing notes:")
    for idx, note in enumerate(notes_to_process, 1):
        raw_title = note.title.strip() if note.title else ""
        note_labels = [l.name for l in note.labels.all()]

        # Extract text or list items
        list_items = getattr(note, 'items', None)
        note_text = note.text if hasattr(note, 'text') else ""

        ingredients, instructions, extracted_url = parse_note_body(note_text, list_items)

        # If title is empty, use first line or placeholder
        if not raw_title:
            if ingredients:
                raw_title = ingredients[0][:40]
            elif note_text:
                raw_title = note_text.splitlines()[0][:40]
            else:
                raw_title = f"Keep Note {idx}"

        title = clean_filename(raw_title)

        # Tags: collect all labels, remove primary 'Recipe' label if present to keep category specific
        tags = [l for l in note_labels if l.lower() not in ["recipe", "recipes"]]
        if not tags:
            # Check if any food keywords in title
            tags = ["General"]

        primary_cat = tags[0] if tags else "General"
        target_dir = os.path.join(out_base, clean_filename(primary_cat))

        formatted_txt = format_recipe_to_txt(
            title=title,
            tags=tags,
            url=extracted_url,
            ingredients=ingredients,
            instructions=instructions,
            raw_text=note_text
        )

        print(f" [{idx}/{len(notes_to_process)}] {title} (Tags: {', '.join(tags)}) -> {primary_cat}/")

        if not args.dry_run:
            os.makedirs(target_dir, exist_ok=True)
            txt_path = os.path.join(target_dir, f"{title}.txt")
            
            counter = 1
            while os.path.exists(txt_path):
                txt_path = os.path.join(target_dir, f"{title}_{counter}.txt")
                counter += 1

            with open(txt_path, "w", encoding="utf-8") as f:
                f.write(formatted_txt)

            exported_count += 1

    if args.dry_run:
        print(f"\nDry run complete. {len(notes_to_process)} notes matched. Run without --dry-run to save them.")
    else:
        print(f"\nSuccessfully exported {exported_count} recipes to '{args.outdir}'!")
        print("These files are now formatted and ready to be placed in your Google Drive folder.")

if __name__ == "__main__":
    main()
