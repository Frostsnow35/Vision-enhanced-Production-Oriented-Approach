from playwright.sync_api import sync_playwright
import time

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        
        # 1. 首页
        print("→ 访问首页...")
        page.goto("http://localhost:3002")
        time.sleep(2)
        page.screenshot(path="/tmp/poa_home.png", full_page=False)
        print(f"✓ 首页截图: /tmp/poa_home.png")
        
        # 2. 场景页
        print("\n→ 访问场景页...")
        page.goto("http://localhost:3002/scenario")
        time.sleep(2)
        page.screenshot(path="/tmp/poa_scenario.png", full_page=False)
        print(f"✓ 场景页截图: /tmp/poa_scenario.png")
        
        # 3. 任务页
        print("\n→ 访问任务页...")
        page.goto("http://localhost:3002/task")
        time.sleep(2)
        page.screenshot(path="/tmp/poa_task.png", full_page=False)
        print(f"✓ 任务页截图: /tmp/poa_task.png")
        
        # 4. 尝试页
        print("\n→ 访问尝试页...")
        page.goto("http://localhost:3002/attempt1")
        time.sleep(2)
        page.screenshot(path="/tmp/poa_attempt1.png", full_page=False)
        print(f"✓ 尝试页截图: /tmp/poa_attempt1.png")
        
        # 5. 诊断页
        print("\n→ 访问诊断页...")
        page.goto("http://localhost:3002/facilitate")
        time.sleep(2)
        page.screenshot(path="/tmp/poa_facilitate.png", full_page=False)
        print(f"✓ 诊断页截图: /tmp/poa_facilitate.png")
        
        print("\n✅ 所有页面访问完成！")
        print("\n🚀 本地运行服务地址:")
        print("   前端: http://localhost:3002")
        print("   后端: http://localhost:8001 (Swagger: http://localhost:8001/docs)")
        
        browser.close()

if __name__ == "__main__":
    main()