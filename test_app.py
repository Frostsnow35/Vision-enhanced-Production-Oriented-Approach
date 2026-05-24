"""Test the POA frontend application using Playwright."""
from playwright.sync_api import sync_playwright

def test_all_pages():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        pages_to_test = [
            ("Home", "http://127.0.0.1:3001"),
            ("Scenario", "http://127.0.0.1:3001/scenario"),
            ("Task", "http://127.0.0.1:3001/task"),
            ("Attempt1", "http://127.0.0.1:3001/attempt1"),
            ("Facilitate", "http://127.0.0.1:3001/facilitate"),
            ("Attempt2", "http://127.0.0.1:3001/attempt2"),
            ("Evaluate", "http://127.0.0.1:3001/evaluate"),
            ("Report", "http://127.0.0.1:3001/report/1"),
        ]

        results = []

        for name, url in pages_to_test:
            try:
                print(f"Testing: {name} ({url})")
                page.goto(url, timeout=15000)
                page.wait_for_load_state("networkidle", timeout=15000)

                title = page.title()
                print(f"  Title: {title}")

                page.screenshot(path=f"/tmp/poa_{name.lower()}.png", full_page=True)
                print(f"  Screenshot saved: /tmp/poa_{name.lower()}.png")

                # Check for error states
                body_text = page.locator("body").inner_text()
                has_error = "error" in body_text.lower() and "错误" not in body_text.lower()

                results.append((name, "PASS", title, not has_error))
            except Exception as e:
                print(f"  FAILED: {e}")
                results.append((name, "FAIL", str(e), False))

        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        all_pass = True
        for name, status, detail, ok in results:
            flag = "✓" if status == "PASS" else "✗"
            print(f"  {flag} {name}: {status} - {detail[:80]}")
            if status != "PASS":
                all_pass = False

        browser.close()

        if all_pass:
            print("\n✅ All pages loaded successfully!")
        else:
            print("\n⚠️ Some pages failed to load.")


def test_api_proxy():
    """Test that the Next.js rewrites proxy works."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("\nTesting API proxy via frontend...")
        page.goto("http://127.0.0.1:3001", timeout=15000)
        page.wait_for_load_state("networkidle", timeout=15000)

        # Test the API proxy by calling /api/scenario/analyze via fetch in browser
        result = page.evaluate("""
            async () => {
                try {
                    const res = await fetch('/api/scenario/analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ image_path: 'sample_images/cafe.jpg' })
                    });
                    if (!res.ok) {
                        return { error: `Status ${res.status}: ${await res.text()}` };
                    }
                    return await res.json();
                } catch (e) {
                    return { error: e.message };
                }
            }
        """)

        print(f"  API result: {result}")

        if "error" in result:
            print("  ❌ API proxy test FAILED")
        else:
            print("  ✅ API proxy test PASSED")

        browser.close()


if __name__ == "__main__":
    test_all_pages()
    test_api_proxy()