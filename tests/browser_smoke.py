"""Browser regression checks. All provider traffic is mocked; no real API keys."""
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
    binary = os.environ.get('BROWSER_BIN') or shutil.which('chromium')
    browser = pw.chromium.launch(**({'executable_path': binary} if binary else {}), args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1280, 'height': 900})
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(URL)
    page.locator('#start-dialog').wait_for(state='visible')
    page.fill('#name-input', 'テストの旅人')
    page.fill('#seed-input', '42')
    page.locator('#start-form button[type=submit]').click()
    saved = lambda: json.loads(page.evaluate("localStorage.getItem('roguechat_v2_run')"))
    def tab(name):
        page.click(f'#tab-{name}')
        assert page.locator(f'#tab-{name}').get_attribute('aria-selected') == 'true'
    def fits():
        page.wait_for_timeout(80)
        assert page.evaluate('document.documentElement.scrollHeight <= innerHeight + 1')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.evaluate("document.querySelector('.footer-tabs').getBoundingClientRect().bottom <= (visualViewport?.height||innerHeight)+1")
        assert page.evaluate("document.querySelector('.cell.player').getBoundingClientRect().bottom <= document.querySelector('#map').getBoundingClientRect().bottom + 1")
    assert page.locator('#player-name').inner_text() == 'テストの旅人'
    fits()
    page.click('#guard-button'); assert saved()['turn'] == 0
    page.click('#proposal-cancel'); assert saved()['turn'] == 0
    page.click('#guard-button'); page.click('#proposal-execute'); assert saved()['turn'] == 1
    tab('inventory')
    page.click('#dock-inventory-list [data-group="tonic"]')
    assert page.locator('#instance-select option').count() == 3
    assert '未識別' in page.locator('#instance-detail').inner_text()
    page.click('#item-use'); assert saved()['turn'] == 2
    assert len(saved()['player']['inventory']) == 3
    page.reload(); page.click('#resume-button'); assert saved()['turn'] == 2
    assert page.locator('#turn-text').inner_text() == 'TURN 002'

    # Viewport, every footer pane, landscape, and compact touch controls.
    for width, height in [(1280,900),(768,600),(390,844),(375,667),(320,568),(844,390),(390,340)]:
        page.set_viewport_size({'width': width, 'height': height})
        for name in ['controls','command','inventory','observe']:
            tab(name); fits()
        assert page.evaluate("getComputedStyle(document.querySelector('#dpad button')).userSelect") == 'none'
    page.set_viewport_size({'width': 390, 'height': 844}); tab('controls')
    page.screenshot(path=str(OUTPUT / 'mobile.png'))
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.screenshot(path=str(OUTPUT / 'desktop.png'))

    # The requested defaults are sent, with isolated provider credentials.
    page.click('#mode-button')
    assert page.input_value('#model-input') == 'gpt-6-luna'
    page.fill('#key-input', 'test-openai'); page.locator('#settings-form button[type=submit]').click()
    assert page.evaluate("localStorage.getItem('roguechat_v2_key_openai')") is None
    assert page.evaluate("sessionStorage.getItem('roguechat_v2_key_openai')") == 'test-openai'
    requests = []
    def mock_api(route):
        body = route.request.post_data_json
        world = json.loads(body['input'][0]['content'] if 'input' in body else body['messages'][0]['content'])['world']
        requests.append({'url': route.request.url, 'body': body, 'world': world, 'headers': route.request.headers})
        p = world['player']
        result = {'title':'記憶の盾','reasoning':'名前の物語を護りにする。','skill':'wit','difficulty':2,'effort':2,'success':'記号が輪郭を護った。','failure':'記号がほどけた。','consumes':[], 'effects':[{'kind':'ward','target':'self','x':p['x'],'y':p['y'],'name':'','detail':'','symbol':''}]}
        data = {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(result)}]}]} if 'openai' in route.request.url else {'stop_reason':'end_turn','content':[{'type':'text','text':json.dumps(result)}]}
        route.fulfill(status=200,content_type='application/json',body=json.dumps(data))
    page.route('https://api.openai.com/**',mock_api); page.route('https://api.anthropic.com/**',mock_api)
    tab('command'); page.fill('#command-input','記憶から盾を編む'); page.click('#propose-button')
    page.locator('#proposal-dialog').wait_for(state='visible')
    assert requests[-1]['body']['model'] == 'gpt-6-luna'
    assert requests[-1]['headers']['authorization'] == 'Bearer test-openai'
    assert all('modifier' not in i for i in requests[-1]['world']['player']['inventory'])
    page.click('#proposal-execute'); assert saved()['turn'] == 3
    # Bind a specific named consumable. The engine consumes it even if the GM omits consumes.
    tab('inventory'); page.click('#dock-inventory-list [data-group="tonic"]')
    wanted = saved()['player']['inventory'][0]
    page.select_option('#instance-select', wanted['id']); page.click('#item-language')
    assert page.locator('#active-item').is_visible()
    page.fill('#command-input', wanted['name']+'を、霧の盾にする'); page.click('#propose-button')
    page.locator('#proposal-dialog').wait_for(state='visible')
    assert requests[-1]['world']['selectedItem']['id'] == wanted['id']
    assert 'modifier' not in requests[-1]['world']['selectedItem']
    assert wanted['name'] in page.locator('#proposal-materials').inner_text()
    page.click('#proposal-execute'); assert saved()['turn'] == 4
    assert wanted['id'] not in [i['id'] for i in saved()['player']['inventory']]
    page.click('#mode-button'); page.select_option('#provider-input','anthropic')
    assert page.input_value('#model-input') == 'claude-haiku-5-5'
    assert page.input_value('#key-input') == ''
    page.fill('#key-input','test-anthropic'); page.check('#remember-key'); page.locator('#settings-form button[type=submit]').click()
    page.fill('#command-input','記憶を盾にする'); page.click('#propose-button')
    page.locator('#proposal-dialog').wait_for(state='visible')
    assert requests[-1]['body']['model'] == 'claude-haiku-5-5'
    assert requests[-1]['headers']['x-api-key'] == 'test-anthropic'
    assert 'authorization' not in requests[-1]['headers']
    page.click('#proposal-cancel'); assert saved()['turn'] == 4
    page.unroute('https://api.anthropic.com/**')
    page.route('https://api.anthropic.com/**',lambda route:route.fulfill(status=429,body='{}'))
    page.click('#propose-button'); page.locator('#toast').filter(has_text='利用上限').wait_for(state='visible'); assert saved()['turn'] == 4
    page.click('#mode-button'); page.click('#clear-keys'); page.locator('#settings-dialog [data-close]').click()
    assert page.evaluate("localStorage.getItem('roguechat_v2_key_anthropic')") is None
    assert page.evaluate("sessionStorage.getItem('roguechat_v2_key_openai')") is None

    # A real pointer hold turns a corridor corner and stops before a staircase.
    page.evaluate("""async()=>{
      const {Game}=await import('/js/game.js');const g=new Game({seed:42});
      g.dungeon.grid=g.dungeon.grid.map(r=>r.map(()=> '#'));
      for(let x=2;x<=8;x++)g.dungeon.grid[3][x]='.';
      for(let y=3;y<=9;y++)g.dungeon.grid[y][8]='.';
      g.dungeon.grid[9][8]='>';Object.assign(g.player,{x:2,y:3});
      g.dungeon.enemies=[];g.dungeon.objects=[];g.dungeon.drops=[];
      g.updateVision();localStorage.setItem('roguechat_v2_run',g.serialize());
    }""")
    page.reload(); page.click('#resume-button'); tab('controls')
    rect = page.locator('[data-dx="1"][data-dy="0"]').bounding_box()
    page.mouse.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2); page.mouse.down()
    page.wait_for_timeout(2300); page.mouse.up()
    assert saved()['player']['x'] == 8 and saved()['player']['y'] == 8
    turns=saved()['turn']; page.wait_for_timeout(400); assert saved()['turn']==turns
    assert page.evaluate('getSelection().toString()') == ''
    page.click('#search-button'); assert saved()['turn'] == turns+1
    page.click('#history-button'); assert page.locator('#full-history .log-entry').count()>0; page.keyboard.press('Escape')

    # Synthesize a useful item, identify its fixed correction, then use it.
    page.evaluate("""async()=>{
      const {Game}=await import('/js/game.js');const {makeItem}=await import('/js/items.js');
      const g=new Game({seed:42,background:'scholar'});
      g.dungeon.enemies=[];g.player.inventory=[makeItem('tonic',g.id()),makeItem('focus',g.id())];
      g.player.hp=10;g.player.focus=10;g.rng=42;g.updateVision();localStorage.setItem('roguechat_v2_run',g.serialize());
    }""")
    page.reload(); page.click('#resume-button'); page.click('#craft-button')
    assert '霊薬' in page.locator('#craft-preview').inner_text()
    page.click('#craft-execute'); crafted=saved()['player']['inventory'][0]
    assert crafted['key']=='elixir' and not crafted['identified']
    page.reload(); page.click('#resume-button'); tab('inventory')
    page.click('#dock-inventory-list [data-group="elixir"]'); assert '未識別' in page.locator('#instance-detail').inner_text()
    page.click('#item-identify'); assert saved()['player']['inventory'][0]['identified']
    page.click('#dock-inventory-list [data-group="elixir"]'); assert '11' in page.locator('#instance-detail').inner_text()
    page.click('#item-use'); assert saved()['player']['hp']==21

    # Threat observation and the death/resume/restart and win screens.
    page.evaluate("""async()=>{
      const {Game}=await import('/js/game.js');const g=new Game({seed:42});
      g.player.hp=1;
      g.dungeon.enemies=[{id:g.id(),type:'archer',name:'頁の射手',symbol:'a',x:g.player.x+1,y:g.player.y,hp:16,maxHp:16,attack:7,range:5,behavior:'ranged',intent:{tiles:[{x:g.player.x,y:g.player.y}],label:'射撃'},stunned:0,burning:0,friendly:false,tags:['紙'],detail:'射撃'}];
      g.updateVision();localStorage.setItem('roguechat_v2_run',g.serialize());
    }""")
    page.reload(); page.click('#resume-button'); page.click('#dpad .wait')
    assert saved()['ended']=='dead' and page.locator('#ending-dialog').is_visible()
    page.reload(); page.click('#resume-button'); assert page.locator('#ending-dialog').is_visible()
    page.click('#ending-new'); page.locator('#start-form button[type=submit]').click()
    assert saved()['ended'] is None and page.locator('dialog[open]').count()==0
    page.evaluate("""async()=>{
      const {Game}=await import('/js/game.js');const g=new Game({seed:42});g.floor=5;g.loadFloor();Object.assign(g.player,g.dungeon.exit);
      g.dungeon.enemies.find(e=>e.type==='warden').friendly=true;g.updateVision();localStorage.setItem('roguechat_v2_run',g.serialize());
    }""")
    page.reload(); page.click('#resume-button'); page.click('#interact-button')
    assert saved()['ended']=='won' and '星を持ち帰った' in page.locator('#ending-title').inner_text()
    # Actual mobile touch events exercise pointer capture and long-press suppression.
    mobile = browser.new_context(viewport={'width':390,'height':844}, is_mobile=True, has_touch=True)
    touch = mobile.new_page()
    touch.on('pageerror', lambda error: errors.append(str(error)))
    touch.goto(URL)
    touch.evaluate("""async()=>{
      const {Game}=await import('/js/game.js');const g=new Game({seed:42});
      g.dungeon.grid=g.dungeon.grid.map(r=>r.map(()=> '#'));
      for(let x=2;x<=8;x++)g.dungeon.grid[3][x]='.';
      for(let y=3;y<=9;y++)g.dungeon.grid[y][8]='.';
      g.dungeon.grid[9][8]='>';Object.assign(g.player,{x:2,y:3});
      g.dungeon.enemies=[];g.dungeon.objects=[];g.dungeon.drops=[];
      g.updateVision();localStorage.setItem('roguechat_v2_run',g.serialize());
    }""")
    touch.reload(); touch.click('#resume-button'); touch.wait_for_timeout(100)
    rect=touch.locator('[data-dx="1"][data-dy="0"]').bounding_box()
    cdp=mobile.new_cdp_session(touch)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':rect['x']+rect['width']/2,'y':rect['y']+rect['height']/2}]})
    touch.wait_for_timeout(2300)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
    touch_save=json.loads(touch.evaluate("localStorage.getItem('roguechat_v2_run')"))
    assert (touch_save['player']['x'],touch_save['player']['y']) == (8,8)
    touch.wait_for_timeout(400)
    assert json.loads(touch.evaluate("localStorage.getItem('roguechat_v2_run')"))['turn']==touch_save['turn']
    assert touch.evaluate('getSelection().toString()') == ''
    assert touch.evaluate('document.documentElement.scrollHeight <= innerHeight+1')
    mobile.close()
    assert not errors, errors
    browser.close()
print('Browser checks passed: viewport-fit footer tabs, touch hold/corner/stop, grouped named inventory, synthesis/identify/use, API defaults and hidden data, history, saves, endings.')
print(f'Screenshots: {OUTPUT}')
