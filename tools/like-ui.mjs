#!/usr/bin/env node
/**
 * tools/like-ui.mjs —— 给视频点一次赞（2026-10-28 fish.21）
 * ============================================================================
 * 为什么先 UI：主人原话「她会自己双击点赞」——双击是抖音网页端的原生点赞手势，
 *   走页面自己的前端流程，最像真人（不会像纯 API 那样突兀）。
 * 流程：
 *   ① 无头 Chrome 打开 /video/<id>，等到 video 元素出现
 *   ② 在视频画面中心**双击**（CDP clickCount=2）
 *   ③ 等 1.2s，DOM 判断是否已赞（取消点赞 aria / like 元素 active / 图标变红）
 *   ④ UI 没确认 ⇒ **API 兜底**：页面上下文 POST `/aweme/v1/web/commit/item/digg/…`
 *      （页面自己的签名器补 a_bogus —— 和 comment-api.mjs 发评论同一条路）
 *   ⑤ 两种都不成 ⇒ ok:false（整体最多 2 次尝试：UI 1 次 + API 1 次）
 *
 * 用法:
 *   node tools/like-ui.mjs --aweme <id> [--why "一句话"] [--dry]
 *   node tools/like-ui.mjs --selftest        # 只测请求构造，不开浏览器
 * 输出一行 JSON：{ok, via:'ui'|'api'|'none', liked, status_code?, evidence?, error?}
 * ============================================================================
 */
import { openPage, sleep } from '../lib/chrome.mjs'
import { buildDiggUrl } from '../lib/home/likes.mjs'

const argv = process.argv.slice(2)
const argOf = (k, d = '') => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const AWEME = String(argOf('aweme', '')).trim()
const WHY = String(argOf('why', '')).trim()
const DRY = argv.includes('--dry')

const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exitCode = o.ok ? 0 : 1 }

/* ── 纯函数自测（不开浏览器）：点赞 API 请求构造 ── */
if (argv.includes('--selftest')) {
  const url = buildDiggUrl('1234567890123456789')
  const ok = url.startsWith('/aweme/v1/web/commit/item/digg/?')
    && url.includes('aweme_id=1234567890123456789')
    && url.includes('type=1')
    && url.includes('device_platform=webapp')
    && url.includes('aid=6383')
  out({ ok, selftest: true, url: url.slice(0, 180) })
  process.exit(ok ? 0 : 1)
}

if (!AWEME) { out({ ok: false, error: '缺 --aweme' }); process.exit(1) }
if (DRY) { out({ ok: true, dry: true, aweme_id: AWEME, url: buildDiggUrl(AWEME) }); process.exit(0) }

/** 页面上下文：判断"已赞"（多组启发式；返回证据方便排障） */
const detectJs = `(function(){
  var out = { liked:false, evidence:'' };
  // ⭐ 2026-10-28 实测：最权威的信号 = 点赞按钮容器的 data-e2e-state（is-digged / no-digged）。
  //   双击成功后它会立刻变成 video-player-is-digged；其它启发式（aria/红色/取消点赞文本）在网页里常常摸不到。
  try {
    var dig = document.querySelector('[data-e2e="video-player-digg"]');
    if (dig) {
      var st = String(dig.getAttribute('data-e2e-state')||'');
      if (/is-digged/i.test(st)) return JSON.stringify({liked:true, evidence:'digg-state:'+st});
      if (/no-digged/i.test(st)) out.evidence = 'digg-state:'+st;
    }
  } catch(e) {}
  function txt(el){ return ((el.getAttribute && (el.getAttribute('aria-label')||'')) + ' ' + (el.getAttribute && (el.getAttribute('title')||'')) + ' ' + (el.getAttribute && (el.getAttribute('class')||''))) }
  // ① aria/title 出现「取消点赞」＝已赞
  var all = document.querySelectorAll('[aria-label],[title]');
  for (var i=0;i<all.length;i++){ if ((txt(all[i])).indexOf('取消点赞')>=0){ out.liked=true; out.evidence='aria:取消点赞'; return JSON.stringify(out); } }
  // ② data-e2e / class 含 like 的元素带 active/liked/checked
  var cands = document.querySelectorAll('[data-e2e*="like"],[data-e2e*="Like"],[class*="like"],[class*="Like"]');
  for (var j=0;j<cands.length;j++){
    var t = txt(cands[j]);
    if (/liked|active|checked|selected/i.test(t)) { out.liked=true; out.evidence='dom:'+String(cands[j].getAttribute('data-e2e')||cands[j].className||'').slice(0,40); return JSON.stringify(out); }
    // ③ 点赞图标变红（#FE2C55 / rgb(254,44,85)）
    try {
      var svg = cands[j].querySelector ? cands[j].querySelector('svg') : null;
      if (svg) { var f = getComputedStyle(svg).fill || ''; if (/254,\\s*44,\\s*85|#FE2C55|rgb\\(254,44,85\\)/i.test(f)) { out.liked=true; out.evidence='svg-red'; return JSON.stringify(out); } }
    } catch(e) {}
  }
  // ④ 兜底：整页找「取消点赞」文本
  try { if (document.body && (document.body.innerText||'').indexOf('取消点赞')>=0) { out.liked=true; out.evidence='text:取消点赞'; } } catch(e) {}
  return JSON.stringify(out);
})()`

async function waitVideo(c) {
  const deadline = Date.now() + 22_000
  while (Date.now() < deadline) {
    try {
      const st = JSON.parse(await c.ev(`(function(){
        var v=document.querySelector('video');
        if(!v) return JSON.stringify({ready:false,url:location.href});
        v.scrollIntoView({block:'center'});
        var r=v.getBoundingClientRect();
        var x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);
        x=Math.max(10,Math.min(x, (window.innerWidth||1200)-10));
        y=Math.max(90,Math.min(y, (window.innerHeight||800)-90));
        return JSON.stringify({ready:true, x:x, y:y, w:Math.round(r.width), h:Math.round(r.height), url:location.href});
      })()`))
      if (st.ready && st.w > 120 && st.h > 80) return st
    } catch { /* 页面重载中 */ }
    await sleep(1500)
  }
  return null
}

async function main() {
  const c = await openPage()
  const chrome = c.status
  const sendClick = async (x, y, count) => {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
    await sleep(120)
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: count })
    await sleep(60)
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: count })
  }
  let uiLiked = false
  let uiEvidence = ''
  let domAfterUi = null
  let api = null
  let domAfterApi = null
  try {
    await c.send('Page.navigate', { url: `https://www.douyin.com/video/${AWEME}` })
    // 页面可能被 SPA 拉回 /chat ⇒ 轮询 video + URL（和 comment-mention-ui 同一课）
    let spot = null
    for (let i = 0; i < 14 && !spot; i++) {
      spot = await waitVideo(c)
      if (!spot) {
        if (i > 0 && i % 4 === 0) {
          try { await c.send('Page.navigate', { url: `https://www.douyin.com/video/${AWEME}` }) } catch { /* ignore */ }
        }
      }
    }
    if (!spot) { out({ ok: false, via: 'none', error: '视频页没加载出来（video 元素没出现）', aweme_id: AWEME, chrome }); return }
    if (!String(spot.url || '').includes(`/video/${AWEME}`)) {
      try { await c.send('Page.navigate', { url: `https://www.douyin.com/video/${AWEME}` }) } catch { /* ignore */ }
      await sleep(2500)
    }
    /** ⭐ 2026-10-28：**先看当前状态**——如果已经赞过就直接返回，
     *   千万别再双击：双击是 toggle，会把已赞的视频**取消点赞**。 */
    const initial = JSON.parse(await c.ev(detectJs))
    if (initial && initial.liked) {
      out({ ok: true, via: 'ui', liked: true, already: true, aweme_id: AWEME, why: WHY || undefined, evidence: String(initial.evidence || ''), chrome })
      return
    }

    // ① UI 双击（第一次点击 + 第二次 clickCount=2 形成 dblclick）
    await sendClick(spot.x, spot.y, 1)
    await sleep(110)
    await sendClick(spot.x, spot.y, 2)
    await sleep(1300)
    domAfterUi = JSON.parse(await c.ev(detectJs))
    uiLiked = Boolean(domAfterUi && domAfterUi.liked)
    uiEvidence = String((domAfterUi && domAfterUi.evidence) || '')

    // ② API 兜底（UI 没确认才走）
    if (!uiLiked) {
      const diggUrl = buildDiggUrl(AWEME)
      api = JSON.parse(await c.ev(`(async function(){
        try {
          var r = await fetch(${JSON.stringify(diggUrl)}, {
            method:'POST', credentials:'include',
            headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Referer':'https://www.douyin.com/' },
            body:''
          });
          var t = await r.text();
          var sc = null; try { var j = JSON.parse(t); sc = (j.status_code===undefined?null:j.status_code); } catch(e){}
          return JSON.stringify({ http:r.status, status_code:sc, head:String(t||'').slice(0,180) });
        } catch(e) { return JSON.stringify({ error:String((e&&e.message)||e) }); }
      })()`))
      await sleep(1400)
      domAfterApi = JSON.parse(await c.ev(detectJs))
    }
  } finally {
    try { c.close() } catch { /* ignore */ }
    await sleep(200)   // 等 WebSocket 关掉（libuv 断言踩过）
  }

  const apiOk = Boolean(api && api.status_code === 0)
  const domLiked = Boolean((domAfterApi && domAfterApi.liked) || uiLiked)
  /** 🔴 2026-10-28 实测：API 返回 status_code=0 / is_digg:1 **不代表真的赞上了**
   *   （页面状态仍是 no-digged、点赞数也不变）——所以成功**只认页面状态**。
   *   API 仅作兜底尝试，不再单独算成功。 */
  const ok = domLiked
  const via = domLiked ? (uiLiked ? 'ui' : 'ui/dom') : (apiOk ? 'api' : 'none')
  return out({
    ok, via: ok ? (uiLiked ? 'ui' : 'api') : 'none',
    liked: domLiked, aweme_id: AWEME, why: WHY || undefined,
    evidence: uiEvidence || (domAfterApi && domAfterApi.evidence) || '',
    status_code: api ? api.status_code : undefined,
    http: api ? api.http : undefined,
    ui_liked: uiLiked, api_ok: apiOk,
    head: api && api.head ? String(api.head).slice(0, 120) : undefined,
    error: ok ? undefined : (api && api.error ? String(api.error).slice(0, 160)
      : (api ? `点赞没成（UI 未确认，API status_code=${api.status_code}）` : '点赞没成（UI 未确认，API 未执行）')),
    chrome,
  })
}

main().catch((e) => out({ ok: false, via: 'none', error: String(e?.message ?? e).slice(0, 240) }))
