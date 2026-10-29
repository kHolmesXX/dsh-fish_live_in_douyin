#!/usr/bin/env node
/**
 * tools/aweme-detail.mjs —— 用**页面上下文**取抖音作品详情（拿 play_addr 直链）
 *
 * 为什么不直接用 cdp-fetch：实测 `/aweme/v1/web/aweme/detail/` 走 cdp-fetch 常被风控软拒
 * （HTTP 200 空 body）；而在**页面里** fetch 同一条接口能拿到完整 JSON（2026-10-28 实测 72KB）。
 *
 * 用法：node tools/aweme-detail.mjs --aweme 7700956350092370536 [--kind video|note]
 * 输出一行 JSON：{ok, aweme_id, desc, author, duration_ms, play_urls:[...], detail}
 */
import { ensureChrome, sleep } from '../lib/chrome.mjs'

const argv = process.argv.slice(2)
const argOf = (k, d = '') => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const AWEME = String(argOf('aweme', '')).trim()
const KIND = String(argOf('kind', 'video')).trim() === 'note' ? 'note' : 'video'
if (!/^\d{10,20}$/.test(AWEME)) { console.log(JSON.stringify({ ok: false, error: '缺 --aweme <19位id>' })); process.exit(0) }

async function connect(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  let id = 0
  const p = new Map()
  await new Promise((r, j) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', () => j(new Error('ws')), { once: true }) })
  ws.addEventListener('message', (e) => { let m; try { m = JSON.parse(e.data) } catch { return } if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } })
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })) })
  const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result?.value }
  return { send, ev, close: () => { try { ws.close() } catch { /* */ } } }
}

const out = (o) => { console.log(JSON.stringify(o)); process.exit(0) }

try {
  const { port } = await ensureChrome()
  const url = `https://www.douyin.com/${KIND}/${AWEME}`
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
  if (!t?.webSocketDebuggerUrl) out({ ok: false, error: '开不出新标签页' })
  const c = await connect(t)
  await sleep(11000)
  const raw = await c.ev(`(async function(){
    try{
      var u='/aweme/v1/web/aweme/detail/?aweme_id=${AWEME}&aid=6383&device_platform=webapp';
      var res=await fetch(u,{credentials:'include',headers:{accept:'application/json'}});
      var txt=await res.text();
      return JSON.stringify({http:res.status,len:txt.length,txt:txt.slice(0,200000)});
    }catch(e){ return JSON.stringify({err:String(e&&e.message||e).slice(0,160)}) }
  })()`)
  c.close()
  let wrap = null
  try { wrap = JSON.parse(raw) } catch { out({ ok: false, error: '页面返回不可解析：' + String(raw).slice(0, 120) }) }
  if (wrap.err) out({ ok: false, error: wrap.err })
  let j = null
  try { j = JSON.parse(wrap.txt) } catch { out({ ok: false, error: 'detail JSON 解析失败，HTTP ' + wrap.http + '，len=' + wrap.len }) }
  const d = j && j.aweme_detail
  if (!d) out({ ok: false, error: '没有 aweme_detail（可能风控/作品不存在），HTTP ' + wrap.http })
  const urls = []
  const v = d.video || {}
  for (const src of [v.play_addr, v.download_addr]) {
    if (src && Array.isArray(src.url_list)) urls.push(...src.url_list)
  }
  for (const br of (Array.isArray(v.bit_rate) ? v.bit_rate : [])) {
    if (br && br.play_addr && Array.isArray(br.play_addr.url_list)) urls.push(...br.play_addr.url_list)
  }
  out({
    ok: true,
    aweme_id: AWEME,
    desc: String(d.desc || '').slice(0, 300),
    author: String((d.author && d.author.nickname) || ''),
    duration_ms: Number(v.duration) || 0,
    play_urls: [...new Set(urls)].slice(0, 6),
    detail: d,
  })
} catch (e) {
  out({ ok: false, error: String(e?.message ?? e).slice(0, 200) })
}
