#!/usr/bin/env node
/**
 * tools/frame-grab.mjs —— 截抖音视频的「首页截图」（2026-10-27；fish.13 加多帧）
 * ============================================================================
 * 为什么：小肥鱼判断视频只能看文案/标签/评论，**看不到画面** —— 纯颜值、擦边类
 *   文案往往很短，光靠文字判断不出来。主人拍板（2026-10-27）：
 *   「做 A 吧，然后截屏出来，判断完之后，记得把截屏清除了，不要占用存储空间。」
 *   ⇒ 只对「命中偏好 + 文案太弱」的少数候选截 1 帧，给跑轮模型用 read_image 看；
 *     看完由插件在轮末删掉（这里只负责截，不负责清理）。
 *
 * 怎么截（⚠️ 不下载视频、不装 ffmpeg）：
 *   连无头 Chrome（复用 9334 那个已登录实例）→ 新标签打开视频页 →
 *   等 <video> readyState>=2 → pause + seek → Page.captureScreenshot
 *   → 只裁 <video> 那块 → 存成 png → 关标签页。
 *
 * 用法:
 *   node frame-grab.mjs --aweme 7696xxxx,7696yyyy --out <目录> [--time 0.6]
 *   node frame-grab.mjs --aweme 7696xxxx --out <目录> --at 0.1,0.5,0.9   # 多帧（比例或秒）
 *   说明：--at 里 0<值<=1 视为「时长的比例」（0.1/0.5/0.9 = 10%/50%/90% 时间点），
 *         >1 视为绝对秒数；不给 --at 时沿用 --time（默认 0.6s，视频短就取中间）。
 * 输出（stdout 最后一行 JSON）:
 *   { ok:true, frames:[{aweme_id, frame, at_s, duration_s}], errors:[{aweme_id,error}] }
 * ============================================================================
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openTab, sleep } from '../lib/chrome.mjs'

const argv = process.argv.slice(2)
const argOf = (name, dflt = '') => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}

const awemes = String(argOf('aweme', '')).split(',').map((s) => s.trim()).filter(Boolean)
const outDir = String(argOf('out', '.')).trim() || '.'
const singleAt = Math.max(0.1, Number(argOf('time', '0.6')) || 0.6)
/** ⭐ fish.13：--at 0.1,0.5,0.9（比例）或 0.6,3.5（秒）；没给就沿用 --time 的单帧 */
const atSpec = String(argOf('at', '')).trim()
const atList = atSpec
  ? atSpec.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  : []

const result = { ok: false, frames: [], errors: [] }

if (!awemes.length) {
  console.log(JSON.stringify({ ok: false, error: '缺 --aweme' }))
  process.exit(0)
}
mkdirSync(outDir, { recursive: true })

/** 把 --at 的每一项换成「秒」：<=1 按时长比例，>1 当绝对秒；都夹在 [0.1, dur-0.2] */
function targetsFor(dur) {
  const d = Number(dur) || 0
  const clamp = (t) => {
    if (!(d > 0.5)) return Math.max(0.1, t)
    return Math.min(Math.max(0.1, t), Math.max(0.1, d - 0.2))
  }
  if (atList.length) return atList.map((v) => clamp(v <= 1 ? v * d : v))
  return [clamp(d > 0.5 ? Math.min(singleAt, Math.max(0.2, d * 0.5)) : singleAt)]
}

for (const aweme of awemes) {
  let tab = null
  try {
    tab = await openTab({ url: `https://www.douyin.com/video/${aweme}` })

    // ① 等 <video> 就绪（最多 ~18 秒）
    let meta = null
    for (let i = 0; i < 30; i++) {
      await sleep(600)
      const s = await tab.ev(`(() => {
        const v = document.querySelector('video')
        return JSON.stringify({ href: location.href, hasVideo: !!v, ready: v ? v.readyState : -1, dur: v ? (v.duration || 0) : 0 })
      })()`)
      const o = (() => { try { return JSON.parse(s || '{}') } catch { return {} } })()
      if (o.hasVideo && o.ready >= 2) { meta = o; break }
      if (i === 5 && !o.hasVideo) {
        // 可能被登录墙/验证页挡住 —— 不硬等，直接记错
        result.errors.push({ aweme_id: aweme, error: '页面上没有 video（可能是图文/登录墙/验证）' })
        break
      }
    }
    if (!meta) throw new Error('video 没就绪')

    const dur = Number(meta.dur) || 0
    const targets = targetsFor(dur)

    // ② 只裁 <video> 那块（拿不到就整页截图）—— 一次算好，多帧复用
    const rectRaw = await tab.ev(`(() => {
      const v = document.querySelector('video')
      if (!v) return ''
      const r = v.getBoundingClientRect()
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height })
    })()`)
    let clip = null
    try {
      const r = JSON.parse(rectRaw || '{}')
      if (r && r.w >= 40 && r.h >= 40 && r.x >= 0 && r.y >= 0) {
        clip = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h), scale: 1 }
      }
    } catch { /* 整页截图兜底 */ }

    for (const t of targets) {
      // 暂停并 seek 到该时间点
      await tab.ev(`new Promise((res) => {
        const v = document.querySelector('video')
        if (!v) return res('no-video')
        v.muted = true
        try { v.pause() } catch {}
        let done = false
        const fin = (why) => { if (!done) { done = true; res(why) } }
        v.addEventListener('seeked', () => fin('seeked'), { once: true })
        try { v.currentTime = ${JSON.stringify(t)} } catch { fin('seek-err') }
        setTimeout(() => fin('timeout'), 3000)
      })`)
      await sleep(700)   // 等一帧画上去

      const shot = await tab.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' })
      if (!shot?.data) throw new Error(`截图没数据（t=${t}）`)
      const frame = join(outDir, `${aweme}@${t.toFixed(1)}s.png`)
      writeFileSync(frame, Buffer.from(shot.data, 'base64'))
      result.frames.push({ aweme_id: aweme, frame, at_s: Math.round(t * 10) / 10, duration_s: Math.round(dur * 10) / 10 })
    }
  } catch (e) {
    result.errors.push({ aweme_id: aweme, error: String(e?.message ?? e).slice(0, 160) })
  } finally {
    try { await tab?.closeTab?.() } catch { /* 关不掉就算了 */ }
    try { tab?.close?.() } catch { /* 已经断了 */ }
  }
}

result.ok = result.frames.length > 0
console.log(JSON.stringify(result))
