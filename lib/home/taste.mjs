/**
 * lib/home/taste.mjs —— 她的口味清单（2026-10-28 fish.21）
 * ============================================================================
 * 清单由主人写：`$DOUYIN_HOME/home/taste.md`（她会点赞的 10 类 + 跟主人一起喜欢的
 * + 绝不点赞的 + 每轮/每天上限）。**这个模块只读、不改内容**，只负责注入一轮提示词。
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const TASTE_FILE = 'taste.md'
export const TASTE_MAX_CHARS = 4000

export const tasteFile = (homeDir) => join(String(homeDir || ''), TASTE_FILE)

/** 读全文（读不到返回 ''，不抛） */
export function readTaste(homeDir) {
  try {
    const t = String(readFileSync(tasteFile(homeDir), 'utf8') || '')
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
  } catch { return '' }
}

/**
 * 注入提示词用：全文（默认截前 1200 字），带一句"这份清单是给她的口味"。
 * 文件不存在 ⇒ ''（调用方自己说"没找到"）。
 * @returns {string}
 */
export function renderTaste(homeDir, maxChars = TASTE_MAX_CHARS) {
  const text = readTaste(homeDir).trim()
  if (!text) return ''
  const max = Math.max(200, Math.trunc(Number(maxChars) || TASTE_MAX_CHARS))
  const body = text.length > max ? `${text.slice(0, max)}\n…（完整清单在 home/taste.md，主人可能随时改）` : text
  return `⭐ **她自己的口味清单（home/taste.md，点赞判据；主人可能会改）**：\n${body}`
}
