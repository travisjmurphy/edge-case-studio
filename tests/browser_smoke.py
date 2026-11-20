"""Optional QA: existing Playwright + Chromium only. No downloads or setup.
Local synthetic reports, temporary fresh profiles only; no personal browser session.
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
def generated(schema, fmt):
    return subprocess.run(["node",str(ROOT/"scripts/edge-case.cjs"),"--stdin","--format",fmt],
                          input=json.dumps(schema).encode(),stdout=subprocess.PIPE,check=True).stdout

def main():
    exe=shutil.which("chromium") or shutil.which("google-chrome")
    if not exe: raise SystemExit("Existing Chromium/Chrome executable required for this optional smoke.")
    with sync_playwright() as driver, tempfile.TemporaryDirectory(prefix="edge report with spaces ") as tmp:
        browser=driver.chromium.launch(executable_path=exe)
        try:
            for width in (1280,390):
                ctxt=browser.new_context(viewport={"width":width,"height":840},accept_downloads=True,offline=True)
                page=ctxt.new_page(); faults=[]; network=[]
                page.on("pageerror",lambda e:faults.append(str(e)))
                page.on("request",lambda req:network.append(req.url) if req.url.startswith(("https:","http:")) else None)
                page.goto((ROOT/"examples/checkout-report.html").as_uri())
                assert page.locator(".row").count()==45
                assert json.loads(page.locator("#payload").inner_text())["lineItem"]["quantity"]==0
                page.get_by_label("Outcome").select_option("accept")
                page.get_by_label("Find a field").fill("quantity")
                assert page.locator(".row").count()==2
                page.locator(".row").last.focus(); page.keyboard.press("Enter")
                assert json.loads(page.locator("#payload").inner_text())["lineItem"]["quantity"]==99
                assert page.locator(".row[aria-pressed=true]").evaluate("b => b === document.activeElement")
                page.get_by_label("Find a field").fill("unmatched")
                assert page.locator("#num").inner_text()=="0" and page.locator("#payload").inner_text()==""
                page.get_by_label("Find a field").fill("")
                assert page.locator(".row").count()==17
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                with page.expect_download() as saved: page.get_by_text("Save JSONL",exact=True).click()
                assert saved.value.suggested_filename=="edge-cases-checkout-42.jsonl"
                assert saved.value.path().read_bytes()==(ROOT/"examples/checkout.cases.jsonl").read_bytes()
                assert not faults and not network,(faults,network)
                print(f"{width}px checkout: loaded locally offline, filters/recovery, keyboard focus, no horizontal overflow, full JSONL download verified")
                ctxt.close()
            # Display unusual but legitimate field/enum strings without treating them as markup.
            schema={"type":"object","properties":{"box~1/x":{"type":"string","enum":["<box> & freight","wrap\u202eabc 🚚"]}}}
            custom=Path(tmp)/"custom report.html";custom.write_bytes(generated(schema,"html"))
            ctxt=browser.new_context(offline=True,accept_downloads=True);page=ctxt.new_page();page.goto(custom.as_uri())
            page.locator(".row").filter(has_text="Allowed enum option 2").click()
            value=page.locator("#payload").inner_text()
            assert "\\u202e" in value and json.loads(value)=={"box~1/x":"wrap\u202eabc 🚚"}
            page.locator(".row").filter(has_text="Allowed enum option 1").click()
            assert json.loads(page.locator("#payload").inner_text())=={"box~1/x":"<box> & freight"}
            with page.expect_download() as saved: page.get_by_text("Save JSONL",exact=True).click()
            assert saved.value.path().read_bytes()==generated(schema,"jsonl")
            ctxt.close(); print("custom schema: pointer/markup-shaped text and bidirectional character displayed as data; download matches CLI bytes")
        finally: browser.close()
if __name__=="__main__": main()

