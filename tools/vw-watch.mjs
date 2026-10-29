#!/usr/bin/env node
/**
 * tools/vw-watch.mjs —— 「看懂视频」：下载 → 量测 → 采样 → 抽帧 → 图版（2026-10-28 fish.25）
 * ============================================================================
 * 为什么：主人给她分享视频时，她原来只能看标题/评论。要真回答「这视频讲了什么」，
 *   得把视频**落到本地**、用 ffmpeg 量测、抽出帧来让她 `read_image` 看。
 *   量测/采样/图版这一层用 video-watch-plus（`tools/video-watch-plus/vendor/vw.py`，上游 MIT，
 *   已带 Windows 修补），本脚本只负责「拿视频 + 串流程 + 吐一行 JSON」。
 *
 * 用法：
 *   node tools/vw-watch.mjs --aweme <id> [--out <目录>]
 *   node tools/vw-watch.mjs --url <视频直链> [--out <目录>]
 *
 * 流程（严格按 README 的语义，别写反 --out）：
 *   ① 下载 mp4 → `$DOUYIN_HOME/home/videos/<aweme>.mp4`（已存在就跳过；>50MB 拒绝）
 *      直链来源：tools/aweme-detail.mjs（**页面里** fetch 详情，最稳）
 *      → 失败退 cdp-fetch（页面 XHR）→ 再退视频页 `<video>.currentSrc`
 *   ② `python vendor/vw.py probe <mp4> --out <work>`                    ← --out 是**目录**
 *   ③ `python vendor/vw.py plan <work/timeline.json> --out <work/shotlist.json>`  ← 是**文件名**
 *   ④ 按 shotlist 的时间点用 ffmpeg 抽单帧（720 宽，最多 12 张）→ `work/frames/*.png`
 *   ⑤ `python vendor/vw.py sheet <work/shotlist.json> <mp4> --out <work>`  ← 是**目录**
 *      → `work/sheet_XX.png`（整体节奏）+ manifest；图版失败不拖垮整轮（frames 还能看）
 *
 * 输出（stdout 一行 JSON，失败也不抛栈）：
 *   { ok:true, aweme_id, video_path, duration_s, frames:[绝对路径…], sheet_png,
 *     scene_count, note, ... }
 *   { ok:false, error, hint }
 *
 * 超时：probe 120s / plan 30s / sheet 180s / 抽帧 25s/张 / 下载 180s / 取详情 180s。
 * 依赖：ffmpeg 完整构建（7 个滤镜：scdet/freezedetect/silencedetect/tblend/signalstats/tile/drawtext）
 *       + ImageMagick 7；`python vendor/vw.py doctor` 必须显示「必需项就绪」。
 * ============================================================================
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// ⭐ 兜底取直链：详情接口被风控软拒（200 空 body）时，视频页的 <video>.currentSrc 就是 mp4 直链
import { openTab, sleep } from '../lib/chrome.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VW_PY = join(HERE, 'video-watch-plus', 'vendor', 'vw.py')
const ASR_SCRIPTS = join(HERE, 'video-watch-plus', 'scripts')
/** whisper 模型目录（HOME 在后面才定义，所以用函数） */
const asrModelDir = () => join(HOME, 'home', 'models', 'faster-whisper-small')
const DETAIL_SCRIPT = join(HERE, 'aweme-detail.mjs')
const CDP_FETCH = join(HERE, 'cdp-fetch.mjs')

/** ffmpeg/ffprobe：env > setup 的 bin 目录 > BtbN 解压目录 > PATH */
const pickExe = (envKey, names) => {
  const fromEnv = String(process.env[envKey] || '').trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const roots = [
    join(homedir(), '.video-watch', 'tools'),
    join(homedir(), '.video-watch', 'tools', 'ffmpeg-master-latest-win64-gpl', 'bin'),
  ]
  for (const n of names) for (const r of roots) {
    const p = join(r, n)
    if (existsSync(p)) return p
  }
  return ''
}
const FFMPEG = pickExe('VW_FFMPEG', ['ffmpeg.exe', join('bin', 'ffmpeg.exe')]) || 'ffmpeg'
const FFPROBE = pickExe('VW_FFPROBE', ['ffprobe.exe', join('bin', 'ffprobe.exe')])
  || (FFMPEG !== 'ffmpeg' ? join(dirname(FFMPEG), 'ffprobe.exe') : 'ffprobe')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const REFERER = 'https://www.douyin.com/'
const MAX_BYTES = 50 * 1024 * 1024
const MIN_BYTES = 8 * 1024
const FRAME_KEEP = 12
const T = { probe: 120_000, plan: 30_000, sheet: 180_000, download: 180_000, detail: 180_000, frame: 25_000, pyProbe: 15_000 }

const argv = process.argv.slice(2)
const argOf = (k, d = '') => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}

/** 插件家目录（和 lib/paths.mjs / mcp-server.mjs 同一口径） */
const douyinHome = () => {
  const fromEnv = String(process.env.DOUYIN_HOME || '').trim()
  if (fromEnv) return resolve(fromEnv)
  const dshHome = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  return resolve(join(dshHome, 'douyin-duty'))
}

const HOME = douyinHome()
const VIDEOS_DIR = join(HOME, 'home', 'videos')

const out = (o) => { console.log(JSON.stringify(o)); process.exitCode = o.ok ? 0 : 1 }
const fail = (error, hint) => out({ ok: false, error: String(error || '看视频没成').slice(0, 300), hint: String(hint || '').slice(0, 300) })

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readJson = (file) => {
  try { return JSON.parse(stripBom(readFileSync(file, 'utf8'))) } catch { return null }
}
const pickJson = (s) => {
  const t = String(s || '')
  const i = t.indexOf('{'), j = t.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try { return JSON.parse(t.slice(i, j + 1)) } catch { return null }
}

/* ───────────────────────── Python（优先带 Pillow/numpy 的那个） ───────────────────────── */

let _pyCache = ''
/** 找一个能 `import PIL,numpy` 的 python；找不到就退到第一个能跑的（doctor 会报缺什么） */
function resolvePython() {
  if (_pyCache) return _pyCache
  const win = process.platform === 'win32'
  const dshHome = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  const cands = [
    String(process.env.DOUYIN_VW_PYTHON || '').trim(),
    String(process.env.VW_PYTHON || '').trim(),
    'python',
    'python3',
    win ? join(HOME, '.venv', 'Scripts', 'python.exe') : join(HOME, '.venv', 'bin', 'python'),
    win
      ? join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe')
      : join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'bin', 'python3'),
  ].filter(Boolean)
  const probe = (cmd, code) => {
    try {
      const r = spawnSync(cmd, ['-c', code], { encoding: 'utf8', timeout: T.pyProbe, windowsHide: true })
      return r.status === 0
    } catch { return false }
  }
  for (const c of cands) if (probe(c, 'import sys,PIL,numpy;print(sys.version)')) { _pyCache = c; return c }
  for (const c of cands) if (probe(c, 'import sys;print(sys.version)')) { _pyCache = c; return c }
  return ''
}

/** 跑一条 vw.py 子命令（同步；超时/失败都收成结果，不抛） */
function runVw(py, args, timeout, cwd) {
  if (!py) return { ok: false, error: '找不到能用的 python（要 3.8+，建议带 Pillow/numpy）', stdout: '', stderr: '' }
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  if (FFMPEG && existsSync(FFMPEG)) env.VW_FFMPEG = FFMPEG
  if (FFPROBE && existsSync(FFPROBE)) env.VW_FFPROBE = FFPROBE
  const r = spawnSync(py, [VW_PY, ...args], { encoding: 'utf8', timeout, cwd, windowsHide: true, env })
  const msg = String((r.error && (r.error.message || r.error.code)) || '')
  return {
    ok: r.status === 0,
    status: r.status,
    timedOut: /ETIMEDOUT|timed? ?out/i.test(msg),
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || msg || ''),
  }
}

/* ───────────────────────── 详情 → play_addr ───────────────────────── */

function findAweme(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null
  if (Array.isArray(obj)) {
    for (const v of obj) { const hit = findAweme(v, depth + 1); if (hit) return hit }
    return null
  }
  if (obj.aweme_detail && typeof obj.aweme_detail === 'object') return obj.aweme_detail
  if (obj.aweme_id && (obj.desc !== undefined || obj.video)) return obj
  for (const v of Object.values(obj)) { const hit = findAweme(v, depth + 1); if (hit) return hit }
  return null
}

/** 顺着详情把能下的 mp4 直链都收出来（play_addr 优先，download_addr / bit_rate 兜底） */
function playUrlsOf(detail) {
  const urls = []
  const add = (o) => {
    if (!o || typeof o !== 'object') return
    for (const u of (Array.isArray(o.url_list) ? o.url_list : [])) {
      if (typeof u === 'string' && /^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u)
    }
  }
  const v = detail && detail.video
  if (!v) return urls
  add(v.play_addr)
  add(v.play_addr_h264)
  add(v.play_addr_265)
  add(v.download_addr)
  for (const br of (Array.isArray(v.bit_rate) ? v.bit_rate : [])) add(br && br.play_addr)
  return urls
}

/** ① 首选：tools/aweme-detail.mjs（在**页面里** fetch 详情，实测比 cdp-fetch 稳） */
function detailViaPageScript(aweme) {
  if (!existsSync(DETAIL_SCRIPT)) return { detail: null, urls: [], error: '缺少 tools/aweme-detail.mjs' }
  const r = spawnSync(process.execPath, [DETAIL_SCRIPT, '--aweme', aweme], {
    encoding: 'utf8', timeout: T.detail, windowsHide: true,
    env: { ...process.env, DOUYIN_HOME: HOME },
  })
  const j = pickJson(r.stdout)
  if (!j) {
    return {
      detail: null, urls: [],
      error: `详情脚本没返回可解析结果：${String(r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 160)}`,
    }
  }
  if (j.ok !== true) return { detail: null, urls: [], error: String(j.error || '详情没拿到').slice(0, 180) }
  const urls = (Array.isArray(j.play_urls) ? j.play_urls : []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
  if (!urls.length && j.detail) urls.push(...playUrlsOf(j.detail))
  return { detail: j.detail || null, urls, error: urls.length ? '' : '详情里没有 play_addr（视频可能已删除/仅好友可见）' }
}

/** ② 兜底：cdp-fetch（页面 XHR，等 bdms 签名就绪；偶尔 200 空 body） */
function detailViaCdpFetch(aweme) {
  if (!existsSync(CDP_FETCH)) return { detail: null, urls: [], error: '缺少 tools/cdp-fetch.mjs' }
  const path = `/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(aweme)}&aid=6383&device_platform=webapp`
  const r = spawnSync(process.execPath, [CDP_FETCH, '--path', path], {
    encoding: 'utf8', timeout: T.detail, windowsHide: true,
    env: { ...process.env, DOUYIN_HOME: HOME },
  })
  const j = pickJson(r.stdout)
  const detail = j ? findAweme(j) : null
  if (!detail) {
    return {
      detail: null, urls: [],
      error: `详情没拿到（${String(r.stderr || r.stdout || '').trim().slice(0, 160) || '可能没登录 / 页面未就绪'}）`,
    }
  }
  return { detail, urls: playUrlsOf(detail), error: '' }
}

/**
 * ③ 最后兜底：直接开视频页读 `<video>.currentSrc`（实测 readyState 4 时就是 douyinvod 的 mp4 直链）。
 * @returns {Promise<{url:string, duration:number, title:string}|null>}
 */
async function pagePlayUrl(aweme) {
  let tab = null
  try {
    tab = await openTab({ url: `https://www.douyin.com/video/${encodeURIComponent(aweme)}` })
    for (let i = 0; i < 22; i++) {
      await sleep(700)
      let o = null
      try {
        const s = await tab.ev(`(() => {
          const v = document.querySelector('video')
          return JSON.stringify({
            src: v ? (v.currentSrc || v.src || '') : '',
            ready: v ? v.readyState : -1,
            dur: v ? (v.duration || 0) : 0,
            title: document.title || '',
          })
        })()`)
        o = JSON.parse(s || '{}')
      } catch { o = null }
      if (o && /^https?:\/\//i.test(o.src) && Number(o.ready) >= 1) {
        return { url: o.src, duration: Number(o.dur) || 0, title: String(o.title || '') }
      }
    }
    return null
  } catch {
    return null
  } finally {
    try { await tab?.closeTab?.() } catch { /* 关不掉就算了 */ }
    try { tab?.close?.() } catch { /* 已经断了 */ }
  }
}

/** 依次试三条路，返回 {detail, urls, pageDuration, errors} */
async function resolvePlayUrls(aweme) {
  const errors = []
  let detail = null
  let pageDuration = 0
  const first = detailViaPageScript(aweme)
  if (first.urls.length) return { detail: first.detail, urls: first.urls, pageDuration, errors }
  errors.push(first.error)
  const second = detailViaCdpFetch(aweme)
  if (second.urls.length) return { detail: second.detail || first.detail, urls: second.urls, pageDuration, errors }
  errors.push(second.error)
  const page = await pagePlayUrl(aweme)
  if (page && page.url) {
    pageDuration = page.duration || 0
    return { detail: first.detail, urls: [page.url], pageDuration, errors }
  }
  errors.push('页面 <video> 也没拿到直链')
  return { detail: first.detail, urls: [], pageDuration, errors }
}

/** 找能 import faster_whisper 的 python（ASR 用；优先家目录 .venv） */
let _asrPyCache = ''
function resolveAsrPython() {
  if (_asrPyCache) return _asrPyCache
  const win = process.platform === 'win32'
  const cands = [
    String(process.env.DOUYIN_ASR_PYTHON || '').trim(),
    win ? join(HOME, '.venv', 'Scripts', 'python.exe') : join(HOME, '.venv', 'bin', 'python'),
    resolvePython(),
  ].filter(Boolean)
  for (const cmd of cands) {
    try {
      const r = spawnSync(cmd, ['-c', 'import faster_whisper,av,numpy;print(1)'], { encoding: 'utf8', timeout: 20_000, windowsHide: true })
      if (r.status === 0) { _asrPyCache = cmd; return cmd }
    } catch { /* 下一个 */ }
  }
  return ''
}

/** 听声音：audio_probe（快）→ ASR（有本地模型且 ≤180s 才转） */
function listenAudio(videoPath, workDir, duration) {
  const py = resolveAsrPython()
  if (!py) return { ok: false, note: 'ASR 环境没装（faster-whisper）', audio: null, asr: null, transcript: '' }
  const env = { ...process.env, HF_HUB_DISABLE_XET: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  const probeJson = join(workDir, 'audio_probe.json')
  let audio = null
  try {
    const r = spawnSync(py, [join(ASR_SCRIPTS, 'audio_probe.py'), videoPath, '--json', probeJson], { encoding: 'utf8', timeout: 90_000, windowsHide: true, env })
    audio = readJson(probeJson) || null
    if (r.status !== 0 && !audio) return { ok: false, note: 'audio_probe 没成', audio: null, asr: null, transcript: '' }
  } catch (e) { return { ok: false, note: 'audio_probe 失败：' + String(e?.message ?? e).slice(0, 80), audio: null, asr: null, transcript: '' } }
  if (Number(duration) > 180) return { ok: true, note: '视频较长（>180s），没做转写', audio, asr: null, transcript: '' }
  const modelDir = asrModelDir()
  if (!existsSync(modelDir)) return { ok: true, note: '没找到本地 whisper 模型（home/models/faster-whisper-small），跳过转写', audio, asr: null, transcript: '' }
  const asrJson = join(workDir, 'asr.json')
  try {
    const r = spawnSync(py, [join(ASR_SCRIPTS, 'asr_hallucination_check.py'), videoPath, '--model', modelDir, '--lang', 'zh', '--json', asrJson], { encoding: 'utf8', timeout: 300_000, windowsHide: true, env })
    const asr = readJson(asrJson) || null
    if (!asr) return { ok: false, note: 'ASR 没产出 json（' + String(r.stderr || '').trim().split(/\r?\n/).pop().slice(0, 60) + '）', audio, asr: null, transcript: '' }
    const segs = Array.isArray(asr.vad_segments) ? asr.vad_segments : []
    const forced = Array.isArray(asr.forced_segments) ? asr.forced_segments : []
    const verdict = String(asr.verdict || '')
    const halluc = /幻觉|没人声|不可信/.test(verdict)
    const transcript = halluc ? '' : segs.map((s) => String(s.text || '').trim()).filter(Boolean).join(' / ')
    const note = halluc ? '音频没人声/转写不可信' : (transcript ? `转写 ${segs.length} 段` : '有音频但没转出文字')
    return { ok: true, note, audio, asr, transcript, forced_text: halluc ? forced.map((s) => String(s.text || '').trim()).filter(Boolean).join(' / ') : '' }
  } catch (e) { return { ok: false, note: 'ASR 失败：' + String(e?.message ?? e).slice(0, 80), audio, asr: null, transcript: '' } }
}

/* ───────────────────────── 下载 ───────────────────────── */

async function downloadOne(url, dest) {
  const tmp = `${dest}.part`
  let res
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: REFERER,
        Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(T.download),
    })
  } catch (e) {
    return { ok: false, error: `下载失败：${String(e?.message ?? e).slice(0, 140)}` }
  }
  if (!res || res.ok !== true) return { ok: false, error: `下载 HTTP ${res ? res.status : '?'}` }
  const len = Number(res.headers.get('content-length') || 0)
  if (len > MAX_BYTES) return { ok: false, error: `视频太大（${(len / 1048576).toFixed(1)}MB > 50MB），不下了` }
  let buf
  try { buf = Buffer.from(await res.arrayBuffer()) } catch (e) {
    return { ok: false, error: `读视频流失败：${String(e?.message ?? e).slice(0, 140)}` }
  }
  if (!buf || buf.length < MIN_BYTES) return { ok: false, error: '下到的文件太小（可能被风控挡了）' }
  if (buf.length > MAX_BYTES) return { ok: false, error: `视频太大（${(buf.length / 1048576).toFixed(1)}MB > 50MB），不下了` }
  const head = buf.subarray(0, 256).toString('utf8').trim().toLowerCase()
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return { ok: false, error: '下到的是网页（不是视频），链接过期了' }
  try {
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(tmp, buf)
    renameSync(tmp, dest)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    return { ok: false, error: `写文件失败：${String(e?.message ?? e).slice(0, 140)}` }
  }
  return { ok: true, bytes: buf.length }
}

/**
 * 确保本地有这条视频：在就跳过；不在就取 play_addr 下下来。
 * @returns {Promise<{ok:boolean, path?:string, bytes?:number, reused?:boolean, detail?:object, error?:string}>}
 */
async function ensureVideo({ aweme, url }) {
  const name = aweme || `url-${createHash('sha1').update(String(url)).digest('hex').slice(0, 12)}`
  const dest = join(VIDEOS_DIR, `${name}.mp4`)
  if (existsSync(dest)) {
    try {
      const sz = statSync(dest).size
      if (sz >= MIN_BYTES) return { ok: true, path: dest, bytes: sz, reused: true }
      rmSync(dest, { force: true })   // 半截文件，重下
    } catch { /* 读不到就当没有 */ }
  }
  let detail = null
  let candidates = []
  if (url && /^https?:\/\//i.test(url)) candidates = [url]
  else if (aweme) {
    const r = await resolvePlayUrls(aweme)
    detail = r.detail
    candidates = r.urls
    if (!candidates.length) return { ok: false, error: r.errors.filter(Boolean).slice(0, 2).join('；') || '没拿到 play_addr' }
  } else return { ok: false, error: '缺 --aweme 或 --url' }

  const errors = []
  for (const u of candidates.slice(0, 4)) {
    const r = await downloadOne(u, dest)
    if (r.ok) return { ok: true, path: dest, bytes: r.bytes, reused: false, detail }
    errors.push(r.error)
  }
  return { ok: false, error: errors[0] || '下载失败了', detail }
}

/* ───────────────────────── 抽帧 / 工具 ───────────────────────── */

/** 从一堆时间点里等间隔挑最多 n 个（首尾都在） */
function sampleTimes(list, n) {
  const arr = (Array.isArray(list) ? list : []).filter((t) => Number.isFinite(Number(t)) && Number(t) >= 0).map(Number)
  if (arr.length <= n) return arr
  const picked = []
  const step = (arr.length - 1) / (n - 1)
  for (let i = 0; i < n; i++) {
    const t = arr[Math.round(i * step)]
    if (t !== undefined && !picked.includes(t)) picked.push(t)
  }
  return picked
}

/** 按时间点逐个用 ffmpeg 抽帧（720 宽，PNG） */
function extractFrames(videoPath, times, frameDir) {
  try { mkdirSync(frameDir, { recursive: true }) } catch { /* ignore */ }
  const frames = []
  const errors = []
  for (let i = 0; i < times.length; i++) {
    const tv = Number(times[i]) || 0
    const outPng = join(frameDir, `f-${String(i + 1).padStart(2, '0')}-${tv.toFixed(2)}s.png`)
    const r = spawnSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', String(tv), '-i', videoPath,
      '-frames:v', '1', '-vf', 'scale=720:-2', '-y', outPng,
    ], { encoding: 'utf8', timeout: T.frame, windowsHide: true })
    if (r.status === 0 && existsSync(outPng)) frames.push(outPng)
    else errors.push(`t=${tv}:${String(r.stderr || (r.error && r.error.message) || '').trim().split(/\r?\n/).pop().slice(0, 80)}`)
  }
  return { frames, errors }
}

/* ───────────────────────── 主流程 ───────────────────────── */

async function main() {
  const awemeArg = String(argOf('aweme', '')).trim()
  const urlArg = String(argOf('url', '')).trim()
  const aweme = /^\d{6,25}$/.test(awemeArg) ? awemeArg : ''
  const outDirArg = String(argOf('out', '')).trim()
  if (!aweme && !/^https?:\/\//i.test(urlArg)) {
    return fail('缺 --aweme <视频id> 或 --url <视频直链>', '例：node tools/vw-watch.mjs --aweme 7700956350092370536')
  }
  if (!existsSync(VW_PY)) return fail(`缺少 ${VW_PY}`, '把 video-watch-plus 整包复制到 tools/video-watch-plus/')
  const py = resolvePython()
  if (!py) return fail('找不到能用的 python', '装 Python 3.8+（建议带 Pillow/numpy），或用 DOUYIN_VW_PYTHON 指定解释器')

  const dl = await ensureVideo({ aweme, url: urlArg })
  if (!dl.ok) {
    return fail(dl.error, '确认已登录抖音 / 无头 Chrome 可用；必要时换个视频，或先手动把 mp4 放到 home/videos/ 再跑')
  }
  const videoPath = dl.path
  const name = aweme || `url-${createHash('sha1').update(urlArg).digest('hex').slice(0, 12)}`
  const workDir = resolve(outDirArg || join(HOME, 'home', 'watch', name))
  try { mkdirSync(workDir, { recursive: true }) } catch (e) {
    return fail(`建输出目录失败：${String(e?.message ?? e).slice(0, 120)}`, '换一个 --out 目录')
  }

  // ② probe（--out 是目录）
  const probe = runVw(py, ['probe', videoPath, '--out', workDir], T.probe, workDir)
  const timelineFile = join(workDir, 'timeline.json')
  if (!probe.ok || !existsSync(timelineFile)) {
    const tail = String(probe.stderr || probe.stdout || '').trim().split(/\r?\n/).slice(-3).join(' | ')
    return fail(
      probe.timedOut ? 'probe 超时（120s）' : `probe 没成：${tail || '没有 timeline.json'}`,
      '先跑 python vendor/vw.py doctor，确认 ffmpeg/ffprobe 可用（必需项就绪）',
    )
  }
  const timeline = readJson(timelineFile) || {}
  const duration = Number(timeline.duration) || Number(timeline.info && timeline.info.duration) || 0
  const cuts = Array.isArray(timeline.cuts) ? timeline.cuts : []
  const freezes = Array.isArray(timeline.freezes) ? timeline.freezes : []

  // ③ plan（--out 是**文件名**，写错会 PermissionError）
  const shotlistFile = join(workDir, 'shotlist.json')
  const plan = runVw(py, ['plan', timelineFile, '--out', shotlistFile], T.plan, workDir)
  if (!plan.ok || !existsSync(shotlistFile)) {
    const tail = String(plan.stderr || plan.stdout || '').trim().split(/\r?\n/).slice(-3).join(' | ')
    return fail(plan.timedOut ? 'plan 超时（30s）' : `plan 没成：${tail || '没有 shotlist.json'}`, 'timeline.json 可能不完整，重跑一次 probe')
  }
  const shotlist = readJson(shotlistFile) || {}
  const shots = Array.isArray(shotlist.shots) ? shotlist.shots : []
  const shotTimes = shots.map((s) => Number(s && s.t)).filter((t) => Number.isFinite(t) && t >= 0)
  const pickedTimes = sampleTimes(shotTimes, FRAME_KEEP)

  // ④ 抽帧（720 宽；每张一个 png，给模型 read_image 看）
  const frameDir = join(workDir, 'frames')
  const ex = extractFrames(videoPath, pickedTimes.length ? pickedTimes : [Math.max(0.1, Math.min(1, duration * 0.5))], frameDir)
  const frames = ex.frames
  if (!frames.length) {
    return fail(`抽帧失败（${ex.errors[0] || '没有 PNG 产出'}）`, `确认 ffmpeg 可用：${FFMPEG}`)
  }

  // ⑤ 图版（ImageMagick；失败只记下来，不拖垮整轮 —— frames 已经够看）
  const sheet = runVw(py, ['sheet', shotlistFile, videoPath, '--out', workDir], T.sheet, workDir)
  const manifest = readJson(join(workDir, 'manifest.json')) || null
  const sheetPngs = []
  for (const sh of (Array.isArray(manifest && manifest.sheets) ? manifest.sheets : [])) {
    const sp = String((sh && sh.sheet) || '')
    if (sp && existsSync(sp) && !sheetPngs.includes(sp)) sheetPngs.push(sp)
  }
  const sheetNote = sheetPngs.length ? `${sheetPngs.length} 张图版` : `图版没成${sheet.ok ? '' : '（ImageMagick）'}`

  // ⑥ 听声音（audio_probe + ASR；失败不影响看图）
  const hear = listenAudio(videoPath, workDir, duration || Number(shotlist.duration) || 0)

  const detail = dl.detail || null
  const dur = Math.round((duration || Number(shotlist.duration) || 0) * 10) / 10
  const note = [
    `时长 ${dur}s`,
    `采样 ${shotTimes.length} 帧`,
    `给看 ${frames.length} 张`,
    sheetNote,
    `切点 ${cuts.length} 个`,
    hear.note ? `音频：${hear.note}` : '',
    freezes.length ? `冻结 ${freezes.length} 段` : '',
    dl.reused ? '本地已有没重下' : `下载 ${(Number(dl.bytes) / 1048576).toFixed(1)}MB`,
    detail && detail.desc ? `文案「${String(detail.desc).split(/\r?\n/)[0].slice(0, 24)}」` : '',
  ].filter(Boolean).join(' / ')

  return out({
    ok: true,
    aweme_id: aweme || name,
    video_path: videoPath,
    duration_s: dur,
    frames,
    sheet_png: sheetPngs[0] || '',
    sheet_pngs: sheetPngs,
    scene_count: cuts.length + 1,
    frame_total: frames.length,
    shot_count: shots.length,
    bytes: Number(dl.bytes) || 0,
    reused: dl.reused === true,
    desc: detail ? String(detail.desc || '').slice(0, 200) : '',
    author: detail ? String((detail.author && detail.author.nickname) || '') : '',
    work_dir: workDir,
    transcript: hear.transcript || '',
    audio_verdict: (hear.audio && hear.audio.verdict && hear.audio.verdict.kind) || '',
    asr_verdict: (hear.asr && hear.asr.verdict) || '',
    asr_ok: hear.ok === true,
    note,
  })
}

main().catch((e) => fail(String(e?.message ?? e), '这个错误不该出现；把参数和 stderr 发给我'))
