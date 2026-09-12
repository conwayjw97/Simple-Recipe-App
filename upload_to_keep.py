import os
import json
import time
import getpass
import argparse
import gkeepapi

def main():
    parser = argparse.ArgumentParser(description="Bulk upload recipes to Google Keep")
    parser.add_argument("--email", default="cigol1234@gmail.com", help="Google account email")
    parser.add_argument("--password", help="Google App Password (16 letters) or master token")
    parser.add_argument("--token", help="Master token (if using gpsoauth token authentication)")
    parser.add_argument("--label", default="Recipe", help="Primary label name (default: 'Recipe')")
    parser.add_argument("--no-category-labels", action="store_true", help="Disable adding subcategory labels (e.g. Pork, Poultry)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of recipes to upload (useful for testing)")
    parser.add_argument("--dry-run", action="store_true", help="Preview notes without creating them in Keep")
    args = parser.parse_args()

    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(workspace_dir, "recipes_database.json")

    if not os.path.exists(json_path):
        print(f"Error: Could not find {json_path}. Run export_all_recipes.py first.")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        recipes = json.load(f)

    # Filter to valid parsed recipes
    valid_recipes = [r for r in recipes if r.get('status') == 'success' and r.get('note_body')]
    print(f"Loaded {len(valid_recipes)} successfully parsed recipes from database.")

    if args.limit:
        valid_recipes = valid_recipes[:args.limit]
        print(f"Limited to first {len(valid_recipes)} recipes.")

    if args.dry_run:
        print("\n--- DRY RUN MODE (Previewing notes and labels) ---")
        for i, r in enumerate(valid_recipes[:6], 1):
            cat = r.get('category', 'General')
            labels = [args.label]
            if not args.no_category_labels and cat:
                labels.append(cat)
            print(f"\n[Note {i}] Title: {r['title']}")
            print(f"  Applied Labels: {labels}")
            preview_lines = r['note_body'].split('\n')[:6]
            print("  Body preview:")
            for pl in preview_lines:
                print(f"    {pl}")
            print("    ...")
        print(f"\nDry run complete. All {len(valid_recipes)} recipes are ready to upload with both labels.")
        return

    # Initialize Keep
    keep = gkeepapi.Keep()

    # Authentication
    email = args.email
    if args.token:
        print(f"Authenticating {email} using Master Token...")
        try:
            keep.authenticate(email, args.token)
        except Exception as e:
            print(f"Authentication failed: {e}")
            return
    else:
        password = args.password
        if not password:
            print("\nTo connect to Google Keep, you need a Google App Password.")
            print("(Generate one at: https://myaccount.google.com/apppasswords)")
            password = getpass.getpass(f"Enter Google App Password for {email}: ").strip()

        print(f"Logging in to Google Keep as {email}...")
        try:
            keep.login(email, password)
        except gkeepapi.exception.LoginException as e:
            print(f"\nLogin failed: {e}")
            print("\nTip: If Google rejects the app password directly, you can generate a master token using gpsoauth, or pass --token <master_token>.")
            return

    print("Successfully connected and synced with Google Keep!")

    def resolve_label(name):
        # 1. Direct case-insensitive match
        lbl = keep.findLabel(name)
        if lbl:
            return lbl
        # 2. Check plural/singular variations (e.g. Recipe <-> Recipes, Desert <-> Dessert)
        if name.lower() in ["recipe", "recipes"]:
            alt = "Recipes" if name.lower() == "recipe" else "Recipe"
            lbl = keep.findLabel(alt)
            if lbl:
                return lbl
        if name.lower() in ["desert", "dessert"]:
            alt = "Dessert" if name.lower() == "desert" else "Desert"
            lbl = keep.findLabel(alt)
            if lbl:
                return lbl
        # 3. Create if not found
        return keep.findLabel(name, create=True)

    # Find or create primary label ("Recipe")
    recipe_label = resolve_label(args.label)
    print(f"Primary label matched: '{recipe_label.name}'")

    # Pre-resolve subcategory labels
    category_labels = {}
    if not args.no_category_labels:
        categories = sorted(list(set(r.get('category') for r in valid_recipes if r.get('category'))))
        print("Matching/creating subcategory labels:")
        for cat in categories:
            lbl = resolve_label(cat)
            category_labels[cat] = lbl
            print(f"  - '{cat}' -> Google Keep label: '{lbl.name}'")

    print(f"\nStarting upload of {len(valid_recipes)} recipe notes...")
    uploaded_count = 0

    for idx, r in enumerate(valid_recipes, 1):
        title = r['title']
        body = r['note_body']
        cat = r.get('category')

        # Create note
        note = keep.createNote(title=title, text=body)
        note.labels.add(recipe_label)

        if not args.no_category_labels and cat in category_labels:
            note.labels.add(category_labels[cat])

        uploaded_count += 1

        # Sync periodically every 15 notes to save progress and prevent timeouts
        if idx % 15 == 0 or idx == len(valid_recipes):
            print(f"  Syncing progress: {idx}/{len(valid_recipes)} notes uploaded...")
            keep.sync()
            time.sleep(1)

    print(f"\nFinished! Successfully uploaded {uploaded_count} recipes to Google Keep.")
    print(f"All notes are tagged with label '{args.label}'.")

if __name__ == "__main__":
    main()
