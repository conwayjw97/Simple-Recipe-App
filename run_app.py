import os
import sys
import socket
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class CustomHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        app_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
        super().__init__(*args, directory=app_dir, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def main():
    port = 8000
    local_ip = get_local_ip()
    server_address = ("", port)
    
    httpd = HTTPServer(server_address, CustomHandler)
    
    desktop_url = f"http://localhost:{port}"
    mobile_url = f"http://{local_ip}:{port}"
    
    print("=" * 60)
    print("🍳 RecipeBox Web App is running!")
    print("=" * 60)
    print(f"  🖥️  Desktop URL:  {desktop_url}")
    print(f"  📱  Mobile Wi-Fi: {mobile_url}")
    print("=" * 60)
    print("To install on your Android phone:")
    print(f"  1. Ensure phone is on the same Wi-Fi network")
    print(f"  2. Open Chrome on your phone and go to: {mobile_url}")
    print(f"  3. Tap the 3 dots in Chrome -> 'Install app' or 'Add to Home screen'")
    print("=" * 60)
    print("Press Ctrl+C in this terminal to stop the server.\n")

    # Automatically open in desktop browser
    try:
        webbrowser.open(desktop_url)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down RecipeBox server.")
        httpd.server_close()
        sys.exit(0)

if __name__ == "__main__":
    main()
