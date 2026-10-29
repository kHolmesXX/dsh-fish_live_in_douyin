#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
tools/forward-pick.py —— 刷一轮：拉候选 → 打分 → 生成「转发给我」的清单
============================================================================
只读、**不签名**、不碰写接口。判断依据全部来自 JSON 字段：
desc / tags / author / create_time / duration / digg·comment·collect·share / 高赞评论。
不看画面、不做 ASR/OCR、不读视频。

用法:
  python tools/forward-pick.py            # 拉 feed 3 页 + 热榜，出清单
  python tools/forward-pick.py --dump     # 额外打印原始结构，排错用
"""
import argparse
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _home import home_str  # noqa: E402
import time
from datetime import datetime, timezone, timedelta

from curl_cffi import requests as creq

# ⚠️ 2026-10-21 实测：Windows 上 stdout 默认 GBK，遇到标题里的 𝓋 / emoji 这类字符
#    直接 UnicodeEncodeError 崩掉（这一轮就是崩在最后打印清单那一步）。
#    插件是 spawnSync 抓管道的，崩了就等于「取候选失败」—— 一律强制 utf-8，编不出的替换掉。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HOME = home_str()
COOKIE_FILE = os.path.join(HOME, "douyin_cookie.txt")
OUT_JSON = os.path.join(HOME, "forward-pick.json")
OUT_MD = os.path.join(HOME, "out", "forward-" + datetime.now().strftime("%Y%m%d-%H%M") + ".md")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
BASE = "https://www.douyin.com"
COMMON = ("device_platform=webapp&aid=6383&channel=channel_pc_web&pc_client_type=1"
          "&version_code=190500&version_name=19.5.0&cookie_enabled=true"
          "&screen_width=1920&screen_height=1080&browser_language=zh-CN"
          "&browser_platform=Win32&browser_name=Chrome&browser_version=141.0.0.0"
          "&engine_name=Blink&engine_version=141.0.0.0&os_name=Windows&os_version=10"
          "&platform=PC&downlink=10&effective_type=4g&round_trip_time=50")

CST = timezone(timedelta(hours=8))


def load_cookie():
    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        return f.read().strip()


def walk_awemes(obj, bag):
    """递归找所有长成 aweme 的 dict（有 aweme_id + desc）。"""
    if isinstance(obj, list):
        for v in obj:
            walk_awemes(v, bag)
    elif isinstance(obj, dict):
        if "aweme_id" in obj and ("desc" in obj or "statistics" in obj):
            bag[obj["aweme_id"]] = obj
        else:
            for v in obj.values():
                walk_awemes(v, bag)


def stat(a, k):
    s = a.get("statistics") or {}
    try:
        return int(s.get(k) or 0)
    except Exception:
        return 0


def fmts(n):
    if n >= 100000000:
        return "%.1f亿" % (n / 100000000.0)
    if n >= 10000:
        return "%.1f万" % (n / 10000.0)
    return str(n)


def get(s, path, quiet=True):
    try:
        r = s.get(BASE + path, timeout=25)
        time.sleep(1.2)
        if r.status_code != 200:
            if not quiet:
                print("  ! %s -> HTTP %s" % (path.split("?")[0], r.status_code), file=sys.stderr)
            return None
        return r.json()
    except Exception as e:
        if not quiet:
            print("  ! %s -> %s" % (path.split("?")[0], e), file=sys.stderr)
        return None


def load_collector():
    """
    ⭐ 读设置页那两个旋钮（`collector.json`，由 index.js 的 syncCollectorCfg 写）。
    以前这里完全没读它 ⇒ 设置页「文案太短 / 评论少」两个旋钮是死的（改了不起作用）。
    """
    p = os.path.join(HOME, "collector.json")
    try:
        with open(p, "r", encoding="utf-8") as f:
            j = json.load(f) or {}
    except Exception:
        j = {}
    return {
        "minDescLen": int(j.get("minDescLen") or 0),
        "minComments": int(j.get("minComments") or 0),
        # ⭐ 2026-10-27：点赞上限（超过就不分享）。主人先定 2 万，后临时放宽到 3 万。
        "likeCap": int(j.get("likeCap") or 20000),
    }


# ⭐ 2026-10-27「小肥鱼知道主人的口味」：偏好加权
# ============================================================================
# 背景：主人设了偏好词（config.json 的 keywords，面板「偏好关键词」），但他发现
#   推荐还是不对味 —— 因为抖音 web **没有关键词搜索接口** ⇒ 偏好词控制不了
#   "捞什么"（供给只能靠推荐流/主人自己养号）。能控制的是"捞到之后怎么排"：
#     · 命中偏好 ⇒ 加分 + **放宽硬筛**（美女/卡点类常是 8–15 秒、文案短，
#       以前直接按「时长<12s」「文案太短且评论少」丢了）；
#     · 排序时命中的排前面，模型才看得到。
# ⚠️ 命中判定只看 文案 / 话题标签 / 作者名。平台不给"擦边"这种词打标签，
#    所以擦边内容主要靠**养号**让 feed 自己带 —— 这里管不了供给。
# ============================================================================

# 内置提示词：主人没写、或写得少的时候，这些词也能当"颜值/擦边向"信号。
# ⚠️ 想加自己的词，直接改这一行（或写进面板的偏好关键词，那个优先）。
PREFER_CUES = [
    # 颜值 / 美女向
    "美女", "颜值", "姐姐", "女神", "甜妹", "辣妹", "身材", "性感", "写真",
    "氛围感", "仙女", "好美", "擦边", "御姐", "少妇", "比基尼", "泳装",
    "紧身", "瑜伽", "健身", "舞蹈", "舞蹈生", "变装", "换装", "穿搭", "街拍",
    "丝袜", "短裙", "辣舞",
]

# 主人不想要的品类（2026-10-27：「她好像很多权重都在分享宠物」）⇒ 降权
# ⚠️ 只降权、不直接丢：免得"猫+美女"这种混剪被误伤。
AVOID_CUES = [
    "宠物", "萌宠", "猫咪", "猫猫", "小猫", "狗狗", "小狗", "奶龙", "小马",
    "熊猫", "萌娃", "宝宝", "动物园", "铲屎官",
]

# ⭐⭐ 2026-10-27 主人定稿（原话）：「我不想要点赞量这么高的视频，都不是擦边了，
#    能不能排除超过 2 万的点赞都不分享，然后分享权重按照正态分布配权重，
#    最中间的值在 5000-8000 左右，然后点赞低的权重比点赞高的权重更高一点」
#    ⇒ ① 点赞 > 2 万：直接不分享（硬筛）
#       ② 其余按**非对称正态分布**配权重：峰值 5000–8000；
#          5000 以下衰减慢（点赞低也保留），8000 以上衰减快（点赞高权重更低）。
LIKE_CAP = 20000          # 超过这个点赞：不进候选（dropped.too_hot）
LIKE_CENTER = 6500        # 峰值中心（5000–8000 正中间）
LIKE_SIGMA_LEFT = 6000    # 低于峰值的一侧：衰减慢
LIKE_SIGMA_RIGHT = 3500   # 高于峰值的一侧：衰减快


def like_weight(d):
    """
    点赞分布权重（0~1）：非对称正态。
      0 赞 ≈ 0.56 / 5000 赞 ≈ 0.97 / 6500 赞 = 1.00 / 8000 赞 ≈ 0.91 / 15000 赞 ≈ 0.03
    「点赞低的权重比点赞高的权重更高一点」—— 靠左右 sigma 不一样实现（左 6000 / 右 3500）。
    """
    d = max(0, int(d or 0))
    diff = d - LIKE_CENTER
    sigma = LIKE_SIGMA_LEFT if diff < 0 else LIKE_SIGMA_RIGHT
    return round(math.exp(-0.5 * (diff / sigma) ** 2), 4)


def load_interests():
    """
    ⭐ fish.15：读主人的兴趣账本 `$DOUYIN_HOME/home/interests.json`：
      · keywords 里 score>0 的 top 8 ⇒ 偏好词（合并进 prefs）
      · score<0 ⇒ avoid 列表
    文件不存在/坏了/没数据 ⇒ 空，老路径完全不受影响。
    """
    pos, neg = [], []
    p = os.path.join(HOME, "home", "interests.json")
    try:
        with open(p, "r", encoding="utf-8-sig") as f:
            j = json.load(f) or {}
        kws = j.get("keywords") or {}
        if isinstance(kws, dict):
            for word, v in kws.items():
                w = str(word or "").strip()
                if not w:
                    continue
                if isinstance(v, dict):
                    try:
                        score = int(v.get("score") or 0)
                    except Exception:
                        score = 0
                else:
                    score = 0
                if score > 0:
                    pos.append((score, w))
                elif score < 0:
                    neg.append((score, w))
    except Exception:
        return [], []
    pos.sort(key=lambda x: (-x[0], x[1]))
    neg.sort(key=lambda x: (x[0], x[1]))
    return [w for _, w in pos[:8]], [w for _, w in neg[:8]]


def load_avoid():
    """内置 avoid 词 + 兴趣账本里 score<0 的关键词（去重、保持顺序）。"""
    out = list(AVOID_CUES)
    try:
        _, neg = load_interests()
        for w in neg:
            if w not in out:
                out.append(w)
    except Exception:
        pass
    return out


def load_prefs():
    """
    读偏好词：config.json 的 keywords（面板「偏好关键词」）
    + 兴趣账本里 score>0 的 top 8（fish.15）。读不到就忽略，空 = 不加权。
    """
    prefs = []
    p = os.path.join(HOME, "config.json")
    try:
        with open(p, "r", encoding="utf-8-sig") as f:
            j = json.load(f) or {}
        prefs = [str(x).strip() for x in (j.get("keywords") or []) if str(x).strip()]
    except Exception:
        prefs = []
    try:
        pos, _ = load_interests()
        for w in pos:
            if w and w not in prefs:
                prefs.append(w)
    except Exception:
        pass
    return prefs


def tag_text(a):
    """把话题标签拼成一段文本（cha_list + 文案里的 #话题），给偏好朋友做命中判定。"""
    parts = []
    for ch in (a.get("cha_list") or []):
        if isinstance(ch, dict):
            parts.append(str(ch.get("cha_name") or ""))
    for m in re.findall(r"#([^\s#]+)", str(a.get("desc") or "")):
        parts.append(m)
    return " ".join(parts)


def pref_match(text, kws):
    """返回命中的词（配置词优先，其次内置提示词）；没命中返回空串。大小写不敏感（bbw/BBW 都算）。"""
    low = str(text or "").lower()
    for k in kws:
        if k and k.lower() in low:
            return k
    for k in PREFER_CUES:
        if k.lower() in low:
            return k
    return ""


def avoid_match(text, avoid=None):
    """宠物/萌娃这类主人不想要的品类 + 兴趣账本 disliked 关键词；返回命中的词（没命中返回空串）。"""
    low = str(text or "").lower()
    for k in (list(AVOID_CUES) if avoid is None else avoid):
        if k and str(k).lower() in low:
            return k
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", action="store_true")
    ap.add_argument("--limit", type=int, default=10, help="最多取前几条（默认 10）")
    ap.add_argument("--prefer", default="", help="临时覆盖偏好词（逗号分隔），测试用")
    ap.add_argument("--loose", action="store_true",
                    help="视觉优先模式：不做时长/点赞/文案硬筛，全部候选留给截图肉眼判（2026-10-27 主人定稿）")
    ap.add_argument("--selftest", action="store_true",
                    help="只打印合并后的 prefs/avoid（兴趣账本接入自检，不联网）")
    args = ap.parse_args()
    loose = bool(args.loose)
    if args.selftest:
        pos, neg = load_interests()
        print(json.dumps({"ok": True, "interests": {"positive": pos, "negative": neg},
                          "prefs": load_prefs(), "avoid": load_avoid()}, ensure_ascii=False))
        return 0

    limits = load_collector()

    # 点赞上限：collector.json（由插件从 config.likeCap 同步）> 常量兜底 2 万

    like_cap = int(limits.get('likeCap') or LIKE_CAP)
    # 偏好词：命令行临时覆盖 > 面板 keywords + 兴趣账本 top8 > 空（空 = 不加权）
    prefs = [x.strip() for x in str(args.prefer or "").split(",") if x.strip()] or load_prefs()
    # ⭐ fish.15：内置 avoid 词 + 兴趣账本里 score<0 的关键词
    avoid = load_avoid()
    # ⭐ 硬筛计数：报告里要能说清"因为什么跳过了几条"，不能只给个最终条数
    dropped = {"no_desc": 0, "too_short_video": 0, "short_and_quiet": 0, "too_hot": 0, "pref_bypass": 0}

    cookie = load_cookie()
    bag = {}
    meta = []

    with creq.Session(impersonate="chrome") as s:
        s.headers.update({
            "User-Agent": UA, "Cookie": cookie,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": BASE + "/", "Origin": BASE,
        })

        # 1) 推荐流 3 页
        for i in range(1, 4):
            j = get(s, "/aweme/v1/web/tab/feed/?%s&count=20&refresh_index=%d" % (COMMON, i))
            if j:
                before = len(bag)
                walk_awemes(j, bag)
                meta.append({"src": "feed#%d" % i, "new": len(bag) - before, "status": j.get("status_code")})
                if args.dump and i == 1:
                    print("[feed#1 top-level keys] %s" % sorted(j.keys()), file=sys.stderr)

        # 2) 热榜
        j = get(s, "/aweme/v1/web/hot/search/list/?%s&detail_list=1" % COMMON)
        if j:
            before = len(bag)
            walk_awemes(j, bag)
            meta.append({"src": "hot-search", "new": len(bag) - before, "status": j.get("status_code")})

    now = time.time()
    rows = []
    for aid, a in bag.items():
        desc = (a.get("desc") or "").strip()
        if not desc:
            if not loose:
                dropped["no_desc"] += 1
                continue
            desc = ""            # 视觉优先：没文案也留（画面才是判据）
        author = (a.get("author") or {}).get("nickname") or ""
        # ⭐ 偏好命中：文案 / 话题 / 作者名里出现偏好词（或内置颜值提示词）
        ptext = " ".join([desc, tag_text(a), author])
        phit = pref_match(ptext, prefs)
        # ⭐ 宠物/萌娃降权（命中偏好时不算，免得"猫+美女"混剪被误伤）
        ahit = "" if phit else avoid_match(ptext, avoid)
        dur = a.get("duration") or (a.get("video") or {}).get("duration") or 0
        # <12s 多数是模板/广告 —— 但**命中偏好的放行**（颜值/卡点类本来就 8–15 秒）
        # 🔴 视觉优先模式：不做时长筛（主人 2026-10-27「不用考虑时长」）
        if (not loose) and dur and dur < 12000:
            if not phit:
                dropped["too_short_video"] += 1
                continue
            dropped["pref_bypass"] += 1
        d, c, col, sh = stat(a, "digg_count"), stat(a, "comment_count"), stat(a, "collect_count"), stat(a, "share_count")
        # 🔴 2026-10-27 主人定稿：点赞 > 上限的不分享
        #    但**视觉优先模式不看点赞**（主人：「不用考虑点赞」）⇒ 不筛
        if (not loose) and d > like_cap:
            dropped["too_hot"] += 1
            continue
        # ⭐ 设置页那两个旋钮：文案太短**且**评论少 ⇒ 丢（单条不满足只降权不丢）
        #    命中偏好同样放行：美女类文案常常就几个字 + 评论还没起来
        #    视觉优先模式：文案/评论也不看 ⇒ 不筛
        if (not loose) and limits["minDescLen"] and len(desc) < limits["minDescLen"] and c < limits["minComments"]:
            if not phit:
                dropped["short_and_quiet"] += 1
                continue
            dropped["pref_bypass"] += 1
        ct = a.get("create_time") or 0
        age_h = (now - ct) / 3600.0 if ct else 999
        # 评论/点赞比：越高越"有话说"；太高的往往是争议/标题党（只作证据，不参与加权）
        ratio = (c / d) if d else 0
        # ⭐⭐ 2026-10-27 主人定稿：分享权重按**点赞正态分布**配 —— 峰值 5000–8000，低赞＞高赞。
        #    非偏好命中还按老互动分打底；偏好命中则压低点赞本身、抬高评/藏/转（被限流的号就是评藏转更可信）。
        lw = like_weight(d)
        score = (d * 0.2 + c * 3 + col * 6 + sh * 3) if phit else (d + c * 2 + col * 3 + sh * 2)
        score *= lw
        if age_h <= 72:
            score *= 1.15
        if phit:
            score *= 3.0            # 主人要的品类再乘一道，压过宠物/大爆款
        elif ahit:
            score *= 0.45           # ⭐ 宠物/萌娃降权（主人：「权重都在分享宠物」）
        si = a.get("share_info") or {}
        official = si.get("share_url") or a.get("share_url") or ""
        rows.append({
            "aweme_id": aid,
            "desc": desc,
            "author": author,
            "sec_uid": (a.get("author") or {}).get("sec_uid") or "",
            "duration_s": round(dur / 1000.0, 1) if dur else None,
            "digg": d, "comment": c, "collect": col, "share": sh,
            "comment_ratio": round(ratio, 4),
            "age_h": round(age_h, 1),
            "score": int(score),
            # ⭐ 2026-10-27：点赞分布权重（非对称正态，峰值 5000–8000；低赞>高赞）
            "like_weight": lw,
            # ⭐ 2026-10-27：偏好命中标记（模型据此按"他会不会喜欢"判，不按"内容价值"判）
            "pref_hit": phit,
            # ⭐ 2026-10-27 主人：「擦边被限流，点赞一般一万以下」⇒ 低赞是**正常**，不是内容差
            "low_digg": bool(phit and d < 10000),
            # ⭐ 2026-10-27：宠物/萌娃降权标记（只是降权，不丢）
            "avoid_hit": ahit,
            # ⭐ 官方分享链接（接口直接给的，带 share_sign）——不要自己拼 aweme_id
            "share_url": official or ("https://www.iesdouyin.com/share/video/%s/" % aid),
            # 抖音口令（"复制此链接，打开Dou音搜索"那串）
            "share_desc": (si.get("share_link_desc") or "").replace("%s", official).strip(),
            # 网页地址（能在浏览器打开，但不是分享链接）
            "web_url": "%s/video/%s" % (BASE, aid),
        })

    # 排序：偏好命中置顶 → 普通 → 宠物/萌娃垫底；同档按分数
    if loose:
        # 🔴 视觉优先模式：只决定「先截哪 10 条」——偏好命中优先，其次新视频（不做任何数据淘汰）
        rows.sort(key=lambda r: (0 if r["pref_hit"] else 1, r["age_h"], -r["digg"]))
    else:
        rows.sort(key=lambda r: (0 if r["pref_hit"] else (2 if r["avoid_hit"] else 1), -r["score"]))
    top = rows[:max(1, args.limit)]

    print("采集：%s" % json.dumps(meta, ensure_ascii=False))
    print("偏好词：%s%s" % (
        "、".join(prefs) if prefs else "（空 —— 不加权）",
        ("；命中 %d 条" % sum(1 for r in rows if r["pref_hit"])) if prefs else ""))
    print("点赞权重：非对称正态，峰值 5000–8000（低赞>高赞）；点赞 > %d 直接不分享" % like_cap)
    if loose:
        print("视觉优先：不做时长/点赞/文案淘汰 —— 候选全部留给截图肉眼判（最多截 10 条）")
    print("降权：宠物/萌娃 %d 条（不丢，只压后）" % sum(1 for r in rows if r["avoid_hit"]))
    print("硬筛跳过：%s（阈值 文案≥%d 字 / 评论≥%d；pref_bypass=命中偏好后放行的；too_hot=点赞>%d）" % (
        json.dumps(dropped, ensure_ascii=False), limits["minDescLen"], limits["minComments"], like_cap))
    print("去重后候选 %d 条，取前 %d" % (len(rows), len(top)))
    for i, r in enumerate(top, 1):
        mark = ("【偏好·%s】" % r["pref_hit"]) if r["pref_hit"] else \
               (("【降权·%s】" % r["avoid_hit"]) if r["avoid_hit"] else "")
        print("%2d. [%s] %s%s" % (i, fmts(r["digg"]), mark, r["desc"][:46]))
        print("    %s · %s · 赞%s 评%s 藏%s 转%s · %s" % (
            r["author"],
            ("%ss" % r["duration_s"]) if r["duration_s"] else "时长未知",
            fmts(r["digg"]), fmts(r["comment"]), fmts(r["collect"]), fmts(r["share"]),
            ("%.0f小时前" % r["age_h"]) if r["age_h"] < 900 else "时间未知"))
        print("    %s" % r["share_url"])

    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "rows": top, "dropped": dropped, "thresholds": limits,
                   "prefs": prefs}, f, ensure_ascii=False, indent=1)
    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# 转发清单 %s\n\n" % datetime.now(CST).strftime("%Y-%m-%d %H:%M"))
        for i, r in enumerate(top, 1):
            f.write("### %s\n" % r["aweme_id"])
            f.write("- %s%s\n" % (("【偏好·%s】" % r["pref_hit"]) if r["pref_hit"] else "", r["desc"]))
            f.write("- %s · %ss · 赞%s 评%s 藏%s\n" % (r["author"], r["duration_s"], fmts(r["digg"]), fmts(r["comment"]), fmts(r["collect"])))
            f.write("- %s\n\n" % r["share_url"])
    print("\n清单 -> %s" % OUT_MD)


if __name__ == "__main__":
    main()
