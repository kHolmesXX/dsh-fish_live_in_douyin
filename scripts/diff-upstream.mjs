#!/usr/bin/env node
/**
 * scripts/diff-upstream.mjs —— 没有 git 的「fork 差异清单」生成器
 * ============================================================================
 * 这台机器没有 git，所以用「本地 vendor 基线」代替 upstream remote：
 *
 *   vendor/upstream-<base>/      上游某个 ref 的**原样快照**（只读，不 ship）
 *   scripts/diff-upstream.mjs    这个脚本：逐文件对比 vendor 与当前插件目录
 *   FISH-PATCHES.md             输出：哪些文件是 fish 新增 / fish 修改 / 与上游相同
 *
 * 用法（在插件根目录，或任意目录都行）：
 *   node scripts/diff-upstream.mjs
 *   node scripts/diff-upstream.mjs --write      # 同时刷新 FISH-PATCHES.md（默认也写）
 *   node scripts/diff-upstream.mjs --no-write   # 只打印，不动文件
 *   node scripts/diff-upstream.mjs --base 0.5.5 # 换基线（vendor/upstream-0.5.5）
 *
 * 判定规则：
 *   · 文本文件先统一 CRLF→LF 再比（避免换行风格造成的假修改）
 *   · 二进制文件按字节比
 *   · 只在当前目录有 = 「fish 新增」；只在 vendor 有 = 「本地缺失」
 *   · 两边都有且内容不同 = 「fish 修改」
 *
 * 排除（不参与对比，也不该进发布包）：
 *   node_modules/ vendor/ dist/ .git/ __pycache__/ .venv/ out/ memory/
 *   chrome-profile/ state/ signer/ toast/ digest/ inbox/ .githooks 里的本地产物
 *   *.pyc *.log *.tmp .DS_Store Thumbs.db desktop.ini
 *   FISH-PATCHES.md（本脚本的产物，避免自己列自己）
 *
 * ⚠️ vendor/ 不进 package.json 的 files，也不该 commit；它只是这台机器上的对比基线。
 * 升级上游时：把新 ref 解到 vendor/upstream-<新版本>，再跑一遍本脚本即可。
 * ============================================================================
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT_FILE = 'FISH-PATCHES.md'

/* ── 参数 ── */
const argv = process.argv.slice(2)
const noWrite = argv.includes('--no-write')
const baseArg = (() => {
  const i = argv.indexOf('--base')
  return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : ''
})()

/* ── 基线版本：package.json 的 fish.base（版本号本身是 0.5.4-fish.N，取 base 更准）── */
function detectBase() {
  if (baseArg) return baseArg
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    if (pkg?.fish?.base) return String(pkg.fish.base)
  } catch { /* 读不到就退回扫 vendor/ */ }
  const vdir = join(ROOT, 'vendor')
  const hits = existsSync(vdir)
    ? readdirSync(vdir).filter((n) => n.startsWith('upstream-')).sort()
    : []
  return hits.length ? hits[hits.length - 1].replace(/^upstream-/, '') : ''
}

const BASE = detectBase()
if (!BASE) {
  console.error('找不到基线：请先放 vendor/upstream-<版本>/，或在 package.json 写 fish.base')
  process.exit(1)
}
const VENDOR = join(ROOT, 'vendor', `upstream-${BASE}`)
if (!existsSync(VENDOR)) {
  console.error(`基线目录不存在：${relative(ROOT, VENDOR)}`)
  process.exit(1)
}

/* ── 基线元数据（vendor/BASELINE.json，由下载时手写/脚本写；没有就退化）── */
const META = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'vendor', 'BASELINE.json'), 'utf8')) || {} } catch { return {} }
})()
const metaFor = (base) => (String(META.base || '') === String(base) ? META : {})

/* ── 排除规则 ── */
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', '.git', '__pycache__', '.venv', 'venv',
  'out', 'memory', 'chrome-profile', 'state', 'signer', 'toast', 'digest', 'inbox',
])
const SKIP_FILES = new Set([
  'FISH-PATCHES.md', '.DS_Store', 'Thumbs.db', 'desktop.ini',
])
const SKIP_RE = /\.(pyc|pyo|log|tmp)$/

/** 只有这些「上游没有、fish 加的」文件在表里标成 fish 新增（其余新增按普通新增显示） */
const FISH_NEW = [
  'lib/relation.mjs',
  'lib/home-console.mjs',
  'tools/frame-grab.mjs',
  'scripts/diff-upstream.mjs',
  /^home\//, // 她的家相关（模板 / 控制台静态资源，若在包内）
]

/** 一对一说明：升级上游时最该知道「这行为什么被改」的文件。 */
const NOTES = {
  'index.js': '宿主半端：她的家/记忆工具/闹钟/值班会话/视觉优先等 25 处插桩（详见正文）',
  'client.js': '设置页：新增「她的家」独立 section（id=douyin-home, order=32）+ 共享登录卡',
  'lib/relation.mjs': 'fish 新增：记忆四件套（按天归档 / 每人档案 / 群印象 / 日记）',
  'lib/home-console.mjs': 'fish 新增：/api/douyin-home/* 控制台后端（快照 + 三处写入）',
  'lib/memory.mjs': '记忆层小改（供关系档案/控制台复用）',
  'lib/chrome.mjs': '新增 openTab()，给截图取证用（统一开/关标签页）',
  'prompts/duty.md': '值班章程：偏好优先 / 只分享不总结 / 视觉优先 / 擦边与点赞分布口径',
  'tools/forward-pick.py': '打分：偏好加权、宠物降权、点赞太热丢弃、点赞分布权重、证据字段',
  'tools/frame-grab.mjs': 'fish 新增：无头 Chrome 截视频首帧（带一次跑一轮的清图）',
  'tools/im-send.mjs': '私信发送：readback 修复（头像左右判定假阴性）',
  'tools/mcp-server.mjs': 'MCP server：跟随 fish 工具/家目录的小改（升级时逐行对照）',
  'tools/panel-render-check.mjs': '面板渲染检查：跟随新增「她的家」section 的小改',
  'RELEASE-0.5.4.md': '上游 main 的 0.5.4 发布说明（tag 之后一个 commit，本地保留）',
  'scripts/diff-upstream.mjs': 'fish 新增（工程脚本）：本差异清单生成器，不进发布包',
  'FISH.md': 'fish 版说明：相对上游改了什么（记忆/人设/家/节奏/控制台/登录复用的边界）',
  'INSTALL.md': 'fish 版安装/验证/打包/排障（三条安装路、数据目录表、常见坑）',
  'selfcheck.mjs': '本地预检：加群聊/值班/私信口径的回归断言',
  'CHANGELOG.md': '本地变更记录（顶部 0.5.4-fish.1 段是本 fork 的对外说明）',
  'package.json': '版本号 0.5.4-fish.1 / files 增补 / dsh.compatibility / fish 字段',
  '.gitignore': '本地新增 vendor/、dist/ 忽略；顺手把上游文件尾部 GBK 注释修正为 UTF-8',
  'pnpm-lock.yaml': '本地 devDependencies 锁文件（上游未入库）',
}
function noteFor(rel, status) {
  if (NOTES[rel]) return NOTES[rel]
  if (status === 'fish-new') {
    if (/^home\//.test(rel)) return 'fish 新增：她的家（数据/模板）'
    return 'fish 新增（本地文件）'
  }
  if (status === 'modified') {
    if (/^\.githooks\//.test(rel)) return '本地 git 钩子（上游 zip 里没有时视为本地文件）'
    return '本地改动（上游升级时需重打）'
  }
  return ''
}

/* ── 遍历 ── */
function walk(dir) {
  const out = new Set()
  const rec = (abs, prefix) => {
    let entries
    try { entries = readdirSync(abs, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        rec(join(abs, e.name), rel)
      } else if (e.isFile()) {
        if (SKIP_FILES.has(e.name) || SKIP_RE.test(e.name)) continue
        out.add(rel)
      }
    }
  }
  rec(dir, '')
  return out
}

function readText(abs) {
  const buf = readFileSync(abs)
  if (buf.includes(0)) return null // 二进制
  return buf.toString('utf8').replace(/\r\n/g, '\n')
}
function linesOf(text) {
  if (text === null) return null
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 0 : 1)
}
function lineDelta(a, b) {
  const la = linesOf(a)
  const lb = linesOf(b)
  if (la === null || lb === null) return { text: '二进制', la, lb }
  const d = lb - la
  return { text: d === 0 ? '0' : (d > 0 ? `+${d}` : `${d}`), la, lb, d }
}

function isFishNew(rel) {
  return FISH_NEW.some((p) => (p instanceof RegExp ? p.test(rel) : p === rel))
}

const localSet = walk(ROOT)
const upSet = walk(VENDOR)
const all = [...new Set([...localSet, ...upSet])].sort((a, b) => a.localeCompare(b, 'en'))

const rows = []
for (const rel of all) {
  const inLocal = localSet.has(rel)
  const inUp = upSet.has(rel)
  const lp = join(ROOT, rel.split('/').join(sep))
  const up = join(VENDOR, rel.split('/').join(sep))
  if (inLocal && !inUp) {
    const lt = readText(lp)
    rows.push({ rel, status: isFishNew(rel) ? 'fish-new' : 'new', delta: lt === null ? '二进制' : `+${linesOf(lt) ?? 0}`, la: linesOf(lt), lb: 0, note: noteFor(rel, isFishNew(rel) ? 'fish-new' : 'new') })
  } else if (!inLocal && inUp) {
    const ut = readText(up)
    rows.push({ rel, status: 'missing', delta: ut === null ? '二进制' : `-${linesOf(ut) ?? 0}`, la: 0, lb: linesOf(ut), note: '本地缺失（上游有）' })
  } else {
    const a = readText(up)
    const b = readText(lp)
    const same = Buffer.compare(readFileSync(up), readFileSync(lp)) === 0 || (a !== null && b !== null && a === b)
    if (same) {
      rows.push({ rel, status: 'same', delta: '0', la: linesOf(a), lb: linesOf(b), note: '' })
    } else {
      const d = lineDelta(a, b)
      rows.push({ rel, status: 'modified', delta: d.text, la: d.la, lb: d.lb, note: noteFor(rel, 'modified') })
    }
  }
}

const groups = {
  fishNew: rows.filter((r) => r.status === 'fish-new'),
  new: rows.filter((r) => r.status === 'new'),
  modified: rows.filter((r) => r.status === 'modified'),
  missing: rows.filter((r) => r.status === 'missing'),
  same: rows.filter((r) => r.status === 'same'),
}
const changed = [...groups.fishNew, ...groups.new, ...groups.modified, ...groups.missing]
  .sort((a, b) => (a.status === b.status ? a.rel.localeCompare(b.rel, 'en') : statusOrder(a.status) - statusOrder(b.status)))

function statusOrder(s) {
  return { 'fish-new': 0, new: 1, modified: 2, missing: 3, same: 4 }[s]
}
function statusLabel(s) {
  return {
    'fish-new': 'fish 新增',
    new: '新增（本地）',
    modified: 'fish 修改',
    missing: '本地缺失',
    same: '相同',
  }[s]
}
function cell(s) { return String(s ?? '').replace(/\|/g, '\\|') }

const now = new Date().toISOString()
const version = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '' } catch { return '' }
})()

const lines = []
lines.push(`# FISH-PATCHES — 本地 fish 版 vs 上游 ${BASE}`)
lines.push('')
lines.push('> 这个文件由 `scripts/diff-upstream.mjs` 生成，**别手改**；改了运行时代码后重新跑一遍即可。')
lines.push(`> 本机没有 git，所以基线用本地只读快照 \`vendor/upstream-${BASE}/\` 代替 upstream remote。`)
lines.push('')
lines.push('| 项 | 值 |')
lines.push('|---|---|')
lines.push(`| 当前插件版本 | \`${version || '?'}\` |`)
lines.push(`| 上游基线 | \`v${BASE}\`（vendor/upstream-${BASE}） |`)
const MB = metaFor(BASE)
lines.push(`| 基线 ref | ${MB.ref ? `\`${MB.ref}\`` : `\`tag v${BASE}\``}${MB.commit ? ` → commit \`${String(MB.commit).slice(0, 8)}\`` : ''}${MB.commit_date ? `（${String(MB.commit_date).slice(0, 10)}）` : ''} |`)
lines.push(`| 基线来源 | ${MB.source ? MB.source : '本地只读快照（没有基线元数据）'}${MB.zip_sha256 ? `（zip SHA256 \`${MB.zip_sha256}\`）` : ''} |`)
lines.push(`| 生成时间 | ${now} |`)
lines.push(`| 统计 | 上游 ${upSet.size} 个文件；相同 ${groups.same.length}；fish 新增 ${groups.fishNew.length}；其他新增 ${groups.new.length}；fish 修改 ${groups.modified.length}；本地缺失 ${groups.missing.length} |`)
lines.push(`| vendor 是否进包 | 否：` + '`vendor/` 不在 package.json 的 `files` 里，也不该 commit |')
lines.push('')
lines.push('## 一、需要关心的差异（fish 新增 + fish 修改 + 本地缺失）')
lines.push('')
lines.push('| 文件 | 状态 | 行数差 | 一句话说明 |')
lines.push('|---|---|---|---|')
for (const r of changed) {
  lines.push(`| \`${r.rel}\` | ${statusLabel(r.status)} | ${cell(r.delta)} | ${cell(r.note || '待补说明')} |`)
}
lines.push('')
lines.push('## 二、与上游一致（升级时不用管，列出来是为了对账）')
lines.push('')
lines.push(`共 ${groups.same.length} 个文件：`)
lines.push('')
if (groups.same.length) {
  lines.push('<details><summary>展开文件清单</summary>')
  lines.push('')
  for (const r of groups.same) lines.push(`- \`${r.rel}\``)
  lines.push('')
  lines.push('</details>')
}
lines.push('')
lines.push('## 三、升级上游时的操作顺序（没有 git 的版本）')
lines.push('')
lines.push(`1. 把新版源码解到 \`vendor/upstream-<新版本>/\`，改 \`package.json\` 的 \`fish.base\`。`)
lines.push('2. 跑 `node scripts/diff-upstream.mjs`，看「需要关心的差异」表。')
lines.push('3. 只处理状态为 fish 修改 / 本地缺失的行：新文件（fish 新增）一般原样保留即可。')
lines.push('4. 跑 `node selfcheck.mjs`，再按需要跑 `node tools/release-smoke.cjs`（如环境有 npm/pnpm）。')
lines.push('5. 重新打包（见 `INSTALL.md` 的打包段），版本号按 `主.次.补丁-fish.N` 抬。')
lines.push('')
lines.push('> ⚠️ 说明边界：`home/`、`memory/`、`douyin_cookie.txt` 这些**运行时数据在 `$DSH_HOME/douyin-duty/`**，')
lines.push('> 不在插件目录里；本表只对比插件源码包。`home/` 目前只存在于运行时家目录，包内没有；')
lines.push('> 以后若把她的家模板放进包内（`home/`），脚本会自动把它标成「fish 新增」。')
lines.push('')

const md = lines.join('\n')

/* ── 打印摘要 ── */
console.log(`基线：vendor/upstream-${BASE}（上游 ${upSet.size} 个文件）`)
console.log(`本地：${localSet.size} 个文件`)
console.log(`相同 ${groups.same.length} / fish 新增 ${groups.fishNew.length} / 其他新增 ${groups.new.length} / fish 修改 ${groups.modified.length} / 本地缺失 ${groups.missing.length}`)
console.log('')
for (const r of changed) {
  console.log(`  ${statusLabel(r.status).padEnd(10)} ${r.delta.padStart(5)}  ${r.rel}${r.note ? `  — ${r.note}` : ''}`)
}

if (!noWrite) {
  writeFileSync(join(ROOT, OUT_FILE), md, 'utf8')
  console.log('')
  console.log(`已写入 ${OUT_FILE}（${md.split('\n').length} 行）`)
}
