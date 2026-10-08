"""Run with a static server on :8000 and Python Playwright installed.
API traffic is mocked: no real credentials, charges, or external requests.
"""
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('TEST_URL', 'http://127.0.0.1:8000')
OUTPUT = Path(os.environ.get('TEST_OUTPUT', '/tmp/roguechat-test-results'))
OUTPUT.mkdir(parents=True, exist_ok=True)
errors = []

with sync_playwright() as pw:
    browser_path = os.environ.get('BROWSER_BIN') or shutil.which('chromium')
    browser = pw.chromium.launch(**({'executable_path': browser_path} if browser_path else {}), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1280, 'height': 1000})
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.locator('#start-dialog').wait_for(state='visible')
    page.screenshot(path=str(OUTPUT / 'start.png'))
    page.fill('#name-input', 'テストの旅人')
    page.fill('#seed-input', '42')
    page.locator('#start-form button[type=submit]').click()
    assert not page.locator('#start-dialog').is_visible()
    assert page.locator('.cell').count() == 43 * 25
    assert page.locator('#player-name').inner_text() == 'テストの旅人'
    saved = lambda: json.loads(page.evaluate("localStorage.getItem('roguechat_v2_run')"))
    page.locator('#map .player').click()
    assert '旅人' in page.locator('#inspect-title').inner_text() or '入口' in page.locator('#inspect-title').inner_text()
    assert saved()['turn'] == 0
    page.click('#guard-button')
    assert page.locator('#proposal-dialog').is_visible()
    assert saved()['turn'] == 0
    page.click('#proposal-cancel')
    assert saved()['turn'] == 0
    page.click('#guard-button')
    page.click('#proposal-execute')
    assert saved()['turn'] == 1
    page.click('#inventory-button')
    page.locator('#inventory-list button', has_text='使う').first.click()
    assert saved()['turn'] == 2
    assert len(saved()['player']['inventory']) == 3
    page.reload()
    page.click('#resume-button')
    assert saved()['turn'] == 2
    assert page.locator('#turn-text').inner_text() == 'TURN 002'

    # API keys remain in session storage unless explicit persistence is selected.
    page.click('#mode-button')
    page.fill('#key-input', 'test-openai')
    page.locator('#settings-form button[type=submit]').click()
    assert page.evaluate("localStorage.getItem('roguechat_v2_key_openai')") is None
    assert page.evaluate("sessionStorage.getItem('roguechat_v2_key_openai')") == 'test-openai'
    requests = []
    def mock_api(route):
        request = route.request
        body = request.post_data_json
        requests.append({'url': request.url, 'body': body, 'headers': request.headers})
        world = json.loads(body['input'][0]['content'] if 'input' in body else body['messages'][0]['content'])['world']
        p = world['player']
        action = {'title': '記憶の盾', 'reasoning': '記憶を護りの記号に編む。', 'skill': 'wit', 'difficulty': 2, 'effort': 2, 'success': '記号が輪郭を護る。', 'failure': '記号がほどけた。', 'consumes': [], 'effects': [{'kind': 'ward', 'target': 'self', 'x': p['x'], 'y': p['y'], 'name': '', 'detail': '', 'symbol': ''}]}
        data = {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(action)}]}]} if 'openai' in request.url else {'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': json.dumps(action)}]}
        route.fulfill(status=200, content_type='application/json', body=json.dumps(data))
    page.route('https://api.openai.com/**', mock_api)
    page.route('https://api.anthropic.com/**', mock_api)
    page.fill('#command-input', '記憶から盾を編む')
    page.click('#propose-button')
    page.locator('#proposal-dialog').wait_for(state='visible')
    assert page.locator('#proposal-title').inner_text() == '記憶の盾'
    assert requests[-1]['url'] == 'https://api.openai.com/v1/responses'
    assert requests[-1]['headers']['authorization'] == 'Bearer test-openai'
    assert saved()['turn'] == 2
    page.click('#proposal-execute')
    assert saved()['turn'] == 3
    page.click('#mode-button')
    page.select_option('#provider-input', 'anthropic')
    assert page.input_value('#key-input') == ''
    page.fill('#key-input', 'test-anthropic')
    page.check('#remember-key')
    page.locator('#settings-form button[type=submit]').click()
    assert page.evaluate("localStorage.getItem('roguechat_v2_key_anthropic')") == 'test-anthropic'
    page.fill('#command-input', '記憶から盾を編む')
    page.click('#propose-button')
    page.locator('#proposal-dialog').wait_for(state='visible')
    assert requests[-1]['headers']['x-api-key'] == 'test-anthropic'
    assert 'authorization' not in requests[-1]['headers']
    page.click('#proposal-cancel')
    assert saved()['turn'] == 3
    page.unroute('https://api.anthropic.com/**')
    page.route('https://api.anthropic.com/**', lambda route: route.fulfill(status=429, content_type='application/json', body='{}'))
    page.click('#propose-button')
    page.locator('#toast').filter(has_text='利用上限').wait_for(state='visible')
    assert saved()['turn'] == 3
    page.click('#mode-button')
    page.click('#clear-keys')
    page.locator('#settings-dialog [data-close]').click()
    assert page.evaluate("localStorage.getItem('roguechat_v2_key_anthropic')") is None
    assert page.evaluate("sessionStorage.getItem('roguechat_v2_key_openai')") is None

    # A fixture with visible threats tests map/inspection and death/resume dialogs.
    page.evaluate("""async () => {
      const {Game} = await import('/js/game.js');
      const g = new Game({seed:42,name:'影を編む旅人'});
      g.dungeon.grid = g.dungeon.grid.map((r,y)=>r.map((t,x)=>x&&y&&x<42&&y<24?'.':'#'));
      Object.assign(g.player,{x:10,y:10});
      g.dungeon.enemies=[{id:g.id(),type:'archer',name:'頁の射手',symbol:'a',x:13,y:10,hp:16,maxHp:16,attack:7,range:5,behavior:'ranged',intent:{tiles:[{x:10,y:10}],label:'射撃'},stunned:0,burning:0,friendly:false,tags:['紙','言葉'],detail:'予告マスに射撃。'}];
      g.updateVision();localStorage.setItem('roguechat_v2_run',g.serialize());
    }""")
    page.reload(); page.click('#resume-button')
    page.locator('.cell.enemy').click()
    assert '頁の射手' in page.locator('#inspect-title').inner_text()
    assert page.locator('.cell.threat').count() == 1
    assert page.locator('.threat-row').count() == 1
    page.screenshot(path=str(OUTPUT / 'desktop.png'), full_page=True)
    page.click('[data-command="敵を説得する"]')
    assert '和解' in page.locator('#proposal-effects').inner_text()
    page.click('#proposal-cancel')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_function("document.querySelectorAll('.cell').length===25*19")
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(OUTPUT / 'mobile.png'), full_page=True)
    for width in [320, 375, 768, 1280]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), width
    page.set_viewport_size({'width': 390, 'height': 844})
    page.click('#inventory-button')
    assert page.locator('#inventory-dialog').is_visible()
    assert page.evaluate("document.querySelector('#inventory-dialog').getBoundingClientRect().width <= innerWidth")
    page.keyboard.press('Escape')
    # A fatal hit persists, resumes to one ending dialog, and can start fresh.
    page.evaluate("""() => { const d=JSON.parse(localStorage.getItem('roguechat_v2_run')); d.player.hp=1; localStorage.setItem('roguechat_v2_run',JSON.stringify(d)); }""")
    page.reload(); page.click('#resume-button')
    page.click('#dpad .wait')
    assert page.locator('#ending-dialog').is_visible()
    assert saved()['ended'] == 'dead'
    page.reload()
    assert not page.locator('#ending-dialog').is_visible()
    page.click('#resume-button')
    assert page.locator('#ending-dialog').is_visible()
    page.click('#ending-new')
    page.locator('#start-form button[type=submit]').click()
    assert page.locator('dialog[open]').count() == 0
    assert saved()['ended'] is None
    page.evaluate("""async () => {
      const {Game}=await import('/js/game.js');const g=new Game({seed:42});
      g.floor=5;g.loadFloor();Object.assign(g.player,g.dungeon.exit);
      g.dungeon.enemies.find(e=>e.type==='warden').friendly=true;
      g.updateVision();localStorage.setItem('roguechat_v2_run',g.serialize());
    }""")
    page.reload(); page.click('#resume-button'); page.click('#interact-button')
    assert saved()['ended'] == 'won'
    assert '星を持ち帰った' in page.locator('#ending-title').inner_text()
    assert not errors, errors
    browser.close()
print('Browser checks passed: desktop/mobile, input, proposals, inventory, save/resume, both APIs, errors, key storage, death/restart.')
print(f'Screenshots: {OUTPUT}')
