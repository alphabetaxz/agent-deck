/* Ordinary ES5 script: Flyme's older browser has no modules, fetch or promises. */
(function () {
  'use strict';
  var timer, snapshot, wakeLock;
  var labels = {idle:'空闲', running:'工作中', waiting:'等待你处理', completed:'本轮完成', error:'异常', unknown:'状态未知'};
  function get(id) { return document.getElementById(id); }
  function show(node, visible) { node.style.display = visible ? '' : 'none'; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; }
  function notice(text) { get('notice').textContent = text || ''; show(get('notice'), !!text); fit(); }
  function request(path, data, done) {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(error, value, status) { if (finished) return; finished = true; done(error, value, status); }
    xhr.open(data == null ? 'GET' : 'POST', path, true); xhr.timeout = 10000;
    if (data != null) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var value;
      try { value = JSON.parse(xhr.responseText); } catch (e) { finish('无法连接 Mac，请检查 Wi-Fi', null, xhr.status); return; }
      finish(xhr.status >= 200 && xhr.status < 300 ? null : value.error || '连接失败', value, xhr.status);
    };
    xhr.onerror = xhr.ontimeout = function () { finish('与 Mac 的连接已中断，正在重连'); };
    xhr.send(data == null ? null : JSON.stringify(data));
  }
  function status(value) { return el('span', labels[value] || labels.unknown, 'status ' + value); }
  function render(data) {
    snapshot = data; var cards = window.AgentDeckDisplayCards(data.cards || [], data.displayPlugins || []), box = get('cards'), i, j, c, card, head, list, row, identity;
    clear(box); show(get('pair-screen'), false); get('connection').textContent = '已连接';
    for (i = 0; i < cards.length; i++) {
      c = cards[i]; card = el('article', null, 'card'); head = el('div', null, 'card-top');
      head.appendChild(el('h3', c.type === 'agent-summary' ? 'Agents' : c.title));
      if (c.type === 'agent-summary' || c.type === 'status') head.appendChild(status(c.status));
      card.appendChild(head);
      if (c.type === 'agent-summary') {
        card.className += ' agent-overview'; list = el('div', null, 'agent-states');
        for (j = 0; j < c.tools.length; j++) {
          row = el('div', null, 'agent-state'); identity = el('span', null, 'agent-identity');
          identity.appendChild(el('span', c.tools[j].name === 'pi' ? 'π' : c.tools[j].name.indexOf('Claude') === 0 ? '✳' : 'C', 'agent-icon'));
          identity.appendChild(el('span', c.tools[j].name)); row.appendChild(identity); row.appendChild(status(c.tools[j].status)); list.appendChild(row);
        }
        card.appendChild(list);
      } else {
        if (c.pluginStatus !== 'running') card.appendChild(el('p', '插件暂不可用 · 以下为最后数据'));
        if (c.type === 'text' || c.type === 'status') card.appendChild(el('p', c.text || c.summary));
        if (c.type === 'metric') card.appendChild(el('div', String(c.value) + (c.unit || ''), 'metric'));
        if (c.type === 'list') {
          list = el('ul', null, 'checklist');
          for (j = 0; j < c.items.length; j++) { row = el('li', null, c.items[j].done ? 'done' : ''); row.appendChild(el('span', c.items[j].done ? '✓' : '○', 'check')); row.appendChild(el('span', c.items[j].title)); list.appendChild(row); }
          if (!c.items.length) list.appendChild(el('li', '今天还没有待办。'));
          card.appendChild(list); card.appendChild(el('small', '', 'list-more'));
        }
      }
      box.appendChild(card);
    }
    if (!cards.length) box.appendChild(el('div', '暂无显示内容，请在 Mac 端启用插件并选择卡片。', 'empty'));
    get('last-update').textContent = '最后同步 ' + new Date().toLocaleTimeString(); fit();
  }
  function fit() {
    var height = window.innerHeight || document.documentElement.clientHeight, box = get('cards');
    document.body.style.height = height + 'px';
    var top = 70 + (get('notice').style.display === 'none' ? 0 : get('notice').offsetHeight + 8);
    box.style.top = top + 'px';
    var width = box.clientWidth, available = Math.max(0, height - top - 38), count = box.children.length, cols = width >= 600 && count > 1 ? 2 : 1, rows = Math.ceil(count / cols) || 1;
    var gap = 12, w = Math.max(0, (width - gap * (cols - 1)) / cols), h = Math.max(0, (available - gap * (rows - 1)) / rows), i, j, card, list, more, visible;
    for (i = 0; i < count; i++) {
      card = box.children[i]; card.style.left = (i % cols) * (w + gap) + 'px'; card.style.top = Math.floor(i / cols) * (h + gap) + 'px'; card.style.width = w + 'px'; card.style.height = h + 'px';
      list = card.querySelector('.checklist'); more = card.querySelector('.list-more');
      if (list) {
        visible = Math.max(0, Math.floor((h - list.offsetTop - 36) / 34));
        for (j = 0; j < list.children.length; j++) show(list.children[j], j < visible);
        more.textContent = '还有 ' + (list.children.length - visible) + ' 项'; show(more, visible < list.children.length);
      }
    }
  }
  function connect() {
    clearTimeout(timer);
    request('/api/snapshot', null, function (error, data, code) {
      if (!error) { render(data); notice(''); }
      else if (code === 401) { snapshot = null; clear(get('cards')); show(get('pair-screen'), true); get('connection').textContent = '等待配对'; notice(''); return; }
      else { get('connection').textContent = '离线 · 重连中'; notice(error); }
      timer = setTimeout(connect, error ? 4000 : 1500);
    });
  }
  show(get('notice'), false); show(get('pair-screen'), false);
  var match = /(?:^#|&)pair=([0-9]{8})(?:&|$)/.exec(location.hash);
  if (match) { get('pair-code').value = match[1]; if (history.replaceState) history.replaceState(null, '', location.pathname); }
  get('pair-form').onsubmit = function (event) {
    event.preventDefault(); var code = get('pair-code').value;
    if (!/^[0-9]{8}$/.test(code)) { notice('请输入 8 位配对码'); return; }
    var button = this.querySelector('button'); button.disabled = true;
    request('/api/pair', {code:code, name:get('device-name').value}, function (error) { button.disabled = false; if (error) notice(error); else connect(); });
  };
  get('fullscreen').onclick = function () {
    var node = document.documentElement, fn = node.requestFullscreen || node.webkitRequestFullscreen;
    if (!fn) { notice('当前浏览器不支持全屏，请使用浏览器的全屏选项。'); return; }
    try { var result = fn.call(node); if (result && result['catch']) result['catch'](function () { notice('无法进入全屏'); }); } catch (e) { notice('无法进入全屏'); }
  };
  function acquireWake() {
    if (!navigator.wakeLock) { notice('当前浏览器无法保持亮屏，请在手机设置中调整休眠时间。'); return; }
    navigator.wakeLock.request('screen').then(function (lock) { wakeLock = lock; get('wake').textContent = '亮屏已开启'; lock.addEventListener('release', function () { get('wake').textContent = '保持亮屏'; }); }, function () { notice('无法保持亮屏'); });
  }
  get('wake').onclick = acquireWake;
  window.addEventListener('resize', fit);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (wakeLock) acquireWake(); if (snapshot) fit(); } });
  connect();
}());
