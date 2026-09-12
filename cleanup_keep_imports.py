import os
import shutil

workspace = os.path.dirname(os.path.abspath(__file__))
general_dir = os.path.join(workspace, "recipes_exported", "General")
exported_dir = os.path.join(workspace, "recipes_exported")

# Mapping of actual Keep recipes to their target categories
RECIPE_DESTINATIONS = {
    "Chicken Burritos.txt": "Poultry",
    "Shawarma Marinade.txt": "Poultry",
    "Homemade Metric Baharat Spice Mix (For 1 kg Chicken).txt": "Poultry",
    "Chilli con Carne.txt": "Beef",
    "Pressure Cooker Beef Pot Roast.txt": "Beef",
    "Arayes.txt": "Lamb",
    "Lancashire Lamb Hotpot.txt": "Lamb",
    "Braised Pork Shoulder Steaks for 2.txt": "Pork",
    "Spanish Rice.txt": "Pork",
    "For the fish.txt": "Seafood",
    "Base Gravy Masala.txt": "Indian",
    "Bread.txt": "Vegetarian",
    "Couscous with sundried tomatoes and feta.txt": "Vegetarian",
    "Pressure Cooker Harissa Beans.txt": "Vegetarian",
    "Roast Potato Crisp Salad.txt": "Vegetarian",
    "Roast Tomato & Red Pepper Soup.txt": "Vegetarian",
    "Instant pot rice.txt": "Vegetarian",
    "Edibles.txt": "Desert"
}

def cleanup():
    if not os.path.exists(general_dir):
        print("General directory does not exist or has already been cleaned.")
        return

    moved_count = 0
    for filename, target_cat in RECIPE_DESTINATIONS.items():
        src = os.path.join(general_dir, filename)
        if os.path.exists(src):
            dest_folder = os.path.join(exported_dir, target_cat)
            os.makedirs(dest_folder, exist_ok=True)
            dest_file = os.path.join(dest_folder, filename)
            shutil.copy2(src, dest_file)
            moved_count += 1
            print(f"Moved recipe: '{filename}' -> {target_cat}/")

    # Count non-recipe files to be deleted
    all_files = os.listdir(general_dir)
    print(f"\nCleaning up {len(all_files)} non-recipe and duplicate notes from General/...")

    # Remove the entire General folder
    shutil.rmtree(general_dir)
    print(f"Successfully removed 'recipes_exported/General/' folder.")
    print(f"\nSummary:")
    print(f"  - Preserved and categorized {moved_count} Keep recipes into proper folders.")
    print(f"  - Deleted non-recipe notes (alarm codes, wifi passwords, to-dos, etc.).")
    print(f"  - Cleaned all duplicate '_1.txt' files.")

if __name__ == "__main__":
    cleanup()
