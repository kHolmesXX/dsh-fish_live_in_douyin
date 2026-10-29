#!/usr/bin/env node
/**
 * tools/comment-mention-ui.mjs —— 用**真实 UI 流程**在评论区 @ 人（唯一能保住 sec_uid 的路）
 * ============================================================================
 * 2026-10-21 实验定论：API/XHR 直发的 mention，服务端会把 sec_uid 剥掉 ⇒ 名字会蓝、
 * 但点开是空页、对方收不到通知。只有前端「点选 @ 弹层里的那一行」时，编辑器内存里有
 * 完整用户对象，服务端才信这个来源、保住 sec_uid。
 *
 * 已跑通的流程（2026-10-21 实测，使用者收到通知）：
 *   ① 视频页 → #comment-input-container 滚进视口中心 → 真实鼠标点开
 *   ② 点 .public-DraftEditor-content 聚焦
 *   ③ CDP 键盘事件打「@」（execCommand 不触发弹层）
 *   ④ 等弹层，按昵称找到叶子节点（最窄那个）→ 真实鼠标点选
 *   ⑤ execCommand 补正文
 *   ⑥ 点输入容器右下角的红色箭头 svg（fill=FE2C55）发布
 *
 * 用法:
 *   node tools/comment-mention-ui.mjs --aweme <id> --name <昵称> --text "正文" [--dry]
 *
 * --dry：点选完人 + 补完正文就停，不发布；会 dump 弹层行数据和编辑器 HTML。
 */
import { openPage, sleep } from '../lib/chrome.mjs'

const argv = process.argv.slice(2)
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? (argv[i + 1] ?? '') : d }
const DRY = argv.includes('--dry')
const AWEME = String(argOf('--aweme', '')).trim()
const NAME = String(argOf('--name', '')).trim()
const TEXT = String(argOf('--text', '')).trim()
/**
 * ⭐ `--reply-cid <cid>`：回复**某一条**评论（而不是发顶层）。
 *    2026-10-22 加 —— 用户要"回评论区 @ 我的人"，那本质是"回复某条评论 + @ 他"。
 *    实现：先把那条评论滚进视口 → 点它下面的「回复」→ 再走原来的 @ 点选流程。
 *    点了「回复」之后，评论输入框的语义就是"回复那条"，前端会自动带上 reply 关系。
 */
const REPLY_CID = String(argOf('--reply-cid', '')).trim()
/**
 * ⭐ `--reply-text <片段>`：按**评论正文片段**定位要回复的那条（比 cid 稳）。
 *    🔴 2026-10-23 实测：cid 只活在 React fiber 的深层 props 里，抖音改版后
 *    遍历 fiber 找不到（还会撞循环引用）⇒ 干脆用**页面上看得见的文字**定位，
 *    这才是人找评论的方式。取第一条包含该片段的评论节点。
 */
const REPLY_TEXT = String(argOf('--reply-text', '')).trim()

const out = (o) => { console.log(JSON.stringify(o, null, 1)); process.exitCode = o.ok === false ? 1 : 0 }

/**
 * ⭐ fish.19：发布判定（纯函数，浏览器流程和 --selftest 用**同一份**）：
 *   cleared=false（编辑器没清空/报错）⇒ 'failed'（重试一次仍 false ⇒ failed）
 *   cleared=true 且评论区 DOM 找到正文前 12 字 ⇒ 'verified'
 *   cleared=true 但 DOM 没找到 ⇒ 'submitted_unverified'（可能审核中，别当已发）
 */
const judgePublishOutcome = ({ cleared, found }) => (!cleared ? 'failed' : (found ? 'verified' : 'submitted_unverified'))
/** 只有「没清空」才重试，且最多重试 1 次 */
const shouldRetryPublish = ({ tries, cleared }) => tries < 1 && !cleared

if (argv.includes('--selftest')) {
  let bad = 0
  const assert = (label, cond) => { if (!cond) { bad += 1; console.error('FAIL ' + label) } }
  assert('cleared+found ⇒ verified', judgePublishOutcome({ cleared: true, found: true }) === 'verified')
  assert('cleared+notfound ⇒ submitted_unverified', judgePublishOutcome({ cleared: true, found: false }) === 'submitted_unverified')
  assert('not cleared ⇒ failed', judgePublishOutcome({ cleared: false, found: false }) === 'failed')
  assert('第一次没清空才重试', shouldRetryPublish({ tries: 0, cleared: false }) === true)
  assert('只重试一次', shouldRetryPublish({ tries: 1, cleared: false }) === false)
  assert('清空了不重试', shouldRetryPublish({ tries: 0, cleared: true }) === false)
  out({ ok: bad === 0, selftest: true, bad })
  process.exit(bad === 0 ? 0 : 1)
}

if (!AWEME || !NAME) { out({ ok: false, error: '用法: comment-mention-ui.mjs --aweme <id> --name <昵称> [--text 正文] [--reply-cid <cid> | --reply-text <片段>] [--dry]' }); process.exit(1) }

try {
  const c = await openPage()
  const chromed = c.status

  const mv = (x, y) => c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  const click = async (x, y) => {
    await mv(x, y); await sleep(150)
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }

  /**
   * ⭐ fish.26：图文（note）页专用流程 —— 2026-10-28 实测定稿。
   *   /video/<id> 会被自动重定向到 /note/<id>，图文页和视频页 DOM 不一样：
   *   · 评论入口是右侧 `[data-e2e="feed-comment-icon"]`；点开后出现**可见的** `.comment-input-container`
   *     （`#comment-input-container` 是 display:none 的旧抽屉，不能用）
   *   · 发送键是可见输入容器**右端的红色圆形 ↑**（x=right-28, y=top+height/2）
   *   · 点完 @token 后，直接 insertText 正文可能插不进去（发出去只有「@昵称 昵称」）⇒ 必须重新聚焦再插，
   *     并**读编辑器 innerText 自检**（含正文前 8 字 + 长度够），不通过就重试一次，仍失败就 abort（绝不发残缺评论）。
   */
  async function runNoteFlow() {
    const pageKind = 'note'
    const stripped = (() => {
      let b = String(TEXT || '')
      const lead = '@' + NAME
      if (b.startsWith(lead)) b = b.slice(lead.length).replace(/^[\s\u3000]+/, '')
      return b.trim()
    })()
    const bodyNorm = stripped.replace(/\s+/g, '')
    const needle8 = bodyNorm.slice(0, 8)
    const fail = (error, extra) => ({ ok: false, page_kind: pageKind, error, ...(extra || {}) })

    const clickCommentIcon = async () => {
      const pos = JSON.parse(await c.ev(`(function(){
        var e = document.querySelector('[data-e2e="feed-comment-icon"]');
        if (!e) return '{}';
        e.scrollIntoView({block:'center'});
        var r = e.getBoundingClientRect();
        if (!(r.width > 8)) return '{}';
        return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
      })()`))
      if (!pos.x) return false
      await click(pos.x, pos.y)
      await sleep(3000)
      return true
    }
    const getInputBox = async () => JSON.parse(await c.ev(`(function(){
      var cs = Array.prototype.slice.call(document.querySelectorAll('.comment-input-container'));
      for (var i=0;i<cs.length;i++){
        var r = cs[i].getBoundingClientRect();
        if (r.width > 50 && r.height > 8) return JSON.stringify({
          x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2),
          left:Math.round(r.x), right:Math.round(r.right), top:Math.round(r.top),
          w:Math.round(r.width), h:Math.round(r.height)
        });
      }
      return '{}';
    })()`))
    const getEditorBox = async () => JSON.parse(await c.ev(`(function(){
      var e = document.querySelector('.public-DraftEditor-content');
      if (!e) return '{}';
      var r = e.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
    })()`))
    const readEditor = async () => String(await c.ev(`(function(){
      var e = document.querySelector('.public-DraftEditor-content');
      return e ? String(e.innerText || '') : '';
    })()`))
    const editorHtml = async () => String(await c.ev(`(function(){
      var e = document.querySelector('.public-DraftEditor-content');
      return e ? String(e.innerHTML || '').slice(0, 900) : '';
    })()`))

    if (!bodyNorm) return fail('正文是空的（note 页）')

    // ① 点右侧评论图标 → 等评论面板展开
    if (!(await clickCommentIcon())) return fail('note 页找不到评论图标（[data-e2e="feed-comment-icon"]）')

    // ② 找可见的 .comment-input-container → 点开 → 等 DraftJS 可编辑
    let box = await getInputBox()
    if (!box.x) {
      // 有时要等面板动画完
      await sleep(2000)
      box = await getInputBox()
    }
    if (!box.x) return fail('note 页找不到可见的评论输入框（.comment-input-container 宽>50）')
    let editorReady = false
    for (let i = 0; i < 8 && !editorReady; i++) {
      await click(box.x, box.y)
      await sleep(900)
      editorReady = Boolean(await c.ev(`(function(){ return !!document.querySelector('.public-DraftEditor-content[contenteditable="true"]') })()`))
      if (editorReady) break
      box = await getInputBox()
      if (!box.x) { await clickCommentIcon(); box = await getInputBox() }
    }
    if (!editorReady) return fail('note 页评论编辑器没激活（DraftJS contenteditable=false）')

    // ③ 点编辑器聚焦 → 打 @ → 等 3 秒（弹层出现）
    let eb = await getEditorBox()
    if (!eb.x) return fail('note 页编辑器没坐标')
    await click(eb.x, eb.y)
    await sleep(400)
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '@', key: '@', code: 'Digit2', windowsVirtualKeyCode: 50, nativeVirtualKeyCode: 50 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '@', code: 'Digit2', windowsVirtualKeyCode: 50, nativeVirtualKeyCode: 50 })
    await sleep(3000)

    // ④ 直接在弹层默认列表里找昵称叶子节点（**不要** Input.insertText(NAME) 过滤 —— 会把弹层关掉）
    const row = JSON.parse(await c.ev(`(function(){
      var NAME = ${JSON.stringify(NAME)};
      var rows = [];
      document.querySelectorAll('div,span,li,p').forEach(function(e){
        if (e.children.length) return;
        if (String(e.innerText || '').trim() !== NAME) return;
        var r = e.getBoundingClientRect();
        if (!(r.width > 4 && r.height > 8)) return;
        rows.push({ x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:Math.round(r.width), x0:Math.round(r.x) });
      });
      rows.sort(function(a,b){ return a.w - b.w });
      var right = rows.filter(function(r){ return r.x0 > 900 });
      if (right.length) rows = right;
      return JSON.stringify(rows[0] || {});
    })()`))
    if (!row.x) return fail(`@ 弹层里没找到「${NAME}」（图文页默认列表里应该有；不要用输入过滤）`)
    await click(row.x, row.y)
    await sleep(1200)

    // ⑤ 重新聚焦编辑器 + insertText 正文 + **自检**（含前 8 字、长度够）；失败重试一次，仍失败 abort
    let inserted = false
    let editorText = ''
    for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
      eb = await getEditorBox()
      if (eb.x) await click(eb.x, eb.y)
      await sleep(350)
      try {
        await c.ev(`(function(){
          var e = document.querySelector('.public-DraftEditor-content');
          if (!e) return false;
          e.focus();
          try {
            var sel = window.getSelection(); sel.removeAllRanges();
            var range = document.createRange(); range.selectNodeContents(e); range.collapse(false);
            sel.addRange(range);
          } catch (x) {}
          return true;
        })()`)
      } catch { /* 聚焦失败就靠 click */ }
      await c.send('Input.insertText', { text: '  ' + stripped })
      await sleep(600)
      editorText = String(await readEditor()).replace(/\s+/g, '')
      inserted = Boolean(needle8 && editorText.includes(needle8) && editorText.length >= Math.max(1, bodyNorm.length - 2))
      if (!inserted) await sleep(700)
    }
    if (!inserted) {
      return fail('正文没插进去（note 页）', { code: 'body_not_inserted', needle: needle8, editor_text: String(await readEditor()).slice(0, 200), editor_html: await editorHtml() })
    }

    const editorAfterInsert = await readEditor()
    const htmlAfterInsert = await editorHtml()
    if (DRY) {
      return { ok: true, dry: true, page_kind: pageKind, popup_row: row, editor_text: editorAfterInsert, editor_html: htmlAfterInsert, chrome: chromed }
    }

    // ⑥ 发送键：可见输入容器**右端的红色圆形 ↑**（DOM 里找 fill=FE2C55 的 svg 最稳；
    //    实测输入框展开后容器高度会变，用「container.right-28 / top+h/2」会点偏）
    let cleared = false
    for (let attempt = 0; attempt < 2 && !cleared; attempt++) {
      const sendPos = JSON.parse(await c.ev(`(function(){
        var cs = Array.prototype.slice.call(document.querySelectorAll('.comment-input-container'));
        var el = null;
        for (var i=0;i<cs.length;i++){ var r=cs[i].getBoundingClientRect(); if (r.width>50 && r.height>8) { el = cs[i]; break } }
        if (!el) return '{}';
        var svgs = el.querySelectorAll('svg');
        for (var j=0;j<svgs.length;j++){
          if (String(svgs[j].innerHTML||'').indexOf('FE2C55') < 0) continue;
          var r2 = svgs[j].getBoundingClientRect();
          if (r2.width < 10) continue;
          return JSON.stringify({x:Math.round(r2.x+r2.width/2),y:Math.round(r2.y+r2.height/2),via:'svg'});
        }
        // 兜底：容器右端（收起态 rect 才准；展开态可能点偏，只当最后手段）
        var cr = el.getBoundingClientRect();
        return JSON.stringify({x:Math.round(cr.right-28),y:Math.round(cr.y+cr.height/2),via:'formula'});
      })()`))
      if (!sendPos.x) return fail('note 页找不到发送按钮', { published: false })
      await click(sendPos.x, sendPos.y)
      await sleep(3000)
      const t = String(await readEditor()).replace(/\s+/g, '')
      cleared = !needle8 || !t.includes(needle8)
    }
    const editorAfter = await readEditor()
    if (!cleared) {
      return fail('发送后编辑器没清空（note 页）', { published: false, page_kind: pageKind, editor_after: editorAfter.slice(0, 200), editor_html: htmlAfterInsert })
    }

    // ⑦ 刷新核实：最新评论在最上面（[class*="comment-mainContent"]）
    let newest = ''
    let found = false
    try {
      await c.send('Page.navigate', { url: `https://www.douyin.com/note/${AWEME}` })
      await sleep(10000)
      await clickCommentIcon()
      await sleep(1500)
      newest = String(await c.ev(`(function(){
        var e = document.querySelector('[class*="comment-mainContent"]');
        return e ? String(e.innerText || '').replace(/\\s+/g, ' ').slice(0, 500) : '';
      })()`))
      found = Boolean(needle8 && newest.includes(needle8))
    } catch { found = false }
    return {
      ok: true, page_kind: pageKind,
      published: found ? 'verified' : 'submitted_unverified',
      verified: found,
      needle: needle8,
      editor_after: editorAfter.slice(0, 120),
      editor_text: editorAfterInsert,
      newest_comment: newest,
      popup_row: row,
      chrome: chromed,
    }
  }

  await c.send('Page.navigate', { url: `https://www.douyin.com/video/${AWEME}` })
  await sleep(5000)
  let notePage = false
  try { notePage = String(await c.ev('location.href')).includes('/note/') } catch { notePage = false }
  if (notePage) {
    // ⭐ fish.26：图文页走独立 note 流程（视频页逻辑完全不动）
    await sleep(7000)   // 等 12s（5+7）让图文页和评论面板脚本就绪
    const noteRes = await runNoteFlow()
    try { c.close() } catch { /* ignore */ }
    await sleep(200)
    out(noteRes)
    throw { __done: true }
  }

  /**
   * ⭐ fish.19：不再固定 sleep 8 秒 —— 实测这个 Chrome 里页面加载后约 10 秒会被 SPA 拉回 /chat，
   *   8 秒时偶尔已经在回跳路上（于是报「找不到 #comment-input-container」）。
   *   ⇒ 最多等 ~20 秒，轮询「URL 是这条视频 + 评论区输入容器在」，被拉回就再导航一次。
   */
  let pageReady = false
  for (let i = 0; i < 13 && !pageReady; i++) {
    await sleep(1500)
    try {
      pageReady = await c.ev(`(function(){
        var h = location.href || '';
        // ⭐ fish.25：/video/<id> 会被自动重定向到 /note/<id>（图文页），两种都算正常
        var okUrl = h.indexOf('/video/${AWEME}') >= 0 || h.indexOf('/note/${AWEME}') >= 0;
        if (!okUrl) return false;
        var hasShare = !!document.querySelector('[data-e2e="video-share-icon-container"],[data-e2e="video-player-share"]');
        var hasInput = !!document.getElementById('comment-input-container')
          || !!document.querySelector('.public-DraftEditor-content,[contenteditable="true"]');
        return hasShare || hasInput;
      })()`)
    } catch { pageReady = false }
    if (!pageReady && i > 0 && i % 3 === 0) {
      try { await c.send('Page.navigate', { url: `https://www.douyin.com/video/${AWEME}` }) } catch { /* 导航被打断，下一拍重试 */ }
    }
  }
  if (!pageReady) await sleep(2500)   // 最后再给一点时间（后面还有明确的容器检查会报错）

  /**
   * ⭐ 如果要"回复某条评论"：先把那条评论滚进视口，点它下面的「回复」。
   *    点了之后输入框的语义就变成"回复这条"，前端会自己带 reply 关系。
   *    ⚠️ 找不到就**中止**，别默默改成发顶层（用户要的是回复）。
   */
  let replyInfo = null
  if (REPLY_CID || REPLY_TEXT) {
    // 先把评论区滚出来
    try {
      await c.ev(`(function(){
        var el = document.querySelector('#comment-input-container');
        if (el) el.scrollIntoView({block:'center'});
      })()`)
      await sleep(1500)
    } catch { /* 滚不动就继续 */ }

    /**
     * ⭐⭐ 按**正文片段**找目标评论（2026-10-23 加，首选路径）。
     *    人找评论就是这么找的：页面上有那行字 → 滚到它 → 点它下面的「回复」。
     *    不碰 React fiber，所以不会撞循环引用、也不怕抖音改 fiber 结构。
     */
    if (REPLY_TEXT) {
      let hit = ''
      for (let i = 0; i < 12 && !hit; i++) {
        hit = String(await c.ev(`(function(){
          var NEEDLE = ${JSON.stringify(REPLY_TEXT)};
          var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-e2e="comment-item"], [class*="commentItem"], [class*="comment-item"]'));
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var t = (n.innerText || '');
            if (t.indexOf(NEEDLE) < 0) continue;
            n.scrollIntoView({ block: 'center' });
            var r = n.getBoundingClientRect();
            return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
          }
          return '';
        })()`))
        if (!hit) {
          await c.ev(`(function(){ var l=document.querySelector('[class*="commentList"], [class*="comment-list"]'); if(l){ l.scrollTop += 900 } else { window.scrollBy(0,900) } })()`)
          await sleep(1400)
        }
      }
      if (!hit) {
        c.close()
        out({ ok: false, error: `评论区里找不到含「${REPLY_TEXT}」的那条评论（滚了 12 屏）`, code: 'reply_target_not_found' })
        process.exit(1)
      }
      // 找到节点后，在它里面点「回复」
      const rb0 = String(await c.ev(`(function(){
        var NEEDLE = ${JSON.stringify(REPLY_TEXT)};
        var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-e2e="comment-item"], [class*="commentItem"], [class*="comment-item"]'));
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if ((n.innerText || '').indexOf(NEEDLE) < 0) continue;
          var cands = Array.prototype.slice.call(n.querySelectorAll('span,div,button,a'));
          for (var j = 0; j < cands.length; j++) {
            var e = cands[j];
            if (e.children.length) continue;
            if ((e.innerText || '').trim() !== '回复') continue;
            var r = e.getBoundingClientRect();
            if (!(r.width > 4 && r.height > 8)) continue;
            return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
          }
        }
        return '';
      })()`))
      if (rb0) {
        const rb = JSON.parse(rb0)
        await click(rb.x, rb.y)
        await sleep(1800)
        replyInfo = { reply_by_text: REPLY_TEXT, reply_button: rb }
      } else {
        c.close()
        out({ ok: false, error: `找到「${REPLY_TEXT}」那条评论了，但没找到它下面的「回复」按钮`, code: 'reply_button_not_found' })
        process.exit(1)
      }
    }

    let found = ''
    for (let i = 0; i < 10 && !found; i++) {
      found = String(await c.ev(`(function(){
        var CID = ${JSON.stringify(REPLY_CID)};
        // 评论节点通常带 data-e2e="comment-item" 或 cid 在 fiber 里
        var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-e2e="comment-item"], [class*="commentItem"], [class*="comment-item"]'));
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var fk = Object.keys(n).find(function(k){ return k.indexOf('__reactFiber$') === 0 });
          var hit = false;
          if (fk) {
            var f = n[fk], d = 0;
            while (f && d < 16) {
              var p = f.memoizedProps;
              if (p && typeof p === 'object') {
                /**
                 * 🔴 2026-10-23 实测 bug：直接 JSON.stringify(memoizedProps) 会**抛异常** ——
                 *    React fiber 的 props 有循环引用（children 指回 fiber），
                 *    stringify 抛 "Converting circular structure to JSON"，
                 *    整段 evaluate Uncaught ⇒ 找 reply-cid 永远失败（工具只报"页面里抛错"）。
                 * ✅ 改成：只扫**浅层字段**的字符串/数字值（cid 就在这一层），整段 try/catch。
                 */
                try {
                  for (var k in p) {
                    var v = p[k];
                    if (typeof v === 'string' && v.indexOf(CID) >= 0) { hit = true; break }
                    if (typeof v === 'number' && String(v).indexOf(CID) >= 0) { hit = true; break }
                    if (v && typeof v === 'object' && !v.children) {
                      for (var k2 in v) {
                        var v2 = v[k2];
                        if (typeof v2 === 'string' && v2.indexOf(CID) >= 0) { hit = true; break }
                        if (typeof v2 === 'number' && String(v2).indexOf(CID) >= 0) { hit = true; break }
                      }
                      if (hit) break;
                    }
                  }
                } catch (e) { /* 这一层读不动就跳过 */ }
                if (hit) break;
              }
              f = f.return; d++;
            }
          }
          // 兜底：节点自身或父级文本里带 cid（少见，但有些版本会渲染到属性）
          if (!hit && (n.getAttribute && String(n.getAttribute('data-cid') || '') === CID)) hit = true;
          if (!hit) continue;
          n.scrollIntoView({ block: 'center' });
          var r = n.getBoundingClientRect();
          return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) });
        }
        return '';
      })()`))
      if (!found) {
        // 往下滚一屏再找
        await c.ev(`(function(){ var l=document.querySelector('[class*="commentList"], [class*="comment-list"]'); if(l){ l.scrollTop += 900 } else { window.scrollBy(0,900) } })()`)
        await sleep(1500)
      }
    }
    if (!found) {
      c.close()
      out({ ok: false, error: `评论区里找不到 cid=${REPLY_CID} 这条评论（可能被删了 / 或者滚得不够深）`, code: 'reply_target_not_found' })
      process.exit(1)
    }

    // 在那条评论里找「回复」按钮并点它
    const replyBtn = String(await c.ev(`(function(){
      var CID = ${JSON.stringify(REPLY_CID)};
      var nodes = Array.prototype.slice.call(document.querySelectorAll('[data-e2e="comment-item"], [class*="commentItem"], [class*="comment-item"]'));
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var fk = Object.keys(n).find(function(k){ return k.indexOf('__reactFiber$') === 0 });
        var hit = false;
        if (fk) {
          var f = n[fk], d = 0;
          while (f && d < 16) {
            var p = f.memoizedProps;
            if (p && typeof p === 'object') {
              // 同上面的循环引用问题：只扫浅层，不 stringify 整棵树
              try {
                for (var k in p) {
                  var v = p[k];
                  if (typeof v === 'string' && v.indexOf(CID) >= 0) { hit = true; break }
                  if (typeof v === 'number' && String(v).indexOf(CID) >= 0) { hit = true; break }
                  if (v && typeof v === 'object' && !v.children) {
                    for (var k2 in v) {
                      var v2 = v[k2];
                      if (typeof v2 === 'string' && v2.indexOf(CID) >= 0) { hit = true; break }
                      if (typeof v2 === 'number' && String(v2).indexOf(CID) >= 0) { hit = true; break }
                    }
                    if (hit) break;
                  }
                }
              } catch (e) { /* 跳过 */ }
              if (hit) break;
            }
            f = f.return; d++;
          }
        }
        if (!hit) continue;
        // 在该节点范围内找文字是「回复」的可点元素
        var cands = Array.prototype.slice.call(n.querySelectorAll('span,div,button,a'));
        for (var j = 0; j < cands.length; j++) {
          var e = cands[j];
          if (e.children.length) continue;
          if ((e.innerText || '').trim() !== '回复') continue;
          var r = e.getBoundingClientRect();
          if (!(r.width > 4 && r.height > 8)) continue;
          return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
        }
      }
      return '';
    })()`))
    if (!replyBtn) {
      c.close()
      out({ ok: false, error: '找到了那条评论，但没找到「回复」按钮', code: 'reply_button_not_found' })
      process.exit(1)
    }
    const rb = JSON.parse(replyBtn)
    await click(rb.x, rb.y)
    await sleep(1800)
    replyInfo = { reply_to_cid: REPLY_CID, reply_button: rb }
  }

  /**
   * ⭐ fish.25：图文页（/note/<id>）的评论输入区在一个 display:none 的抽屉里
   *   （组件已挂载、DOM 里有 #comment-input-container，但不点开就 rect=0/无编辑器）。
   *   ⇒ 识别到 note 页且输入区不可见时，把它的隐藏祖先**临时展开成居中的浮层**，
   *     再走原来的「点击→等 DraftJS 可编辑→打@」流程。只在 note + 不可见时触发，视频页不受影响。
   */
  try {
    const fixed = await c.ev(`(function(){
      var h = location.href || '';
      if (h.indexOf('/note/') < 0) return 'not-note';
      var ic = document.getElementById('comment-input-container');
      if (!ic) return 'no-input';
      var r = ic.getBoundingClientRect();
      if (r.width > 20 && r.height > 8) return 'visible';
      var e = ic, hit = null;
      for (var i = 0; i < 10 && e; i++) { var s = getComputedStyle(e); if (s.display === 'none') { hit = e; break } e = e.parentElement }
      if (!hit) hit = ic.parentElement;
      if (!hit) return 'no-ancestor';
      hit.setAttribute('data-dy-note-drawer', '1');
      hit.style.display = 'block';
      hit.style.position = 'fixed';
      hit.style.left = '50%';
      hit.style.top = '50%';
      hit.style.transform = 'translate(-50%, -50%)';
      hit.style.width = '900px';
      hit.style.maxHeight = '70vh';
      hit.style.overflow = 'auto';
      hit.style.background = '#ffffff';
      hit.style.zIndex = '2147483000';
      hit.style.boxShadow = '0 8px 40px rgba(0,0,0,.45)';
      return 'revealed';
    })()`)
    if (fixed === 'revealed') {
      await sleep(800)
      // note 页评论抽屉不可见 —— 已临时展开后继续（不打印，避免污染 JSON 输出）
    }
  } catch { /* 展开失败就按原流程报错 */ }

  /**
   * ① 输入区滚进视口中心（没进视口点击不会展开），真实鼠标点开。
   * ⭐ fish.25：图文页（/note/<id>）的输入框可能不在 #comment-input-container
   *   （在右侧评论面板里）⇒ 定位顺序：`#comment-input-container` → 右侧面板里的
   *   `[contenteditable]` / placeholder「留下你的精彩评论吧」的输入区。
   *   定位器装到 window.__dyLocateInput，boxOf/滚动/兜底点击都复用同一份。
   */
  await c.ev(`(function(){
    window.__dyLocateInput = function(){
      var e = document.getElementById('comment-input-container');
      if (e) { window.__dyMentionInput = e; return 'container'; }
      var cands = [];
      try {
        cands = Array.prototype.slice.call(document.querySelectorAll(
          '[contenteditable="true"],[contenteditable=""],[placeholder*="留下你的精彩评论"],[class*="comment"] [contenteditable],[class*="comment"] [contenteditable="true"],[class*="comment"] [class*="input"],[class*="commentInput"]'
        ));
      } catch(x) {}
      for (var i=0;i<cands.length;i++){
        var x = cands[i];
        if (!x || x.tagName === 'BODY') continue;
        window.__dyMentionInput = x;
        return 'panel';
      }
      window.__dyMentionInput = null;
      return '';
    };
    window.__dyScrollInput = function(){
      var e = window.__dyMentionInput;
      if (!e) return false;
      try { e.scrollIntoView({block:'center'}); } catch(x) {}
      return true;
    };
    window.__dyLocateInput();
    if (window.__dyMentionInput) window.__dyScrollInput();
  })()`)
  await sleep(700)
  const boxOf = async () => JSON.parse(await c.ev(`(function(){
    if (window.__dyLocateInput) window.__dyLocateInput();
    var e = window.__dyMentionInput;
    if (!e) return '{}';
    var r = e.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),y0:Math.round(r.y),h:Math.round(r.height),w:Math.round(r.width),vh:innerHeight,found:e.id==='comment-input-container'?'container':'panel'});
  })()`))
  /** 图文页评论可能在右侧面板：必要时点一下「评论(N)」tab 再找 */
  const clickCommentTab = async () => {
    try {
      const p = JSON.parse(await c.ev(`(function(){
        var cands = Array.prototype.slice.call(document.querySelectorAll('div,span,button,a,[role="tab"]'));
        for (var i=0;i<cands.length;i++){
          var e=cands[i]; var t=String(e.innerText||'').trim();
          if (!/^评论\\s*[（(]?\\d*/.test(t)) continue;
          var r=e.getBoundingClientRect();
          if (!(r.width>20 && r.height>12)) continue;
          return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),t:t.slice(0,20)});
        }
        return '{}';
      })()`))
      if (p.x) { await click(p.x, p.y); return p.t }
    } catch { /* ignore */ }
    return ''
  }
  let box = {}
  let boxTry = 0
  for (; boxTry < 12; boxTry++) {
    await c.ev(`(function(){ if (window.__dyLocateInput) window.__dyLocateInput(); if (window.__dyScrollInput) window.__dyScrollInput(); })()`)
    await sleep(700)
    box = await boxOf()
    if (box.x !== undefined && box.x !== 0 && box.h >= 8) break
    if (boxTry === 2 || boxTry === 6) await clickCommentTab()
    if (boxTry === 8) {
      try { await c.send('Page.navigate', { url: `https://www.douyin.com/note/${AWEME}` }) } catch { /* ignore */ }
      await sleep(3000)
    }
    await sleep(900)
  }
  if (box.x === undefined || !box.h) {
    out({ ok: false, error: '找不到评论输入框（#comment-input-container / 右侧评论面板 / 评论 tab 都试过了）', aweme_id: AWEME, chrome: chromed })
    process.exit(1)
  }
  await click(box.x, box.y)
  await sleep(800)

  /** 等编辑器挂载且 contenteditable=true；没起来就再点输入区/编辑器（兼容 DraftJS 与 note 右侧面板） */
  let editorReady = false
  for (let i = 0; i < 8; i++) {
    editorReady = Boolean(await c.ev(`(function(){
      function vis(e){ try { var r=e.getBoundingClientRect(); return r.width>10 && r.height>4 } catch(x){ return false } }
      var e = document.querySelector('.public-DraftEditor-content[contenteditable="true"]');
      if (!e) {
        var cs = Array.prototype.slice.call(document.querySelectorAll('[contenteditable="true"]'));
        e = cs.find(function(x){ return x && x.tagName !== 'BODY' && vis(x) }) || null;
      }
      if (!e) return false;
      e.setAttribute('data-dy-mention-editor','1');
      window.__dyMentionEditor = e;
      return true;
    })()`))
    if (editorReady) break
    const b = await boxOf()
    if (b.x) await click(b.x, b.y)
    else {
      const e2 = JSON.parse(await c.ev(`(function(){var e=document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||document.querySelector('.public-DraftEditor-content'));if(!e)return '{}';var r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`))
      if (e2.x) await click(e2.x, e2.y)
    }
    await sleep(1000)
  }
  if (!editorReady) {
    out({
      ok: false, published: false, error: '评论编辑器没激活（点开后仍是只读占位 contenteditable=false）',
      code: 'editor_not_ready', aweme_id: AWEME, mention: NAME,
      hint: '可能原因：① 视频/图文本身限制评论 ② 页面被别的任务切走（群巡检） ③ 账号被限流。不是昵称问题。',
      chrome: chromed,
    })
    process.exit(1)
  }

  // ② 点 DraftJS/评论编辑器聚焦（重新取坐标，避免滚动后偏移）
  const ed = JSON.parse(await c.ev(`(function(){
    var e=document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||document.querySelector('.public-DraftEditor-content'));
    if(!e) return '{}';
    var r=e.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
  })()`))
  if (!ed.x) { out({ ok: false, error: '评论编辑器没展开（DraftJS/contenteditable 都没有）' }); process.exit(1) }
  await click(ed.x, ed.y)
  await sleep(400)

  // ③ 打 @（必须键盘事件；execCommand 不会触发弹层）
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '@', key: '@', code: 'Digit2', windowsVirtualKeyCode: 50, nativeVirtualKeyCode: 50 })
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '@', code: 'Digit2', windowsVirtualKeyCode: 50, nativeVirtualKeyCode: 50 })
  await sleep(1800)

  // ④ 找弹层里昵称那一行（叶子节点、最窄的），把 fiber 里的用户数据一起 dump
  /**
   * ⭐ 2026-10-28 实测：弹层默认只给「最近互动 / 关注」的人 —— 直接找全名常常找不到
   *   （主人要 @ 豆包 这种没互关的官方号，就报「弹层里没找到这个名字」）。
   *   ⇒ 先找一次；找不到就把名字**打进输入框过滤**（弹层支持搜索），再找一次。
   *   仍然找不到才退出（不会发布任何东西）。
   */
  const findMentionRow = async () => JSON.parse(await c.ev(`(function(){
    var NAME=${JSON.stringify(NAME)}; var rows=[];
    document.querySelectorAll('div,span,li,p').forEach(function(e){
      if (e.children.length) return;
      if ((e.innerText||'').trim()!==NAME) return;
      var r=e.getBoundingClientRect();
      if (!(r.width>4 && r.height>8)) return;
      var fk=Object.keys(e).find(function(k){return k.indexOf('__reactFiber$')===0});
      var ids=[];
      if (fk){ var f=e[fk],d=0;
        while(f&&d<14){ var p=f.memoizedProps;
          if(p&&typeof p==='object'){
            for(var k in p){ var v=p[k];
              if(typeof v==='string'&&/^\\d{10,20}$/.test(v)) ids.push(k+'='+v);
              else if(typeof v==='string'&&/^(MS4wLjABAA|11-\\d{6,})/.test(v)) ids.push(k+'='+String(v).slice(0,34));
              else if(v&&typeof v==='object'){ if(v.uid)ids.push('obj.uid='+v.uid); if(v.sec_uid)ids.push('obj.sec_uid='+String(v.sec_uid).slice(0,30)); }
            }
          }
          f=f.return; d++;
        }
      }
      var uniq=[]; ids.forEach(function(x){ if(uniq.indexOf(x)<0) uniq.push(x); });
      rows.push({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),ids:uniq.slice(0,8)});
    });
    rows.sort(function(a,b){ return a.w-b.w; });
    return JSON.stringify(rows[0]||{});
  })()`))
  let row = await findMentionRow()
  if (!row.x) {
    // 把名字打进编辑器（弹层按输入过滤），再找一次
    try { await c.send('Input.insertText', { text: NAME }) } catch { /* 输入失败就按没找到处理 */ }
    await sleep(2000)
    row = await findMentionRow()
  }
  if (!row.x) { out({ ok: false, error: '@ 弹层里没找到这个名字（可能没互关 / 昵称不对；已试过输入过滤）', code: 'mention_not_found' }); process.exit(1) }

  // 真实鼠标点选那一行
  await click(row.x, row.y)
  await sleep(1000)

  /**
   * ⑤ 补正文。
   * 🔴 2026-10-22 实测 bug：点选 mention 后，编辑器里**已经有** `@昵称` 这个 token 了。
   *    如果 TEXT 本身又以 `@昵称` 开头（调用方要求"正文里必须原样出现 @昵称"），
   *    直接插入整段 TEXT 就会变成 `@示例好友 @示例好友 正文` —— **重复一次**。
   *    ⇒ 先看编辑器现在是什么，把 TEXT 开头那个 `@昵称` 去掉再插。
   */
  if (TEXT) {
    let body = String(TEXT)
    // 去掉开头的 @昵称（含可能跟着的空格）
    const lead = '@' + NAME
    if (body.startsWith(lead)) body = body.slice(lead.length).replace(/^[\s\u3000]+/, '')
    // 再看编辑器里到底有没有 @昵称（不同版本可能不自动插入，保险起见按实际判断）
    const hasToken = await c.ev(`(function(){
      var e=(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||document.querySelector('.public-DraftEditor-content'));
      return e ? String(e.innerText||'').indexOf(${JSON.stringify(lead)}) >= 0 : false;
    })()`)
    if (body) {
      await c.ev(`document.execCommand('insertText', false, ${JSON.stringify(' ' + body)})`)
      await sleep(600)
    }
    // 如果真的没自动插入 mention，就把 @昵称 补回去（否则名字不会蓝）
    if (!hasToken) {
      await c.ev(`document.execCommand('insertText', false, ${JSON.stringify(lead + ' ')})`)
      await sleep(400)
    }
  }

  const editorHtml = await c.ev(`(function(){
    var e=(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||document.querySelector('.public-DraftEditor-content'));
    return e ? String(e.innerHTML||'').slice(0,900) : '';
  })()`)

  if (DRY) {
    out({ ok: true, dry: true, popup_row: row, editor_html: editorHtml, chrome: chromed })
    c.close(); await sleep(200)
    throw { __done: true }
  }

  // ⑥ 点右下角红色箭头发布（svg 里 fill=FE2C55，往上找到 ≥24px 的可点容器）
  const btn = JSON.parse(await c.ev(`(function(){
    var ed=(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor);
    var root=document.getElementById('comment-input-container')
      || (ed && ed.closest ? ed.closest('[class*="comment"], [class*="editor"], [class*="input"]') : null)
      || (ed ? ed.parentElement : null) || document.body;
    if(!root) return '{}';
    var svgs=root.querySelectorAll('svg');
    for (var i=0;i<svgs.length;i++){
      if (String(svgs[i].innerHTML||'').indexOf('FE2C55')<0) continue;
      var e=svgs[i];
      for (var up=0; up<4 && e; up++){
        var r=e.getBoundingClientRect();
        if (r.width>24 && r.height>24) return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
        e=e.parentElement;
      }
    }
    return '{}';
  })()`))
  if (!btn.x) { out({ ok: false, error: '找不到发布箭头', editor_html: editorHtml }); process.exit(1) }

  /**
   * ⭐ fish.19：发布核实（2026-10-28 实测踩坑：点完箭头 sleep 4s 只看 editor_after 就报
   *   published:true，结果评论区根本没有这条 —— 报了个假成功）。
   *   现在的判定：
   *     ① 点击后等 2s 检查编辑器是否清空（原文不在了才算「提交了」）；
   *        没清空/报错 ⇒ **重试点击一次**，第二次仍没清空 ⇒ published:false + error。
   *     ② 编辑器清空了 ⇒ 刷新视频页，评论区 DOM 按正文前 12 字找自己那条，最多等 45 秒（每 3s 一次）：
   *        找到 ⇒ published:'verified'；找不到 ⇒ published:'submitted_unverified'（可能审核中，如实报）。
   *   找不到发布箭头的老逻辑保留；**不再把 editor_after==='(gone)' 当成功**。
   */
  const bodyNorm = String(TEXT || '').replace(/^@\S+\s*/, '').replace(/\s+/g, '')
  const needle = (bodyNorm || String(TEXT || '').replace(/\s+/g, '')).slice(0, 12)
  const readEditor = async () => c.ev(`(function(){ var e=(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||document.querySelector('.public-DraftEditor-content')); return e ? String(e.innerText||'') : '(gone)'; })()`)
  const editorCleared = (txt) => {
    const s = String(txt || '').replace(/\s+/g, '')
    if (!s) return true
    if (!needle) return true
    return !s.includes(needle)
  }
  /** 在评论区 DOM 里按正文前 12 字找自己那条（滚动加载；最多等 45 秒） */
  const findMyComment = async (timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs
    let last = ''
    while (Date.now() < deadline) {
      try {
        last = String(await c.ev(`(function(){
          var NEEDLE=${JSON.stringify(needle)}; if(!NEEDLE) return '';
          var nodes=document.querySelectorAll('[data-e2e="comment-item"], [class*="commentItem"], [class*="comment-item"]');
          for (var i=0;i<nodes.length;i++){
            var t=String(nodes[i].innerText||'').replace(/\\s+/g,'');
            if (t.indexOf(NEEDLE)>=0) return 'found';
          }
          var l=document.querySelector('[class*="commentList"], [class*="comment-list"]');
          if(l){ l.scrollTop += 1200 } else { window.scrollBy(0,1200) }
          return 'scanning';
        })()`))
      } catch { /* 页面重载中，下一拍再试 */ }
      if (last === 'found') return true
      await sleep(3000)
    }
    return false
  }

  const clickPublish = async () => {
    try {
      await click(btn.x, btn.y)
      await sleep(2000)
      return editorCleared(await readEditor())
    } catch { return false }
  }

  let cleared = await clickPublish()
  let retried = false
  if (shouldRetryPublish({ tries: 0, cleared })) {
    // 第二次点击（只重试一次）
    retried = true
    try {
      // 重新拿一次箭头位置（弹层可能重排）
      const btn2 = JSON.parse(await c.ev(`(function(){
        var root=document.getElementById('comment-input-container');
        if(!root) return '{}';
        var svgs=root.querySelectorAll('svg');
        for (var i=0;i<svgs.length;i++){
          if (String(svgs[i].innerHTML||'').indexOf('FE2C55')<0) continue;
          var e=svgs[i];
          for (var up=0; up<4 && e; up++){
            var r=e.getBoundingClientRect();
            if (r.width>24 && r.height>24) return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});
            e=e.parentElement;
          }
        }
        return '{}';
      })()`))
      if (btn2.x) { btn.x = btn2.x; btn.y = btn2.y }
      await click(btn.x, btn.y)
      await sleep(2000)
      cleared = editorCleared(await readEditor())
    } catch { cleared = false }
  }

  /**
   * 🔴 2026-10-28 第二次实测：红色箭头**点两次都没提交**（编辑器里正文还在，评论区也没有）。
   *   说明"点箭头"这条路在当前页面结构下不一定有效（可能点到的容器不是真正的发送按钮）。
   *   ⇒ 再加三种兜底（按顺序试，谁先让编辑器清空就算提交成功）：
   *     ① 回车（DraftJS 里 Enter；抖音评论框多数情况回车=发送）
   *     ② Ctrl+Enter
   *     ③ DOM 里找「发送/发布」按钮/可点元素，真实点击
   */
  const focusEditor = async () => {
    try {
      await c.ev(`(function(){ var e=document.getElementById('comment-input-container') || (document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor||document.querySelector('.public-DraftEditor-content')); if(!e) return false; e.focus(); var box=e.querySelector('[contenteditable="true"]')||e; box.focus(); box.click(); return true })()`)
      await sleep(300)
    } catch { /* */ }
  }
  const pressEnter = async (withCtrl) => {
    await focusEditor()
    const base = { windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: 'Enter', code: 'Enter' }
    const mods = withCtrl ? 2 : 0
    await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, modifiers: mods })
    await c.send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base, modifiers: mods })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, modifiers: mods })
    await sleep(2000)
    return editorCleared(await readEditor())
  }
  const clickSendButton = async () => {
    try {
      const pos = JSON.parse(await c.ev(`(function(){
        var ed=(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor);
        var root=document.getElementById('comment-input-container')
          || (ed && ed.closest ? ed.closest('[class*="comment"], [class*="editor"], [class*="input"]') : null)
          || (ed ? ed.parentElement : null) || document.body;
        var cands=Array.prototype.slice.call(root.querySelectorAll('button,[role="button"],div,span,a'));
        for (var i=0;i<cands.length;i++){
          var e=cands[i];
          var t=String(e.innerText||'').trim();
          var al=String(e.getAttribute&&e.getAttribute('aria-label')||'');
          if (!/^(发送|发布|评论|提交)$/.test(t) && !/发送|发布|提交/.test(al)) continue;
          var r=e.getBoundingClientRect();
          if (!(r.width>18 && r.height>18)) continue;
          return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),t:t,al:al});
        }
        return '{}';
      })()`))
      if (!pos.x) return false
      await click(pos.x, pos.y)
      await sleep(2000)
      return editorCleared(await readEditor())
    } catch { return false }
  }

  if (!cleared) {
    for (const [label, fn] of [['enter', () => pressEnter(false)], ['ctrlEnter', () => pressEnter(true)], ['sendButton', clickSendButton]]) {
      try {
        cleared = await fn()
        if (cleared) { log && log('发布兜底成功：' + label); break }
      } catch { /* 下一个 */ }
    }
  }
  /** 失败时把容器 HTML 带回去，方便下次直接看清真正的发送按钮长什么样 */
  const containerHtml = cleared ? '' : await c.ev(`(function(){
    var ed=(document.querySelector('[data-dy-mention-editor="1"]')||window.__dyMentionEditor);
    var e=document.getElementById('comment-input-container')
      || (ed && ed.closest ? ed.closest('[class*="comment"], [class*="editor"], [class*="input"]') : null)
      || (ed ? ed.parentElement : null);
    return e? String(e.innerHTML||'').slice(0,2000):'(no container)'
  })()`).catch(() => '')

  if (!cleared) {
    const editorAfterFail = await readEditor().catch(() => '?')
    c.close()
    await sleep(200)
    out({
      ok: false, published: false, error: `发布后编辑器没清空（箭头两次 + 回车/Ctrl回车/发送按钮都没提交上，重试=${retried}）`,
      aweme_id: AWEME, mention: NAME, ...(replyInfo || {}), popup_row: row,
      editor_html: editorHtml, editor_after: editorAfterFail, container_html: containerHtml, chrome: chromed,
    })
    process.exit(1)
  }

  // 编辑器已清空 ⇒ 刷新视频页，在评论 DOM 里核实是否真的出现了
  let found = false
  try {
    await c.send('Page.navigate', { url: `https://www.douyin.com/video/${AWEME}` })
    await sleep(7000)
    found = await findMyComment(45_000)
  } catch { found = false }
  const editorAfter = await readEditor().catch(() => '(gone)')
  const publishState = judgePublishOutcome({ cleared: true, found })
  c.close()
  await sleep(200)   // 等 WebSocket 真正关掉再退出（别的工具踩过 libuv 断言）
  out({
    ok: true,
    published: publishState,
    verified: found,
    note: publishState === 'verified'
      ? '已刷新页面并在评论区 DOM 里看到自己这条（正文前 12 字匹配）'
      : '编辑器已清空但评论区里没找到（很可能在审核/没分发）——别当已发出去，等一会儿再核实',
    aweme_id: AWEME, mention: NAME, ...(replyInfo || {}),
    needle, retried, popup_row: row, editor_html: editorHtml, editor_after: editorAfter, chrome: chromed,
  })
} catch (e) {
  if (!(e && e.__done)) out({ ok: false, error: String(e?.message ?? e) })
}
