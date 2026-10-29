#!/usr/bin/env node
/**
 * tools/download-media.mjs —— 把私信里的图片/表情包下载到本地（2026-10-28 fish.16）
 * ============================================================================
 * 为什么：主人发的图片/表情包，值班小鱼只能拿到文字，看不到图 ⇒ 下载后让她 read_image 看。
 *
 * 用法:
 *   node tools/download-media.mjs --url <https://…> --out <目录> --name <文件名主干>
 * 输出（stdout 一行 JSON）:
 *   { ok:true, path:"<out>/<name>.<ext>", bytes:12345, mime:"image/jpeg", ext:"jpg" }
 *   { ok:false, error:"…" }   ← 失败不抛，调用方只 log 不挡回复
 * 约束:
 *   · 带 UA + Referer: https://www.douyin.com/（CDN 直链有时要 referer）
 *   · 单文件 ≤ 8MB；按 content-type / URL 判 jpg|png|webp|gif（判不出就用 .bin）
 *   · 20 秒超时；任何异常都返回 ok:false
 * ============================================================================
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const argOf = (k, d = '') => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}

const url = String(argOf('url', '')).trim()
const outDir = String(argOf('out', '.')).trim() || '.'
const rawName = String(argOf('name', '')).trim()
const MAX = 8 * 1024 * 1024
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const safeName = (rawName || `media-${Date.now()}`).replace(/[^\w.-]/g, '_').slice(0, 80) || `media-${Date.now()}`

const out = (o) => { console.log(JSON.stringify(o)); process.exitCode = o.ok ? 0 : 1 }

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
}
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic'])

function pickExt(mime, u) {
  const m = String(mime || '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_MIME[m]) return EXT_BY_MIME[m]
  try {
    const p = new URL(u)
    const e = extname(p.pathname).replace('.', '').toLowerCase()
    if (ALLOWED_EXT.has(e)) return e === 'jpeg' ? 'jpg' : e
  } catch { /* ignore */ }
  return 'bin'
}

const INLINE_FORMATS = { webp: 'webp', png: 'png', jpg: 'jpg', jpeg: 'jpg' }

/**
 * ⭐ fish.17：inline base64 图片 → 直接写文件（index.js 的 chat-watch 媒体落盘用；
 *   不 spawn 子进程、不联网。图片本身就是 base64 内嵌在消息里）。
 * @returns {{ok:boolean, path?:string, bytes?:number, ext?:string, error?:string}}
 */
export function saveInlineBase64({ b64 = '', outDir = '.', name = '', format = 'webp' } = {}) {
  try {
    const clean = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
    if (!clean) return { ok: false, error: '缺 b64' }
    if (!/^[A-Za-z0-9+/=_-]+$/.test(clean)) return { ok: false, error: 'b64 里有非法字符' }
    if (clean.length > MAX * 4 / 3 + 8) return { ok: false, error: '图片太大（解码后 >8MB）' }
    const buf = Buffer.from(clean, 'base64')
    if (!buf || !buf.length) return { ok: false, error: 'base64 解出来是空的' }
    if (buf.length > MAX) return { ok: false, error: `文件太大（${buf.length} 字节 > 8MB）` }
    const ext = INLINE_FORMATS[String(format || '').toLowerCase()] || 'webp'
    // 魔数校验：防坏 base64 解出一堆垃圾还当图片存下来
    const magics = { webp: [0x52, 0x49, 0x46, 0x46], png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8] }
    const magic = magics[ext]
    if (magic && !magic.every((b, i) => buf[i] === b)) {
      return { ok: false, error: `内容不像 ${ext}（文件头不对）` }
    }
    mkdirSync(outDir, { recursive: true })
    const base = String(name || `inline-${Date.now()}`).replace(/[^\w.-]/g, '_').slice(0, 80) || `inline-${Date.now()}`
    const file = join(outDir, `${base}.${ext}`)
    writeFileSync(file, buf)
    return { ok: true, path: file, bytes: buf.length, ext }
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 160) }
  }
}

async function main() {
  if (!/^https?:\/\//i.test(url)) return out({ ok: false, error: '缺 --url（要 http/https 链接）' })
  try {
    mkdirSync(outDir, { recursive: true })
  } catch (e) {
    return out({ ok: false, error: `建目录失败：${String(e?.message ?? e).slice(0, 120)}` })
  }
  let res
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/', Accept: 'image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    })
  } catch (e) {
    return out({ ok: false, error: `下载失败：${String(e?.message ?? e).slice(0, 160)}` })
  }
  if (!res || res.ok !== true) {
    return out({ ok: false, error: `HTTP ${res ? res.status : '?'}` })
  }
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX) return out({ ok: false, error: `文件太大（${len} 字节 > 8MB）` })
  let buf
  try {
    buf = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    return out({ ok: false, error: `读内容失败：${String(e?.message ?? e).slice(0, 120)}` })
  }
  if (!buf || !buf.length) return out({ ok: false, error: '内容是空的' })
  if (buf.length > MAX) return out({ ok: false, error: `文件太大（${buf.length} 字节 > 8MB）` })
  const mime = String(res.headers.get('content-type') || '')
  const ext = pickExt(mime, url)
  const file = join(outDir, `${safeName}.${ext}`)
  try {
    writeFileSync(file, buf)
  } catch (e) {
    return out({ ok: false, error: `写文件失败：${String(e?.message ?? e).slice(0, 120)}` })
  }
  out({ ok: true, path: file, bytes: buf.length, mime: mime.split(';')[0].trim(), ext })
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href } catch { return false }
})()
if (isMain) main().catch((e) => out({ ok: false, error: String(e?.message ?? e).slice(0, 200) }))
