#!/usr/bin/env node
/**
 * tools/card-share.mjs —— 用抖音自己的「分享给朋友」把视频以**卡片**发给好友
 * ============================================================================
 * 为什么必须这么做：分享卡片（aweType 800 / MessageItemShareAweme）是前端把结构化
 * 消息交给服务端生成的，纯文本 + URL 永远做不出卡片；而且文本链接在抖音里点不开。
 *
 * 链路（全在无头 Chrome 里，屏幕上无窗口）：
 *   视频页 → 鼠标轨迹 hover 分享图标 → 面板展开 →
 *   找「<昵称>」那一行的「分享」按钮 → 点击 → 卡片发出
 *
 * ⚠️ 分享图标没有 onClick，是 onMouseEnter/onFocus 的 hover 弹窗，
 *    所以必须用**真实鼠标轨迹**移过去，`el.click()` 打不开（踩过）。
 *
 * 用法:
 *   node tools/card-share.mjs <aweme_id> <好友昵称>
 *   node tools/card-share.mjs <aweme_id> <好友昵称> --dry    # 只展开面板打印结构
 */
import { openPage, sleep } from '../lib/chrome.mjs'

const argv = process.argv.slice(2)
const argOf = (k, d = '') => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? d) : d }
const DRY = argv.includes('--dry')
const PEEK = argv.includes('--peek')
const TOID = argOf('--to-id', '')
// 位置参数：跳过 `--to-id` 后面那个值
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--to-id'))
const AID = pos[0] || ''
const WHO = pos[1] || ''
const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exitCode = o.ok ? 0 : 1 }

if (!AID || !WHO) { out({ ok: false, error: '用法: card-share.mjs <aweme_id> <好友昵称>' }); process.exit(1) }

const _c = await openPage()
const chromed = _c.status
const { send, ev } = _c
const mv = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
const click = async (x, y) => {
  await mv(x, y); await sleep(120)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

try {
  await send('Page.navigate', { url: `https://www.douyin.com/video/${AID}` })
  /**
   * ⭐ fish.25：图文（note）支持 —— /video/<id> 会被自动重定向到 /note/<id>，这是**正常情况**。
   *   等「URL 含 /video/ 或 /note/ + 分享入口出现」，别再用固定 sleep 7 秒判"视频页没加载好"。
   */
  let iconPos = null
  for (let i = 0; i < 14 && !iconPos; i++) {
    await sleep(1500)
    try {
      iconPos = JSON.parse(await ev(`(function(){
        var h = location.href || '';
        var okUrl = h.indexOf('/video/${AID}') >= 0 || h.indexOf('/note/${AID}') >= 0;
        if (!okUrl) return '{}';
        // 视频页老选择器优先；图文页是 [data-e2e="video-player-share"]（右侧操作栏）
        var ic = document.querySelector('[data-e2e="video-share-icon-container"]')
          || document.querySelector('[data-e2e="video-player-share"]');
        if (!ic) return '{}';
        ic.scrollIntoView({ block: 'center' });
        var r = ic.getBoundingClientRect();
        if (!(r.width > 4 && r.height > 4)) return '{}';
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), kind: (h.indexOf('/note/') >= 0 ? 'note' : 'video') });
      })()`))
    } catch { /* 页面重载中，下一拍再试 */ }
    if (!iconPos || !iconPos.x) {
      iconPos = null
      if (i > 0 && i % 4 === 0) {
        try { await send('Page.navigate', { url: `https://www.douyin.com/video/${AID}` }) } catch { /* 导航被打断，下一拍重试 */ }
      }
    }
  }
  const pos = iconPos || {}
  if (!pos.x) { out({ ok: false, error: '找不到分享图标（视频/图文页没加载好）' }); process.exit(1) }

  // 真实轨迹 hover（必须；el.click() 打不开）
  await mv(20, 20); await sleep(250)
  for (let i = 1; i <= 8; i++) {
    await mv(Math.round(20 + (pos.x - 20) * i / 8), Math.round(20 + (pos.y - 20) * i / 8))
    await sleep(70)
  }
  await mv(pos.x, pos.y)
  await sleep(2000)

  /**
   * 找分享面板并打标记（图文页可能复用视频面板；选择器兜底 + 文本特征兜底）。
   * 找不到就先 hover 再**点一下**分享入口（图文页的分享按钮是点击弹出）。
   */
  const evalPanel = async () => String(await ev(`(function(){
    var sc = document.querySelector('[data-dy-share-panel="1"]')
      || document.querySelector('[data-e2e="video-share-container"]');
    if (!sc) {
      var cands = Array.prototype.slice.call(document.querySelectorAll('div[class*="share"],div[data-e2e*="share"]'));
      var best = null;
      cands.forEach(function(e){
        var t = (e.innerText || '');
        if (t.indexOf('分享') < 0) return;
        var r = e.getBoundingClientRect();
        if (r.width < 150 || r.height < 120) return;
        if (!best || r.height > best.h) best = { e: e, h: r.height };
      });
      if (best) sc = best.e;
    }
    if (!sc) return '';
    sc.setAttribute('data-dy-share-panel', '1');
    return (sc.innerText || '').replace(/\\s+/g, ' ').slice(0, 400);
  })()`))
  let panel = await evalPanel()
  if (!panel) {
    // 兜底：点一下分享入口，再等面板
    await click(pos.x, pos.y)
    await sleep(1800)
    panel = await evalPanel()
  }
  if (!panel) { out({ ok: false, error: '分享面板没展开', note_kind: pos.kind }); process.exit(1) }

  // --peek：把面板里每一行连同它 fiber 里的 id 都打出来（排查重名用）
  if (PEEK) {
    const rows = await ev(`(function(){
      var sc = document.querySelector('[data-dy-share-panel="1"]') || document.querySelector('[data-e2e="video-share-container"]');
      if (!sc) return '[]';
      var out = [];
      sc.querySelectorAll('div').forEach(function(e){
        var t = (e.innerText||'').replace(/\\s+/g,' ').trim();
        if (!t || t.length > 40 || t === '分享') return;
        var fk = Object.keys(e).find(function(k){ return k.indexOf('__reactFiber$')===0 });
        var ids = [];
        if (fk) {
          var f = e[fk], d = 0;
          while (f && d < 12) {
            var p = f.memoizedProps;
            if (p && typeof p === 'object') {
              for (var k in p) {
                if (typeof p[k] === 'string' && /^(MS4wLjABAA|11-)\\S{6,}$/.test(p[k])) ids.push(k + '=' + p[k]);
                else if (p[k] && typeof p[k] === 'object' && p[k].sec_uid) ids.push('obj.sec_uid=' + p[k].sec_uid);
                else if (p[k] && typeof p[k] === 'object' && p[k].uid) ids.push('obj.uid=' + p[k].uid);
              }
            }
            f = f.return; d++;
          }
        }
        var uniq = []; ids.forEach(function(x){ if (uniq.indexOf(x)<0) uniq.push(x) });
        if (uniq.length) out.push({ text: t.slice(0,30), ids: uniq.slice(0,4) });
      });
      var seen={},u=[]; out.forEach(function(o){var k=o.text; if(!seen[k]){seen[k]=1;u.push(o);}});
      return JSON.stringify(u.slice(0,12));
    })()`)
    out({ ok: true, peek: true, panel, rows: JSON.parse(rows || '[]') })
    _c.close(); process.exit(0)
  }

  // 找「WHO」那一行：同时拿到 昵称 + **sec_uid** + 「分享」按钮坐标 —— 昵称会重名，sec_uid 不会
  const found = await ev(`(function(){
    var who = ${JSON.stringify(WHO)};
    var sc = document.querySelector('[data-dy-share-panel="1"]') || document.querySelector('[data-e2e="video-share-container"]');
    if(!sc) return JSON.stringify({err:'no-panel'});
    function secOf(node){
      var fk = Object.keys(node).find(function(k){ return k.indexOf('__reactFiber$')===0 });
      if(!fk) return '';
      var f = node[fk], d = 0;
      while (f && d < 14) {
        var p = f.memoizedProps;
        if (p && typeof p === 'object') {
          for (var k in p) { var v = p[k]; if (v && typeof v === 'object' && v.sec_uid) return String(v.sec_uid); }
        }
        f = f.return; d++;
      }
      return '';
    }
    var nodes = Array.prototype.slice.call(sc.querySelectorAll('div,span,p')).filter(function(e){
      return (e.innerText||'').trim() === who;
    }).sort(function(a,b){ return a.getBoundingClientRect().width - b.getBoundingClientRect().width });
    if(!nodes.length) return JSON.stringify({err:'no-name', text:(sc.innerText||'').replace(/\\s+/g,' ').slice(0,160)});
    var out = [];
    nodes.forEach(function(nameNode){
      var row = nameNode;
      for (var i=0;i<6 && row;i++){
        var btns = Array.prototype.slice.call(row.querySelectorAll('div,span,button')).filter(function(e){
          return (e.innerText||'').trim()==='分享';
        });
        if (btns.length){
          var b = btns[0], r = b.getBoundingClientRect();
          if (r.width>16 && r.height>12){
            out.push({ nick: who, sec_uid: secOf(row) || secOf(nameNode),
              btn: {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:Math.round(r.width), h:Math.round(r.height)} });
          }
          break;
        }
        row = row.parentElement;
      }
    });
    var seen={}, uniq=[];
    out.forEach(function(o){ var k=o.sec_uid||(o.btn.x+','+o.btn.y); if(!seen[k]){seen[k]=1;uniq.push(o)} });
    return JSON.stringify({candidates: uniq});
  })()`)

  let f = {}
  try { f = JSON.parse(found) } catch { f = { err: 'bad-json' } }
  if (f.err) { out({ ok: false, error: '找不到该好友那一行', detail: f, panel }); process.exit(1) }

  let cands = f.candidates || []
  if (TOID) {
    cands = cands.filter((c) => c.sec_uid === TOID)
    if (!cands.length) { out({ ok: false, error: `分享面板里没有 sec_uid=${TOID} 这个人（面板只列最近分享过的人）`, panel }); process.exit(1) }
  }
  if (cands.length > 1) {
    out({
      ok: false,
      error: '分享面板里有多个同名的人，不敢猜（猜错就是把视频发给陌生人）',
      nick: WHO,
      candidates: cands.map((c) => ({ sec_uid: c.sec_uid })),
      hint: '请改用 --to-id <sec_uid> 指定',
    })
    process.exit(1)
  }
  const b = cands[0].btn
  const target = { nick: WHO, sec_uid: cands[0].sec_uid || TOID || '' }
  if (DRY) { out({ ok: true, dry: true, panel, btn: b, target, chrome: chromed, matched_by: TOID ? 'sec_uid' : 'nickname(唯一)' }); _c.close(); process.exit(0) }

  /**
   * ⭐ fish.28：先**直接点 DOM 里的「分享」按钮**，别再用坐标点。
   *   实测坐标会打偏：分享面板是贴着视频右侧弹出的，好友列表第一行（常常就是置顶的
   *   示例主人）的 y 会落进页面顶部搜索条的区域，`elementFromPoint` 拿到的是
   *   「示例角色 搜索」而不是「分享」——点下去只把面板关了，卡片根本没发出去，
   *   而脚本还会秒回 ok:true（因为没抛异常）。所以：DOM 点优先，坐标点只做兜底。
   */
  const domClick = await ev(`(function(){
    var who = ${JSON.stringify(WHO)};
    var sc = document.querySelector('[data-dy-share-panel="1"]') || document.querySelector('[data-e2e="video-share-container"]');
    if (!sc) return JSON.stringify({err:'no-panel'});
    var nodes = Array.prototype.slice.call(sc.querySelectorAll('div,span,p')).filter(function(e){
      return (e.innerText||'').trim() === who;
    }).sort(function(a,b){ return a.getBoundingClientRect().width - b.getBoundingClientRect().width });
    if (!nodes.length) return JSON.stringify({err:'no-name'});
    var row = nodes[0], btn = null;
    for (var i = 0; i < 6 && row; i++) {
      var bs = Array.prototype.slice.call(row.querySelectorAll('div,span,button')).filter(function(e){
        return (e.innerText||'').trim() === '分享';
      });
      if (bs.length) { btn = bs[0]; break }
      row = row.parentElement;
    }
    if (!btn) return JSON.stringify({err:'no-btn'});
    btn.click();
    return JSON.stringify({ok: true, by: 'dom-click'});
  })()`)
  let dm = {}
  try { dm = JSON.parse(domClick) } catch { dm = { err: 'bad-json' } }
  let clickBy = dm.ok ? 'dom-click' : 'coord'
  if (!dm.ok) {
    // 兜底：坐标点（老路子，面板位置正常时也能用）
    await click(b.x, b.y)
  }
  await sleep(2500)

  const after = await ev(`(function(){
    var sc=document.querySelector('[data-dy-share-panel="1"]') || document.querySelector('[data-e2e="video-share-container"]');
    return JSON.stringify({
      panelStillOpen: sc ? sc.getBoundingClientRect().height > 10 : false,
      panelText: sc ? (sc.innerText||'').replace(/\\s+/g,' ').slice(0,200) : '',
      toast: (document.body.innerText||'').indexOf('已发送')>=0 || (document.body.innerText||'').indexOf('发送成功')>=0
    });
  })()`)
  out({ ok: true, sent: true, aweme_id: AID, to: WHO, panel, btn: b, click_by: clickBy, dom_error: dm.err || '', chrome: chromed, after: JSON.parse(after) })
} catch (e) {
  out({ ok: false, error: String(e?.message ?? e) })
} finally {
  _c.close()
}
process.exit(process.exitCode || 0)
