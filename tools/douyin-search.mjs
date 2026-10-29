#!/usr/bin/env node
/**
 * tools/douyin-search.mjs —— 按关键词搜抖音视频（2026-10-28 fish.24）
 * ============================================================================
 * 主人要「搜索框找视频」：按关键词找特定主题（DSH / AI 工具 / 插件 / 主人的兴趣）。
 *
 * 怎么搜（2026-10-28 实测可行，别重新发明）：
 *   页面上下文直接 fetch 搜索接口 —— **不需要手工签名**（页面自己的 fetch 已带 a_bogus/token）：
 *     /aweme/v1/web/general/search/single/?keyword=…&search_channel=aweme_video_web&offset=0&count=10&aid=6383&device_platform=webapp
 *   ⚠️ 纯 DOM 抓搜索页不稳（实测抓不到），**以 API 为主**。
 *
 * 用法:
 *   node tools/douyin-search.mjs --keyword "DeepSeek Harness" [--count 10] [--offset 0] [--channel aweme_video_web]
 *   node tools/douyin-search.mjs --keyword "AI插件" --dry     # 只打印 URL/参数，不开浏览器
 * 输出一行 JSON:
 *   { ok:true, keyword, channel, count, items:[{aweme_id,kind:'video'|'note',desc,author,digg,comment,collect,share,duration_s,create_time,url}] }
 *   { ok:false, error, hint? }
 * ============================================================================
 */
import { openPage, sleep } from '../lib/chrome.mjs'
import { buildSearchUrl, DEFAULT_CHANNEL } from '../lib/home/search.mjs'

const argv = process.argv.slice(2)
const argOf = (k, d = '') => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const DRY = argv.includes('--dry')
const KEYWORD = String(argOf('keyword', '')).trim()
const COUNT = Math.max(1, Math.min(Math.trunc(Number(argOf('count', '10')) || 10), 30))
const OFFSET = Math.max(0, Math.trunc(Number(argOf('offset', '0')) || 0))
const CHANNEL = String(argOf('channel', DEFAULT_CHANNEL)).trim() || DEFAULT_CHANNEL

const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exitCode = o.ok ? 0 : 1 }

if (!KEYWORD) { out({ ok: false, error: '缺 --keyword（要搜什么）' }); process.exit(1) }

const url = buildSearchUrl(KEYWORD, { count: COUNT, offset: OFFSET, channel: CHANNEL })
if (DRY) { out({ ok: true, dry: true, keyword: KEYWORD, channel: CHANNEL, count: COUNT, offset: OFFSET, url }); process.exit(0) }

async function main() {
  let c = null
  try {
    c = await openPage()
    const chrome = c.status
    // 必须站在 douyin.com 上，相对路径 fetch 才带得上 cookie / 页面签名器
    let cur = ''
    try { cur = String(await c.ev('location.href')) } catch { cur = '' }
    if (!cur.includes('douyin.com')) {
      try { await c.send('Page.navigate', { url: 'https://www.douyin.com/' }) } catch { /* 导航中断属正常 */ }
      await sleep(6000)
    }
    const expr = `(async function(){
      var url = ${JSON.stringify(url)};
      try {
        var r = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
        var t = await r.text();
        var j = null;
        try { j = JSON.parse(t) } catch (e) {
          return JSON.stringify({ http: r.status, parse_error: String((e && e.message) || e), head: String(t || '').slice(0, 200) });
        }
        var data = (j && Array.isArray(j.data)) ? j.data : [];
        var items = [];
        for (var i = 0; i < data.length; i++) {
          var d = data[i];
          if (!d || Number(d.type) !== 1 || !d.aweme_info) continue;
          var a = d.aweme_info;
          var st = a.statistics || {};
          var v = a.video || {};
          var dur = Number(st.duration || v.duration || 0);
          // ⭐ fish.25：图文（note）也能搜到/能用 —— aweme_info.images 有内容 / aweme_type=68 ⇒ note
          var isNote = (Array.isArray(a.images) && a.images.length > 0) || Number(a.aweme_type) === 68;
          items.push({
            aweme_id: String(a.aweme_id || ''),
            kind: isNote ? 'note' : 'video',
            desc: String(a.desc || '').slice(0, 300),
            author: String((a.author && a.author.nickname) || ''),
            digg: Number(st.digg_count || 0),
            comment: Number(st.comment_count || 0),
            collect: Number(st.collect_count || 0),
            share: Number(st.share_count || 0),
            duration_s: dur > 0 ? Math.round(dur / 100) / 10 : null,
            create_time: Number(a.create_time || 0),
            url: 'https://www.douyin.com/' + (isNote ? 'note/' : 'video/') + String(a.aweme_id || '')
          });
        }
        return JSON.stringify({ http: r.status, status_code: (j && j.status_code !== undefined ? j.status_code : null), items: items });
      } catch (e) { return JSON.stringify({ error: String((e && e.message) || e) }) }
    })()`
    const raw = await c.ev(expr)
    let j = null
    try { j = JSON.parse(String(raw || '')) } catch { j = null }
    if (!j) {
      return out({ ok: false, error: '页面没返回可解析结果', hint: '页面可能被风控/登录态失效；去面板「连接」看一眼', chrome })
    }
    if (j.error) {
      return out({ ok: false, error: '搜索请求失败：' + String(j.error).slice(0, 160), hint: '稍后再试；或先确认抖音页面能正常打开（登录态）', chrome })
    }
    if (j.parse_error) {
      return out({ ok: false, error: '搜索返回不是 JSON（可能被风控）', head: j.head, http: j.http, chrome })
    }
    if (j.status_code !== 0) {
      return out({ ok: false, error: `搜索接口 status_code=${j.status_code}（可能风控/限流）`, http: j.http, hint: '等几分钟再试；别连续搜', chrome })
    }
    const items = Array.isArray(j.items) ? j.items.slice(0, COUNT) : []
    if (!items.length) {
      return out({ ok: false, error: '搜索结果为空', hint: '换个关键词试试（这个词在抖音可能没视频）；这不是插件坏了', http: j.http, chrome })
    }
    return out({ ok: true, keyword: KEYWORD, channel: CHANNEL, count: items.length, offset: OFFSET, items, chrome })
  } finally {
    try { c?.close?.() } catch { /* ignore */ }
    await sleep(200)   // 等 WebSocket 关掉（libuv 断言踩过）
  }
}

main().catch((e) => out({ ok: false, error: String(e?.message ?? e).slice(0, 240) }))
