#!/usr/bin/env python3
"""
trace.py — ISO-Agile SDLC 追溯掃描器 / HTML 儀表板產生器（純標準函式庫）

掃描一個 SDLC 工作目錄下所有 .md 產出文件，解析其中的工作項
(### REQ-001 — 標題)、狀態與追溯關係 (traces:)，計算追溯鏈、偵測缺口，
最後輸出一個自包含的單檔 HTML (dashboard.html，與文件同層、SoT file:line 可點開原始 md)，分門別類呈現：
  概覽 / 文件 / 追溯矩陣 / 追溯圖(Mermaid) / 缺口

版面（兩者皆支援）：
  新版面 <repo>/.sdlc/features/<id>/（文件直接放此，產品在 repo 根）；
  舊版面 <repo>/features/<id>/sdlc/（文件在 sdlc/ 子目錄）。

用法:
  python3 trace.py <feature文件目錄>          # 掃描並產生 <目錄>/dashboard.html
  python3 trace.py <feature文件目錄> -o out.html
  python3 trace.py <feature文件目錄> --check   # 只檢查，有缺口時 exit code = 1（給 CI / gate 用）
  python3 trace.py <feature文件目錄> --impact ID  # 影響分析（迭代維護用）
  python3 trace.py --features <repo根>        # 工作區層級：重建各 feature dashboard + 索引(.sdlc/dashboard.html) + 跨 feature 斷鏈偵測
"""
from __future__ import annotations
import sys, os, re, json, html, argparse, datetime, subprocess

# ── ID 前綴 → (階段 key, 階段中文, 種類) ─────────────────────────────
#   種類: spec(規格) / build(實作) / verify(驗證)
PREFIX_MAP = {
    "REQ":  ("requirements",  "需求",      "spec"),
    "SG":   ("safety",        "安全目標",  "spec"),   # ISO 26262 HARA → Safety Goal（僅非 QM feature）
    "CG":   ("safety",        "資安目標",  "spec"),   # ISO 21434 TARA → Cybersecurity Goal（僅非 QM feature）
    "SAN":  ("analysis",      "安全分析",  "spec"),   # FMEA/FTA/DFA/TARA 攻擊路徑分析（僅非 QM feature）
    "ARCH": ("architecture",  "架構",      "spec"),
    "TASK": ("tasks",         "任務",      "spec"),
    "DES":  ("design",        "詳細設計",  "spec"),
    "IMPL": ("impl",          "實作",      "build"),
    "UT":   ("verification",  "單元測試",  "verify"),
    "IT":   ("verification",  "整合測試",  "verify"),
    "E2E":  ("verification",  "端對端測試", "verify"),
    "VAL":  ("verification",  "系統驗收",  "verify"),
}
# 儀表板矩陣的欄位順序
MATRIX_COLS = [
    ("architecture", "架構 ARCH"),
    ("design",       "設計 DES"),
    ("tasks",        "任務 TASK"),
    ("impl",         "實作 IMPL"),
    ("verification", "驗證 UT/IT/E2E/VAL"),
]
STATUS_ORDER = ["draft", "reviewed", "done", "blocked"]
STATUS_LABEL = {"draft": "草稿", "reviewed": "已審", "done": "完成",
                "blocked": "受阻", "unknown": "未標"}

# 前綴允許字母開頭的英數（如 REQ、E2E），避免漏掉含數字的前綴
ITEM_RE = re.compile(r"^#{2,4}\s+([A-Z][A-Z0-9]{1,4}-\d+)\s*[—\-–:：]\s*(.+?)\s*$")
META_RE = re.compile(r"^\s*[-*]\s*\*\*(\w+)\s*[:：]?\s*\*\*\s*[:：]?\s*(.*)$")
ID_RE   = re.compile(r"[A-Z][A-Z0-9]{1,4}-\d+")
# 任何標題列（含非工作項標題，如 "## 決策理由" 或不合 ID 規則的 "### IMPL-S01"）。
# 用來在解析時「結束」當前工作項——否則該標題下的 metadata 會誤併進上一個工作項。
HEADING_RE = re.compile(r"^#{1,6}\s")


def prefix_of(item_id: str):
    return item_id.split("-")[0]


def stage_of(item_id: str):
    return PREFIX_MAP.get(prefix_of(item_id), ("other", "其他", "spec"))


def parse_file(path: str):
    """從單一 md 檔解析出所有工作項。"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    return _parse_lines(lines, os.path.basename(path))


def _parse_lines(lines, fname: str):
    """從一組 md 行(可來自檔案或 git blob)解析工作項;fname 供 SoT 來源欄。"""
    items = []
    cur = None
    for lineno, line in enumerate(lines, 1):       # 行號從 1 起，供 SoT 溯源引用
        m = ITEM_RE.match(line)
        if m:
            if cur:
                items.append(cur)
            iid, title = m.group(1), m.group(2).strip()
            skey, slabel, kind = stage_of(iid)
            cur = {"id": iid, "title": title, "stage": skey, "stage_label": slabel,
                   "kind": kind, "status": "unknown", "traces": [], "iter": "",
                   "greens": [], "files": "", "result": "", "tier": "", "real": "", "asil": "",
                   "file": fname, "line": lineno}   # line = ### 標題所在行
            continue
        if HEADING_RE.match(line):
            # 非工作項的標題（區段標題，或不合 ID 規則的標題如 ### IMPL-S01）
            # → 結束當前工作項，避免其下的 metadata 誤併進上一個工作項。
            if cur:
                items.append(cur)
                cur = None
            continue
        if cur:
            mm = META_RE.match(line)
            if mm:
                key, val = mm.group(1).lower(), mm.group(2).strip()
                if key == "status":
                    cur["status"] = val.lower() or "unknown"
                elif key in ("traces", "trace"):
                    cur["traces"] = ID_RE.findall(val)
                elif key in ("iter", "iteration"):
                    cur["iter"] = val.strip()
                elif key == "greens":
                    cur["greens"] = ID_RE.findall(val)
                elif key == "files":
                    cur["files"] = val.strip()
                elif key == "result":
                    cur["result"] = val.strip()
                elif key == "tier":
                    cur["tier"] = val.strip().lower()
                elif key == "real":
                    cur["real"] = val.strip().lower()
                elif key == "asil":
                    cur["asil"] = val.strip().upper()   # QM|A|B|C|D|ASIL-A…；空字串＝QM（安全檢查休眠）
    if cur:
        items.append(cur)
    return items


def scan(sdlc_dir: str):
    items = {}
    for root, dirs, files in os.walk(sdlc_dir):
        parts = root.split(os.sep)
        if "dashboard" in parts or ".panel" in parts:  # 略過儀表板輸出與 panel 暫存提案
            continue
        for fn in sorted(files):
            if fn.endswith(".md"):
                for it in parse_file(os.path.join(root, fn)):
                    items[it["id"]] = it
    return items


def upstream_closure(start: str, items: dict):
    """沿 traces (child→parent) 走，回傳 start 的所有上游 ID（含遞迴）。"""
    seen, stack = set(), list(items.get(start, {}).get("traces", []))
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(items.get(n, {}).get("traces", []))
    return seen


def downstream_closure(start: str, items: dict):
    """找出所有（遞迴）追溯到 start 的下游 ID — 即 start 改動時需連帶檢視的項目。"""
    children = {}
    for iid, it in items.items():
        for t in it["traces"]:
            children.setdefault(t, []).append(iid)
    seen, stack = set(), list(children.get(start, []))
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(children.get(n, []))
    return seen


def reachable_from_pred(pred, items: dict):
    """從所有滿足 pred 的節點出發，沿 traces 能到達的全部上游節點集合。"""
    covered = set()
    for iid, it in items.items():
        if pred(it):
            covered.add(iid)
            covered |= upstream_closure(iid, items)
    return covered


def reachable_from(kind_filter, items: dict):
    """從所有指定種類的節點出發，沿 traces 能到達的全部上游節點集合。"""
    return reachable_from_pred(lambda it: it["kind"] == kind_filter, items)


def is_real_test(it: dict):
    """是否為「真實層」測試：verify 種類且 real 標記為真（validator 實跑佐證才標 true）。"""
    return it["kind"] == "verify" and it["real"] in ("true", "yes", "1", "real")


def iter_num(s: str):
    """從 'v2' / 'iter3' / '2' 取出迭代序號；取不到回 None。"""
    m = re.search(r"\d+", s or "")
    return int(m.group()) if m else None


def analyze(items: dict):
    ids = set(items)
    verified = reachable_from("verify", items)
    verified_real = reachable_from_pred(is_real_test, items)  # 僅「真實層(real:true)」測試能到達的上游
    implemented = reachable_from("build", items)

    gaps = []
    # 文件↔程式碼漂移：實作迭代比其文件/測試新 → 文件沒跟上（living-doc 一致性）
    for cid, c in items.items():
        for t in c["traces"]:
            p = items.get(t)
            if not p:
                continue
            ic, ip = iter_num(c["iter"]), iter_num(p["iter"])
            if ic is None or ip is None:
                continue
            # 實作比它依據的設計新 → 設計文件落後
            if c["kind"] == "build" and p["stage"] == "design" and ic > ip:
                gaps.append({"type": "漂移", "id": p["id"], "sev": "low",
                             "msg": f"{p['id']}（設計 {p['iter']}）落後於實作 {c['id']}（{c['iter']}）"
                                    f"，文件可能未隨程式碼更新"})
            # 設計比驗證它的測試新 → 測試落後
            if c["kind"] == "verify" and p["stage"] == "design" and ip > ic:
                gaps.append({"type": "漂移", "id": c["id"], "sev": "low",
                             "msg": f"{c['id']}（測試 {c['iter']}）落後於設計 {p['id']}（{p['iter']}）"
                                    f"，測試可能未隨設計更新"})
    for iid, it in sorted(items.items()):
        # 斷鏈：traces 指向不存在的 ID
        for t in it["traces"]:
            if t not in ids:
                gaps.append({"type": "斷鏈", "id": iid,
                             "msg": f"{iid} 追溯到不存在的 {t}", "sev": "high"})
        # 孤兒實作：build/verify 沒有任何 traces
        if it["kind"] in ("build", "verify") and not it["traces"]:
            gaps.append({"type": "孤兒", "id": iid,
                         "msg": f"{iid}（{it['stage_label']}）沒有追溯到任何上游需求/設計",
                         "sev": "high"})
        # 需求未實作 / 未驗證
        if it["stage"] == "requirements":
            if iid not in implemented:
                gaps.append({"type": "未實作", "id": iid,
                             "msg": f"{iid} 沒有任何實作 (IMPL) 追溯到它", "sev": "mid"})
            if iid not in verified:
                gaps.append({"type": "未驗證", "id": iid,
                             "msg": f"{iid} 沒有任何測試 (UT/IT/VAL) 追溯到它", "sev": "mid"})
            elif iid not in verified_real:
                gaps.append({"type": "未真實驗證", "id": iid, "sev": "high",
                             "msg": f"{iid} 僅由 mock/非真實層測試覆蓋，缺少 real:true 的真實層驗證"
                                    f"（E2E/VAL 打真實接線、未 mock SUT 邊界，由 validator 實跑佐證）"})
            # ── ISO 26262/21434 安全剪裁：僅當此 REQ 被標非 QM 才檢查；QM/未標 ⇒ 完全休眠 ──
            asil = it.get("asil", "").replace("ASIL-", "").strip()
            if asil and asil != "QM":
                if not any(prefix_of(u) == "SG" for u in upstream_closure(iid, items)):
                    gaps.append({"type": "缺安全目標", "id": iid, "sev": "high",
                                 "msg": f"{iid}（ASIL-{asil}）未追溯到任何安全目標 SG-*"
                                        f"——需先做 HARA 導出 Safety Goal，再讓需求 traces 回它"})
                if asil in ("C", "D") and iid not in verified_real:
                    gaps.append({"type": "安全驗證不足", "id": iid, "sev": "high",
                                 "msg": f"{iid}（ASIL-{asil}）缺 real:true 真實層驗證"
                                        f"——高 ASIL 不接受僅 mock/單元覆蓋"})
        # 任務未實作
        if it["stage"] == "tasks" and iid not in implemented:
            gaps.append({"type": "未實作", "id": iid,
                         "msg": f"{iid}（任務）沒有對應實作", "sev": "low"})

    # TDD 違反：有實作卻沒有任何測試覆蓋（測試應先於實作存在）
    test_targets = set()  # 被任何測試追溯到的上游（DES/ARCH/REQ…）
    for it in items.values():
        if it["kind"] == "verify":
            test_targets |= set(it["traces"])
    for iid, it in sorted(items.items()):
        if it["stage"] != "impl":
            continue
        covered = bool(it["greens"]) or any(t in test_targets for t in it["traces"])
        if not covered:
            gaps.append({"type": "TDD", "id": iid, "sev": "mid",
                         "msg": f"{iid}（實作）沒有任何測試覆蓋——違反測試先行，應先補 UT/IT/E2E/VAL"})

    # ── feature 級安全工作產物存在性 gate：任一 REQ 標非 QM 即啟動；全 QM ⇒ 不觸發 ──
    nonqm = [it for it in items.values()
             if it["stage"] == "requirements"
             and it.get("asil", "").replace("ASIL-", "").strip() not in ("", "QM")]
    if nonqm:
        if not any(prefix_of(i) == "SG" for i in items):
            gaps.append({"type": "缺安全概念", "id": "FEATURE", "sev": "high",
                         "msg": "非 QM feature 但無任何 Safety Goal SG-*（缺 HARA，見 00-safety.md）"})
        if not any(prefix_of(i) == "SAN" for i in items):
            gaps.append({"type": "缺安全分析", "id": "FEATURE", "sev": "mid",
                         "msg": "非 QM feature 但無任何 SAN-*（缺 FMEA/FTA/DFA/TARA 攻擊路徑分析）"})
    return gaps, verified, implemented


def build_matrix(items: dict):
    reqs = sorted([i for i in items if items[i]["stage"] == "requirements"])
    rows = []
    for r in reqs:
        cells = {}
        for skey, _ in MATRIX_COLS:
            hit = [iid for iid, it in items.items()
                   if it["stage"] == skey and r in upstream_closure(iid, items)]
            cells[skey] = sorted(hit)
        rows.append({"req": r, "title": items[r]["title"], "cells": cells})
    return rows


DIAGRAM_RE = re.compile(r"^```mermaid\s*$")
FENCE_END_RE = re.compile(r"^```\s*$")
HEAD_RE = re.compile(r"^#{2,4}\s+(.+?)\s*$")


def _diagrams_from_lines(lines, fn: str):
    """從一組 md 行抽出內嵌 ```mermaid 圖；每張帶 SoT(檔名:起始行)與最近標題當 caption。"""
    skey, slabel, _ = stage_of(_prefix_for_file(fn))
    out, caption, i = [], fn, 0
    while i < len(lines):
        h = HEAD_RE.match(lines[i])
        if h:
            caption = h.group(1).strip()
        if DIAGRAM_RE.match(lines[i]):
            start = i + 1                       # 圍籬下一行＝圖碼起點（1-based 為 i+2）
            body = []
            i += 1
            while i < len(lines) and not FENCE_END_RE.match(lines[i]):
                body.append(lines[i]); i += 1
            out.append({"file": fn, "line": start + 1, "stage": skey,
                        "stage_label": slabel, "caption": caption,
                        "code": "\n".join(body)})
        i += 1
    return out


def extract_diagrams(sdlc_dir: str):
    """抽出各 0X.md 內嵌的 ```mermaid 圖；每張帶 SoT（檔名:起始行）與最近標題當 caption。"""
    out = []
    for root, dirs, files in os.walk(sdlc_dir):
        parts = root.split(os.sep)
        if "dashboard" in parts or ".panel" in parts:
            continue
        for fn in sorted(files):
            if not fn.endswith(".md"):
                continue
            lines = open(os.path.join(root, fn), encoding="utf-8").read().splitlines()
            out.extend(_diagrams_from_lines(lines, fn))
    return out


# ── 迭代差異時間軸（git 歷史快照 + 相鄰 diff，供 dashboard scrubber）────────
_STAGE_DOCS = ["00-safety", "01-requirements", "02-architecture", "03-tasks",
               "04-design", "05-tests", "06-impl-log", "07-review", "08-validation"]


def _git(repo: str, *args, timeout=20):
    try:
        return subprocess.run(["git", "-C", repo, *args],
                              capture_output=True, text=True, timeout=timeout)
    except Exception:
        return None


def _repo_root(path: str):
    r = _git(os.path.abspath(path), "rev-parse", "--show-toplevel")
    return r.stdout.strip() if (r and r.returncode == 0) else None


def _snapshot(reader, fname_rel):
    """以 reader(relpath)->text|None 讀各階段 doc,回 {items, diagrams}。"""
    items, diagrams = {}, {}
    for stem in _STAGE_DOCS:
        text = reader(f"{fname_rel}/{stem}.md")
        if text is None:
            continue
        lines = text.splitlines()
        for it in _parse_lines(lines, f"{stem}.md"):
            items[it["id"]] = {"stage": it["stage"], "stage_label": it["stage_label"],
                               "status": it["status"], "iter": it["iter"],
                               "title": it["title"], "traces": sorted(it["traces"])}
        seen = {}
        for d in _diagrams_from_lines(lines, f"{stem}.md"):
            key = f"{d['stage_label']} · {d['caption']}"
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:
                key = f"{key} #{seen[key]}"
            diagrams[key] = {"stage_label": d["stage_label"], "caption": d["caption"], "code": d["code"]}
    return {"items": items, "diagrams": diagrams}


def _snap_diff(prev, cur):
    """相鄰兩快照的差異:工作項 added/modified/deleted(依階段)+ 圖 changed/added/removed。"""
    pi, ci = prev["items"], cur["items"]
    added, modified, deleted = [], [], []
    for iid, it in ci.items():
        if iid not in pi:
            added.append({"id": iid, "stage_label": it["stage_label"], "title": it["title"]})
        else:
            p = pi[iid]
            ch = [f for f in ("status", "iter", "traces", "title") if p.get(f) != it.get(f)]
            if ch:
                modified.append({"id": iid, "stage_label": it["stage_label"], "title": it["title"],
                                 "changed": ch, "from": {k: p.get(k) for k in ch},
                                 "to": {k: it.get(k) for k in ch}})
    for iid, it in pi.items():
        if iid not in ci:
            deleted.append({"id": iid, "stage_label": it["stage_label"], "title": it["title"]})
    pd, cd = prev["diagrams"], cur["diagrams"]
    dia = []
    for k, d in cd.items():
        if k not in pd:
            dia.append({"key": k, "stage_label": d["stage_label"], "kind": "added", "to": d["code"], "from": ""})
        elif pd[k]["code"] != d["code"]:
            dia.append({"key": k, "stage_label": d["stage_label"], "kind": "changed", "to": d["code"], "from": pd[k]["code"]})
    for k, d in pd.items():
        if k not in cd:
            dia.append({"key": k, "stage_label": d["stage_label"], "kind": "removed", "to": "", "from": d["code"]})
    s = lambda x: (x["stage_label"], x["id"])
    return {"added": sorted(added, key=s), "modified": sorted(modified, key=s),
            "deleted": sorted(deleted, key=s), "diagrams": dia,
            "counts": {"added": len(added), "modified": len(modified),
                       "deleted": len(deleted), "diagrams": len(dia)}}


def build_timeline(sdlc_dir: str):
    """從 git 歷史(觸及 ledger md 的 commit)+ 工作目錄建迭代快照與相鄰 diff。非 git 或無歷史→None。"""
    repo = _repo_root(sdlc_dir)
    if not repo:
        return None
    rel = os.path.relpath(os.path.abspath(sdlc_dir), repo).replace(os.sep, "/")
    r = _git(repo, "log", "--reverse", "--format=%h%x09%ad%x09%s", "--date=short",
             "--", *[f"{rel}/{s}.md" for s in _STAGE_DOCS])
    revs = [ln.split("\t", 2) for ln in r.stdout.splitlines()] if (r and r.returncode == 0) else []
    snaps = []
    for parts in revs:
        if len(parts) < 3:
            continue
        short, date, msg = parts
        reader = lambda p, _rev=short: (lambda rr: rr.stdout if (rr and rr.returncode == 0) else None)(_git(repo, "show", f"{_rev}:{p}"))
        snap = _snapshot(reader, rel)
        snaps.append({"rev": short, "date": date, "msg": msg, **snap})
    # 末尾補「工作目錄(現在)」快照,含未提交變更
    def wt_reader(p):
        try:
            return open(os.path.join(repo, p), encoding="utf-8").read()
        except Exception:
            return None
    wt = _snapshot(wt_reader, rel)
    if not snaps or snaps[-1]["items"] != wt["items"] or snaps[-1]["diagrams"] != wt["diagrams"]:
        snaps.append({"rev": "working", "date": "現在", "msg": "未提交的工作目錄", **wt})
    if len(snaps) < 2:
        return None  # 需至少兩個快照才有「差異」可看
    prev = {"items": {}, "diagrams": {}}
    for sp in snaps:
        sp["diff"] = _snap_diff(prev, sp)
        prev = sp
    # 精簡 payload:items/diagrams 細節只在 diff 用得到,快照本身只留 meta + diff
    for sp in snaps:
        sp.pop("items", None)
        sp.pop("diagrams", None)
    return snaps


# 檔名 → 該階段代表前綴（供 extract_diagrams 推 stage_label）
_FILE_PREFIX = {"01": "REQ", "02": "ARCH", "03": "TASK", "04": "DES",
                "05": "UT", "06": "IMPL", "00": "ARCH", "07": "REQ"}


def _prefix_for_file(fn: str):
    return _FILE_PREFIX.get(fn[:2], "REQ")


def build_drilldown(items: dict):
    """每個 REQ 的下游溯源（需求→架構→設計→任務→程式碼→測試），每項帶 SoT 檔:行。"""
    def cite(it):
        return {"id": it["id"], "title": it["title"], "src": f'{it["file"]}:{it["line"]}',
                "file": it["file"],
                "status": it.get("status", ""), "files": it.get("files", ""),
                "result": it.get("result", "")}
    drill = {}
    for rid, r in items.items():
        if r["stage"] != "requirements":
            continue
        down = downstream_closure(rid, items)
        groups = {}
        for did in down:
            d = items.get(did)
            if not d:
                continue
            groups.setdefault(d["stage"], []).append(cite(d))
        for g in groups.values():
            g.sort(key=lambda x: x["id"])
        drill[rid] = {"id": rid, "title": r["title"], "src": f'{r["file"]}:{r["line"]}',
                      "file": r["file"], "groups": groups}
    return drill


def mermaid(items: dict, gaps):
    broken = {(g["id"]) for g in gaps if g["type"] == "斷鏈"}
    lines = ["graph LR"]
    # 子圖分階段
    order = ["requirements", "architecture", "design", "tasks", "impl", "verification"]
    by_stage = {}
    for iid, it in items.items():
        by_stage.setdefault(it["stage"], []).append((iid, it))
    for skey in order:
        if skey not in by_stage:
            continue
        label = {"requirements": "需求", "architecture": "架構", "design": "設計",
                 "tasks": "任務", "impl": "實作", "verification": "驗證"}.get(skey, skey)
        lines.append(f'  subgraph {skey}["{label}"]')
        for iid, it in sorted(by_stage[skey]):
            safe = html.escape(it["title"][:18])
            lines.append(f'    {iid.replace("-","_")}["{iid}<br/>{safe}"]')
        lines.append("  end")
    ids = set(items)
    for iid, it in items.items():
        for t in it["traces"]:
            a, b = iid.replace("-", "_"), t.replace("-", "_")
            if t not in ids:
                lines.append(f'  {a} -.->|缺| MISSING_{b}["{t} ❓"]')
            else:
                lines.append(f"  {a} --> {b}")
    # 樣式
    for iid in broken:
        lines.append(f"  style {iid.replace('-','_')} stroke:#d33,stroke-width:3px")
    return "\n".join(lines)


def render_html(sdlc_dir, items, gaps, matrix, mer, verified, implemented, diagrams, drill, timeline=None):
    total = len(items)
    by_status = {}
    for it in items.values():
        by_status[it["status"]] = by_status.get(it["status"], 0) + 1
    stages = {}
    for it in items.values():
        stages.setdefault(it["stage_label"], []).append(it)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    n_req = sum(1 for it in items.values() if it["stage"] == "requirements")
    n_unverified = sum(1 for g in gaps if g["type"] == "未驗證")
    n_mockonly = sum(1 for g in gaps if g["type"] == "未真實驗證")
    n_high = sum(1 for g in gaps if g["sev"] == "high")

    data = {"items": items, "gaps": gaps, "matrix": matrix, "mermaid": mer,
            "diagrams": diagrams, "drill": drill, "timeline": timeline,
            "stages": {k: [i["id"] for i in v] for k, v in stages.items()},
            "verified": sorted(verified), "implemented": sorted(implemented)}

    def stat_card(label, val, cls=""):
        return f'<div class="card {cls}"><div class="num">{val}</div><div class="lbl">{html.escape(label)}</div></div>'

    cards = "".join([
        stat_card("工作項總數", total),
        stat_card("需求數", n_req),
        stat_card("完成", by_status.get("done", 0), "ok"),
        stat_card("缺口", len(gaps), "warn" if gaps else "ok"),
        stat_card("嚴重缺口", n_high, "bad" if n_high else "ok"),
        stat_card("未驗證需求", n_unverified, "warn" if n_unverified else "ok"),
        stat_card("僅 mock 驗證", n_mockonly, "bad" if n_mockonly else "ok"),
    ])

    # 文件分類
    doc_html = ""
    order_lbl = ["需求", "架構", "詳細設計", "任務", "實作", "單元測試", "整合測試", "系統驗收", "其他"]
    seen_lbl = sorted(stages, key=lambda x: order_lbl.index(x) if x in order_lbl else 99)
    for lbl in seen_lbl:
        rows = ""
        for it in sorted(stages[lbl], key=lambda x: x["id"]):
            tr = ", ".join(it["traces"]) or "—"
            st = STATUS_LABEL.get(it["status"], it["status"])
            rows += (f'<tr><td class="mono">{it["id"]}</td><td>{html.escape(it["title"])}</td>'
                     f'<td><span class="pill s-{it["status"]}">{st}</span></td>'
                     f'<td class="mono small">{html.escape(tr)}</td>'
                     f'<td class="small mono"><a class="src-link" href="{html.escape(it["file"])}">{html.escape(it["file"])}:{it["line"]}</a></td></tr>')
        doc_html += (f'<h3>{html.escape(lbl)} <span class="count">{len(stages[lbl])}</span></h3>'
                     f'<table><thead><tr><th>ID</th><th>標題</th><th>狀態</th><th>追溯</th><th>來源(SoT)</th></tr></thead>'
                     f'<tbody>{rows}</tbody></table>')

    # 矩陣
    mhead = "".join(f"<th>{html.escape(l)}</th>" for _, l in MATRIX_COLS)
    mrows = ""
    for row in matrix:
        cells = ""
        for skey, _ in MATRIX_COLS:
            v = row["cells"][skey]
            if v:
                cells += f'<td class="mono small ok-cell">{html.escape(", ".join(v))}</td>'
            else:
                cells += '<td class="bad-cell">❌</td>'
        mrows += (f'<tr><td class="mono">{row["req"]}</td>'
                  f'<td class="small">{html.escape(row["title"])}</td>{cells}</tr>')
    matrix_html = (f'<table><thead><tr><th>需求</th><th>標題</th>{mhead}</tr></thead>'
                   f'<tbody>{mrows}</tbody></table>') if matrix else "<p>尚無需求項。</p>"

    # 缺口
    if gaps:
        gh = ""
        sev_lbl = {"high": "嚴重", "mid": "中", "low": "低"}
        for g in sorted(gaps, key=lambda x: {"high": 0, "mid": 1, "low": 2}[x["sev"]]):
            gh += (f'<tr><td><span class="sev sev-{g["sev"]}">{sev_lbl[g["sev"]]}</span></td>'
                   f'<td>{html.escape(g["type"])}</td><td class="mono">{g["id"]}</td>'
                   f'<td>{html.escape(g["msg"])}</td></tr>')
        gaps_html = (f'<table><thead><tr><th>嚴重度</th><th>類型</th><th>項目</th><th>說明</th></tr></thead>'
                     f'<tbody>{gh}</tbody></table>')
    else:
        gaps_html = '<p class="all-good">✅ 沒有偵測到缺口，所有追溯鏈完整。</p>'

    # 圖表（各階段內嵌 mermaid，含 SoT 來源；mermaid 原碼不 escape）
    stage_icon = {"discovery": "🔎", "requirements": "📋", "architecture": "🏛️",
                  "design": "📐", "tasks": "🔧", "impl": "💻", "verification": "✅", "other": "•"}
    if diagrams:
        order = ["discovery", "requirements", "architecture", "design", "tasks", "impl", "verification"]
        bys = {}
        for d in diagrams:
            bys.setdefault(d["stage"], []).append(d)
        dia_html = ""
        for skey in order + [k for k in bys if k not in order]:
            for d in bys.get(skey, []):
                dia_html += (f'<div class="diagram-card"><div class="dcap">{stage_icon.get(skey, "•")} '
                             f'{html.escape(d["caption"])} '
                             f'<a class="src-link" href="{html.escape(d["file"])}"><span class="src">{html.escape(d["file"])}:{d["line"]}</span></a></div>'
                             f'<div class="mermaid">{d["code"]}</div></div>')
    else:
        dia_html = ('<p class="legend">各階段文件尚未內嵌 ```mermaid 圖。在 0X.md 用對應型別加入即可在此渲染：'
                    '需求→requirementDiagram、架構→C4Container/flowchart、設計→classDiagram、'
                    '行為→sequenceDiagram/flowchart、部署→C4Deployment。</p>')

    tpl = """<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ISO-Agile SDLC 儀表板</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
:root{--bg:#0f1419;--panel:#1a2029;--line:#2c3440;--fg:#d8e0ea;--mut:#8a98a8;--ac:#4ea1ff;--ok:#3fb950;--warn:#d29922;--bad:#f85149;}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;background:var(--bg);color:var(--fg);line-height:1.5}
header{padding:20px 28px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
h1{font-size:19px;margin:0}.sub{color:var(--mut);font-size:13px}
nav{display:flex;gap:4px;padding:0 20px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
nav button{background:none;border:none;color:var(--mut);padding:13px 16px;cursor:pointer;font-size:14px;border-bottom:2px solid transparent}
nav button:hover{color:var(--fg)}nav button.on{color:var(--ac);border-bottom-color:var(--ac)}
main{padding:24px 28px;max-width:1280px}.tab{display:none}.tab.on{display:block}
.cards{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 20px;min-width:130px}
.card .num{font-size:30px;font-weight:700}.card .lbl{color:var(--mut);font-size:13px;margin-top:2px}
.card.ok .num{color:var(--ok)}.card.warn .num{color:var(--warn)}.card.bad .num{color:var(--bad)}
table{width:100%;border-collapse:collapse;margin:10px 0 26px;font-size:13.5px}
th,td{text-align:left;padding:8px 11px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}
tr:hover td{background:#ffffff06}.mono{font-family:ui-monospace,Menlo,monospace}.small{font-size:12.5px;color:var(--mut)}
h3{margin:26px 0 6px;font-size:15px}.count{color:var(--mut);font-size:12px;font-weight:400;background:var(--line);padding:1px 8px;border-radius:10px}
.pill{padding:2px 9px;border-radius:10px;font-size:12px}.s-done{background:#1c3a24;color:#5fd97a}.s-reviewed{background:#1c2f44;color:#6db3ff}
.s-draft{background:#33291a;color:#e0b25f}.s-blocked{background:#3a1d1d;color:#ff8a80}.s-unknown{background:#2a2f38;color:#9aa}
.ok-cell{background:#13301c40}.bad-cell{background:#3a1d1d50;color:var(--bad);text-align:center;font-size:16px}
.sev{padding:2px 9px;border-radius:8px;font-size:12px;font-weight:600}.sev-high{background:#3a1d1d;color:#ff7b72}.sev-mid{background:#33291a;color:#e0b25f}.sev-low{background:#23303a;color:#7fb8d8}
.all-good{color:var(--ok);font-size:16px;padding:30px;text-align:center;background:var(--panel);border-radius:10px}
.mermaid{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;overflow:auto}
.legend{color:var(--mut);font-size:12.5px;margin:6px 0 14px}
.src{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--mut);background:var(--line);padding:1px 6px;border-radius:6px;margin-left:6px}
a.src-link{color:inherit;text-decoration:none}a.src-link:hover{color:var(--ac);text-decoration:underline}a.src-link:hover .src{color:var(--ac)}
.reqbtn{display:block;width:100%;text-align:left;background:var(--panel);border:1px solid var(--line);color:var(--fg);padding:9px 12px;margin:5px 0;border-radius:8px;cursor:pointer;font-size:13.5px}
.reqbtn:hover{border-color:var(--ac);color:var(--ac)}
.diagram-card{margin:0 0 22px}.dcap{font-size:13.5px;margin:0 0 4px;font-weight:600}
#drilldetail{margin-top:18px}
.tlslider{width:100%;margin:6px 0 4px;accent-color:var(--ac)}
.tlmeta{color:var(--mut);font-size:12.5px;margin-bottom:14px}
.tlcounts{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 16px}
.tlcounts .c{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600}
.tlcols{display:flex;gap:16px;flex-wrap:wrap}.tlcol{flex:1;min-width:240px}.tlcol h4{margin:6px 0;font-size:14px}
.diffitem{font-size:13px;padding:5px 9px;margin:4px 0;border-radius:6px;border:1px solid var(--line)}
.di-add{background:#13301c55}.di-mod{background:#33291a55}.di-del{background:#3a1d1d55}
.dia-change{margin:16px 0;border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel)}
.dia-ba{display:flex;gap:14px;flex-wrap:wrap}.dia-ba>div{flex:1;min-width:280px}
</style></head><body>
<header><h1>🔁 ISO-Agile SDLC 儀表板</h1><span class="sub">__DIR__ · 產生於 __NOW__</span></header>
<nav>
<button class="on" data-t="ov">概覽</button><button data-t="docs">文件</button>
<button data-t="mx">追溯矩陣</button><button data-t="trace">溯源</button><button data-t="dia">圖表</button>
<button data-t="tl">迭代差異</button><button data-t="gr">追溯圖</button><button data-t="gp">缺口</button>
</nav>
<main>
<section id="ov" class="tab on"><div class="cards">__CARDS__</div>
<p class="legend">概覽匯總所有階段產出與追溯健康度。切到各分頁查看細節；「缺口」頁列出所有斷鏈、孤兒、未驗證/未實作的需求。</p></section>
<section id="docs" class="tab"><p class="legend">依階段分門別類列出所有工作項與其狀態、追溯關係。</p>__DOCS__</section>
<section id="mx" class="tab"><p class="legend">追溯矩陣：每列一個需求，欄位顯示哪些下游產出回應了它。❌ 代表該階段沒有任何產出對應此需求（缺口）。</p>__MATRIX__</section>
<section id="trace" class="tab"><p class="legend">點一個需求看它的完整溯源（→架構→設計→任務→程式碼→測試）。每一項都標來源 <span class="src">檔:行</span> 可回 md 驗證真實性。</p>
<div id="reqlist"></div><div id="drilldetail"></div></section>
<section id="dia" class="tab"><p class="legend">各階段內嵌的 UML/流程圖（文字描述為主、圖為輔），每張標來源 <span class="src">檔:行</span>。需求→用例/需求圖、架構→容器圖、設計→類別圖、行為→循序/活動圖、部署→部署圖。</p>__DIAGRAMS__</section>
<section id="tl" class="tab"><p class="legend">迭代差異：拖動下方的時間軸，看每一次迭代（git 提交 → 工作目錄）相對前一次的變化——需求/架構/任務/設計/測試/實作的<b style="color:var(--ok)">新增</b>·<b style="color:var(--warn)">修改</b>·<b style="color:var(--bad)">刪除</b>，以及流程圖/各種圖的差異（含前後對照）。</p>
<div id="tlbar"></div><div id="tlbody"></div></section>
<section id="gr" class="tab"><p class="legend">追溯圖：箭頭代表「下游產出 → 它所回應的上游」。紅框＝斷鏈。可滾動縮放。</p>
<div class="mermaid">__MERMAID__</div></section>
<section id="gp" class="tab"><p class="legend">一致性檢查結果。嚴重缺口（斷鏈、孤兒）應優先處理。</p>__GAPS__</section>
</main>
<script>
const D=__DATA__;
mermaid.initialize({startOnLoad:false,theme:'dark',securityLevel:'loose'});
// 逐張用 mermaid.render() 產生 svg 再注入,且只在分頁可見時渲染。
// 不用 startOnLoad/mermaid.run:隱藏(display:none)分頁裡的圖量不到尺寸,dagre 佈局會算出
// translate(NaN)、渲染成空白或「Syntax error」炸彈(實為渲染期失敗,非語法錯)。
async function renderTab(id){
 const tab=document.getElementById(id); if(!tab) return;
 const nodes=[...tab.querySelectorAll('.mermaid:not([data-processed])')];
 for(let k=0;k<nodes.length;k++){
  const el=nodes[k]; el.setAttribute('data-processed','true');
  const src=el.textContent.trim();
  try{ const {svg}=await mermaid.render('mmd_'+id+'_'+k,src); el.innerHTML=svg; }
  catch(e){ el.innerHTML='<pre style="color:#f88;white-space:pre-wrap">圖渲染失敗：'+(e&&e.message||e)+'</pre>'; }
 }
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));
 document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
 b.classList.add('on');
 const id=b.dataset.t;
 document.getElementById(id).classList.add('on');
 renderTab(id);
 if(id==='tl'&&window.__tlOpen)window.__tlOpen();
});
// 溯源 drill-down（文字/表格/圖示，每項標 SoT 檔:行）
const ICON={requirements:'📋',architecture:'🏛️',design:'📐',tasks:'🔧',impl:'💻',verification:'✅',discovery:'🔎'};
const SLBL={requirements:'需求',architecture:'架構',design:'設計',tasks:'任務',impl:'實作',verification:'驗證',discovery:'探索'};
const DORDER=['architecture','design','tasks','impl','verification'];
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function showDrill(rid){
 const r=D.drill[rid];const d=document.getElementById('drilldetail');if(!r){d.innerHTML='';return;}
 let h=`<h3>📋 ${esc(r.id)} — ${esc(r.title)} <a class="src-link" href="${esc(r.file)}"><span class="src">${esc(r.src)}</span></a></h3>`;
 h+='<table><thead><tr><th>階段</th><th>ID</th><th>標題</th><th>狀態/結果</th><th>程式碼 / 來源(SoT)</th></tr></thead><tbody>';
 let any=false;
 DORDER.forEach(sk=>(r.groups[sk]||[]).forEach(it=>{any=true;
  const files=it.files?esc(it.files)+' · ':'';const sr=it.result?esc(it.result):esc(it.status||'');
  h+=`<tr><td>${ICON[sk]||'•'} ${SLBL[sk]||sk}</td><td class="mono">${esc(it.id)}</td><td>${esc(it.title)}</td><td class="small">${sr}</td><td class="small mono">${files}<a class="src-link" href="${esc(it.file)}">${esc(it.src)}</a></td></tr>`;
 }));
 h+='</tbody></table>';if(!any)h+='<p class="legend">此需求尚無下游產出（未實作/未驗證）。</p>';
 d.innerHTML=h;
}
(function(){const rl=document.getElementById('reqlist');if(!rl)return;
 const reqs=Object.values(D.drill||{});
 rl.innerHTML=reqs.length?reqs.map(r=>`<button class="reqbtn" data-r="${esc(r.id)}">📋 ${esc(r.id)} — ${esc(r.title)}</button>`).join(''):'<p class="legend">尚無需求項。</p>';
 rl.querySelectorAll('.reqbtn').forEach(b=>b.onclick=()=>showDrill(b.dataset.r));
})();
// 迭代差異 scrubber：拖動時間軸看每次迭代(git 提交→工作目錄)相對前一次的 add/mod/del + 圖差異
(function(){
 const tl=D.timeline, bar=document.getElementById('tlbar'), body=document.getElementById('tlbody');
 if(!bar) return;
 if(!tl||!tl.length){ bar.innerHTML='<p class="legend">需要 git 歷史才能比較迭代差異（此 workspace 尚非 git repo，或 ledger 文件尚無提交歷史）。在 repo 根 <span class="mono">git init</span> 並提交各階段文件後，重跑 trace 即可在此拖動比較。</p>'; return; }
 bar.innerHTML='<input type="range" class="tlslider" min="0" max="'+(tl.length-1)+'" value="'+(tl.length-1)+'" id="tlrange"><div class="tlmeta" id="tlmeta"></div>';
 const rng=document.getElementById('tlrange'), meta=document.getElementById('tlmeta');
 const byStage=arr=>{const m={};arr.forEach(x=>{(m[x.stage_label]=m[x.stage_label]||[]).push(x)});return m;};
 function col(title,cls,arr,render){let h='<div class="tlcol"><h4>'+title+' ('+arr.length+')</h4>';
  if(!arr.length){h+='<p class="legend">—</p>';}else{const m=byStage(arr);
   Object.keys(m).sort().forEach(sl=>{h+='<div class="small" style="margin-top:8px">'+esc(sl)+'</div>';
    m[sl].forEach(x=>h+='<div class="diffitem '+cls+'">'+render(x)+'</div>');});}
  return h+'</div>';}
 async function renderDia(c){const ns=[...c.querySelectorAll('.mermaid:not([data-processed])')];
  for(let k=0;k<ns.length;k++){const el=ns[k];el.setAttribute('data-processed','true');const src=el.textContent.trim();
   if(!src){el.innerHTML='<span class="legend">（無此圖）</span>';continue;}
   try{const {svg}=await mermaid.render('tld_'+k+'_'+Math.floor(performance.now()),src);el.innerHTML=svg;}
   catch(e){el.innerHTML='<pre style="color:#f88;white-space:pre-wrap">'+esc(src)+'</pre>';}}}
 function show(i){const s=tl[i],d=s.diff;
  meta.innerHTML='第 '+(i+1)+'/'+tl.length+' 個快照 · <span class="mono">'+esc(s.rev)+'</span> · '+esc(s.date)+' · '+esc(s.msg);
  let h='<div class="tlcounts"><span class="c" style="color:var(--ok)">＋新增 '+d.counts.added+'</span><span class="c" style="color:var(--warn)">～修改 '+d.counts.modified+'</span><span class="c" style="color:var(--bad)">－刪除 '+d.counts.deleted+'</span><span class="c">⬚ 圖變更 '+d.counts.diagrams+'</span></div>';
  if(!(d.counts.added||d.counts.modified||d.counts.deleted||d.counts.diagrams)){body.innerHTML=h+'<p class="legend">此快照與前一個相比沒有差異。</p>';return;}
  h+='<div class="tlcols">';
  h+=col('新增','di-add',d.added,x=>'<span class="mono">'+esc(x.id)+'</span> '+esc(x.title));
  h+=col('修改','di-mod',d.modified,x=>'<span class="mono">'+esc(x.id)+'</span> '+esc(x.title)+'<div class="small">'+x.changed.map(f=>esc(f)+': '+esc(JSON.stringify(x.from[f]))+' → '+esc(JSON.stringify(x.to[f]))).join('；')+'</div>');
  h+=col('刪除','di-del',d.deleted,x=>'<span class="mono">'+esc(x.id)+'</span> '+esc(x.title));
  h+='</div>';
  if(d.diagrams.length){h+='<h3>圖的差異（前 → 後）</h3>';d.diagrams.forEach(g=>{
   const lbl=g.kind==='added'?'新增':g.kind==='removed'?'刪除':'修改',pc=g.kind==='added'?'s-done':g.kind==='removed'?'s-blocked':'s-draft';
   h+='<div class="dia-change"><div class="dcap">'+esc(g.stage_label)+' · '+esc(g.key)+' <span class="pill '+pc+'">'+lbl+'</span></div>'+
      '<div class="dia-ba"><div><div class="small">之前</div><div class="mermaid">'+esc(g.from)+'</div></div>'+
      '<div><div class="small">之後</div><div class="mermaid">'+esc(g.to)+'</div></div></div></div>';});}
  body.innerHTML=h; if(document.getElementById('tl').classList.contains('on')) renderDia(body);
 }
 window.__tlOpen=()=>renderDia(body);   // 切到此分頁時才渲染圖(隱藏時 mermaid 量不到尺寸)
 rng.oninput=()=>show(+rng.value); show(tl.length-1);
})();
renderTab((document.querySelector('.tab.on')||{}).id||'ov'); // 初始可見分頁若含圖也渲染
</script>
</body></html>"""
    out = (tpl.replace("__DIR__", html.escape(os.path.abspath(sdlc_dir)))
              .replace("__NOW__", now)
              .replace("__CARDS__", cards)
              .replace("__DOCS__", doc_html or "<p>尚無產出文件。</p>")
              .replace("__MATRIX__", matrix_html)
              .replace("__DIAGRAMS__", dia_html)
              .replace("__MERMAID__", mer)
              .replace("__GAPS__", gaps_html)
              .replace("__DATA__", json.dumps(data, ensure_ascii=False)))
    return out


def _features_base(root: str):
    """放 feature 的父目錄：新版 <root>/.sdlc/features、舊版 <root>/features，否則 <root>。"""
    for cand in (os.path.join(root, ".sdlc", "features"),
                 os.path.join(root, "features")):
        if os.path.isdir(cand):
            return cand
    return root


def _docs_dir(feature_dir: str):
    """某 feature 的文件目錄：新版＝feature_dir 本身；舊版＝feature_dir/sdlc。"""
    sub = os.path.join(feature_dir, "sdlc")
    return sub if os.path.isdir(sub) else feature_dir


def _is_feature(feature_dir: str):
    """是否為 feature 工作區：含 sdlc/（舊）或直接含 state.yaml / 01-requirements.md（新）。"""
    if os.path.isdir(os.path.join(feature_dir, "sdlc")):
        return True
    return any(os.path.isfile(os.path.join(feature_dir, f))
               for f in ("state.yaml", "01-requirements.md"))


def _feature_dirs(root: str):
    """回傳所有 feature 的 (name, feature_dir, docs_dir)；支援新(.sdlc/features)與舊(features)版面。"""
    base = _features_base(root)
    feats = []
    if os.path.isdir(base):
        for name in sorted(os.listdir(base)):
            d = os.path.join(base, name)
            if os.path.isdir(d) and _is_feature(d):
                feats.append((name, d, _docs_dir(d)))
    return feats


def _impl_files(docs_dir: str):
    """從某 feature 文件目錄的 06-impl-log.md 取出 [(IMPL-id, [檔案路徑]), …]。"""
    log = os.path.join(docs_dir, "06-impl-log.md")
    if not os.path.isfile(log):
        return []
    out = []
    for it in parse_file(log):
        if it["stage"] == "impl" and it["files"]:
            paths = [p.strip() for p in it["files"].split(",") if p.strip()]
            if paths:
                out.append((it["id"], paths))
    return out


def check_feature_split(root: str):
    """工作區層級偵測：同一份 code 被拆到不同 feature → 切斷 ISO 26262 單一追溯鏈。

    規則：把每個 feature 的 IMPL `files:` 正規化成 features/<owner>/… 路徑——
      - owner ≠ 該 feature 本身  → 「跨 feature 認領」（多半是『迭代』被誤開成新 feature）
      - 同一檔被 ≥2 個 feature 認領 → 「共用檔重疊」（追溯鏈分裂）
    回傳 (feature 清單, gaps)。
    """
    feats = _feature_dirs(root)
    gaps, owners, cross = [], {}, {}
    for fname, fdir, ddir in feats:
        for impl_id, paths in _impl_files(ddir):
            for p in paths:
                idx = p.find("features/")
                if idx >= 0:
                    # 舊版面：路徑帶 features/<owner>/… → 可由路徑判定擁有者
                    norm = p[idx:]
                    rest = norm[len("features/"):]
                    owner = rest.split("/")[0] if "/" in rest else fname
                else:
                    # 新版面：IMPL files: 指向共用產品根（如 src/foo.py）→ 路徑本身即正規化鍵，
                    # 不前綴 fname，兩個 feature 寫到同一產品檔才會在 owners 撞鍵（共用檔重疊）。
                    norm = p.lstrip("./")
                    owner = fname
                owners.setdefault(norm, set()).add(fname)
                if owner != fname:  # 聚合成「每對 feature 一筆」，避免逐檔洗版
                    c = cross.setdefault((fname, owner), {"impls": set(), "files": set()})
                    c["impls"].add(impl_id)
                    c["files"].add(norm)
    for (fname, owner), c in sorted(cross.items()):
        sample = sorted(c["files"])[0]
        gaps.append({"sev": "high", "type": "跨 feature 認領",
                     "msg": f"{fname} 的 {len(c['impls'])} 個 IMPL（{', '.join(sorted(c['impls']))}）"
                            f"寫入 {owner} 的樹（{len(c['files'])} 個檔，如 {sample}）"
                            f" → 這多半是 {owner} 的『迭代』而非新 feature；同一份 code 拆成兩個"
                            f" feature 會切斷 ISO 26262 單一追溯鏈。建議收編回 {owner}"
                            f"（在其 sdlc/ 續做、bump iter:、跑 --impact），勿另開資料夾。"})
    for norm, fs in sorted(owners.items()):
        if len(fs) > 1:
            gaps.append({"sev": "high", "type": "共用檔重疊",
                         "msg": f"{norm} 同時被 {', '.join(sorted(fs))} 認領"
                                f" → 一份 code 被多個 feature 追溯，鏈分裂；應合併為單一 feature 的迭代。"})
    return feats, gaps


def _feature_summary(name: str, ddir: str):
    """掃描單一 feature，回傳摘要並重建它的單檔 dashboard.html（與文件同層，SoT 可點）。"""
    items = scan(ddir)
    gaps, verified, implemented = analyze(items)
    matrix = build_matrix(items)
    mer = mermaid(items, gaps)
    diagrams = extract_diagrams(ddir)
    drill = build_drilldown(items)
    timeline = build_timeline(ddir)
    with open(os.path.join(ddir, "dashboard.html"), "w", encoding="utf-8") as f:
        f.write(render_html(ddir, items, gaps, matrix, mer, verified, implemented, diagrams, drill, timeline))
    return {"name": name, "docs": ddir, "items": len(items),
            "reqs": sum(1 for it in items.values() if it["stage"] == "requirements"),
            "gaps": len(gaps), "high": sum(1 for g in gaps if g["sev"] == "high")}


def render_index(index_out: str, summ, split_gaps):
    """工作區索引頁：列出每個 feature（連到其 dashboard 與 01-requirements.md）＋跨 feature 斷鏈。"""
    base_dir = os.path.dirname(os.path.abspath(index_out))
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    rows = ""
    for s in summ:
        rel = os.path.relpath(os.path.abspath(s["docs"]), base_dir)
        dash = html.escape(os.path.join(rel, "dashboard.html"))
        req = html.escape(os.path.join(rel, "01-requirements.md"))
        sev = "high" if s["high"] else ("mid" if s["gaps"] else "low")
        rows += (f'<tr><td class="mono"><a href="{dash}">{html.escape(s["name"])}</a></td>'
                 f'<td>{s["items"]}</td><td>{s["reqs"]}</td>'
                 f'<td><span class="sev sev-{sev}">{s["gaps"]}</span></td>'
                 f'<td class="small"><a href="{dash}">dashboard</a> · <a href="{req}">文件</a></td></tr>')
    if split_gaps:
        sg = "".join(f'<tr><td>{html.escape(g["type"])}</td><td>{html.escape(g["msg"])}</td></tr>'
                     for g in split_gaps)
        split_html = (f'<h3>跨 feature 斷鏈 <span class="count">{len(split_gaps)}</span></h3>'
                      f'<table><thead><tr><th>類型</th><th>說明</th></tr></thead><tbody>{sg}</tbody></table>')
    else:
        split_html = '<p class="all-good">✅ 無跨 feature 斷鏈（每個 feature 各自擁有自己的 src 樹）</p>'
    return f"""<!DOCTYPE html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ISO-Agile SDLC 索引</title>
<style>
:root{{--bg:#0f1419;--panel:#1a2029;--line:#2c3440;--fg:#d8e0ea;--mut:#8a98a8;--ac:#4ea1ff;--ok:#3fb950;}}
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;background:var(--bg);color:var(--fg);line-height:1.5}}
header{{padding:20px 28px;border-bottom:1px solid var(--line)}}h1{{font-size:19px;margin:0}}.sub{{color:var(--mut);font-size:13px}}
main{{padding:24px 28px;max-width:1100px}}
a{{color:var(--ac);text-decoration:none}}a:hover{{text-decoration:underline}}
table{{width:100%;border-collapse:collapse;margin:10px 0 26px;font-size:13.5px}}
th,td{{text-align:left;padding:8px 11px;border-bottom:1px solid var(--line);vertical-align:top}}
th{{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.4px}}
tr:hover td{{background:#ffffff06}}.mono{{font-family:ui-monospace,Menlo,monospace}}.small{{font-size:12.5px;color:var(--mut)}}
h3{{margin:26px 0 6px;font-size:15px}}.count{{color:var(--mut);font-size:12px;background:var(--line);padding:1px 8px;border-radius:10px}}
.sev{{padding:2px 9px;border-radius:8px;font-size:12px;font-weight:600}}.sev-high{{background:#3a1d1d;color:#ff7b72}}.sev-mid{{background:#33291a;color:#e0b25f}}.sev-low{{background:#23303a;color:#7fb8d8}}
.all-good{{color:var(--ok);font-size:15px;padding:24px;text-align:center;background:var(--panel);border-radius:10px}}
</style></head><body>
<header><h1>🔁 ISO-Agile SDLC 索引</h1><span class="sub">{html.escape(base_dir)} · 產生於 {now} · 點 feature 進各自的追溯儀表板/文件</span></header>
<main>
<h3>Features <span class="count">{len(summ)}</span></h3>
<table><thead><tr><th>Feature</th><th>工作項</th><th>需求</th><th>缺口</th><th>入口</th></tr></thead><tbody>{rows or '<tr><td colspan=5 class="small">尚無 feature</td></tr>'}</tbody></table>
{split_html}
</main></body></html>"""


def _workspace_index(root: str, feats, split_gaps):
    """重建每個 feature 的 dashboard，並在 .sdlc/（或 features 父層）寫一個索引 dashboard.html。"""
    if not feats:
        return None
    base = _features_base(root)
    parent = os.path.dirname(base) if os.path.basename(base) == "features" else base
    index_out = os.path.join(parent, "dashboard.html")
    summ = [_feature_summary(n, ddir) for n, _fdir, ddir in feats]
    os.makedirs(os.path.dirname(os.path.abspath(index_out)), exist_ok=True)
    with open(index_out, "w", encoding="utf-8") as f:
        f.write(render_index(index_out, summ, split_gaps))
    return index_out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sdlc_dir", nargs="?")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--check", action="store_true", help="有缺口則 exit 1")
    ap.add_argument("--impact", metavar="ID", default=None,
                    help="影響分析：列出某項目改動時需連帶更新的上下游（迭代維護用）")
    ap.add_argument("--features", metavar="DIR", default=None,
                    help="工作區層級偵測：掃 DIR（或 DIR/features）下所有 feature，"
                         "找出『同一份 code 被拆到不同 feature』的斷鏈（iteration 誤開成新 feature）")
    a = ap.parse_args()

    # 工作區層級 feature 斷鏈偵測（不需單一 sdlc_dir）
    if a.features is not None:
        feats, fgaps = check_feature_split(a.features)
        print(f"■ 工作區 feature 追溯偵測：掃 {len(feats)} 個 feature"
              f"（{', '.join(n for n, _, _ in feats) or '無'}）")
        index_out = _workspace_index(a.features, feats, fgaps)   # 重建各 feature dashboard + 工作區索引
        if index_out:
            print(f"✓ 工作區索引（SDLC 入口）：{index_out}")
        if not fgaps:
            print("  ✅ 未發現跨 feature 斷鏈（每個 feature 各自擁有自己的 src 樹）")
        else:
            for g in fgaps:
                print(f"  [{g['type']}] {g['msg']}")
            print(f"\n  共 {len(fgaps)} 個跨 feature 斷鏈警示——"
                  f"同一份 code 應以單一 feature 的迭代（iter: v2…）維護，而非新資料夾。")
        if a.check and fgaps:
            sys.exit(1)
        return

    if not a.sdlc_dir:
        ap.error("需要 <sdlc目錄>，或改用 --features <DIR> 做工作區層級偵測")
    if not os.path.isdir(a.sdlc_dir):
        print(f"找不到目錄: {a.sdlc_dir}", file=sys.stderr)
        sys.exit(2)

    items = scan(a.sdlc_dir)

    if a.impact:
        tid = a.impact.strip().upper()
        if tid not in items:
            print(f"找不到項目 {tid}", file=sys.stderr)
            sys.exit(2)
        up = upstream_closure(tid, items)
        down = downstream_closure(tid, items)
        print(f"■ 影響分析：{tid} — {items[tid]['title']}")
        print(f"\n  ↑ 上游（此項目所依據，改動前先確認沒矛盾）：")
        for i in sorted(up) or []:
            print(f"      {i:<10} {items.get(i,{}).get('title','(不存在)')}")
        if not up:
            print("      （無）")
        print(f"\n  ↓ 下游（追溯到此項目，改動後必須連帶更新文件＋程式碼＋測試）：")
        for i in sorted(down) or []:
            print(f"      {i:<10} {items.get(i,{}).get('title','(不存在)')}")
        if not down:
            print("      （無）")
        print(f"\n  共 {len(up)+len(down)} 個關聯項目需在本次迭代一併檢視。")
        return
    gaps, verified, implemented = analyze(items)
    matrix = build_matrix(items)
    mer = mermaid(items, gaps)
    diagrams = extract_diagrams(a.sdlc_dir)
    drill = build_drilldown(items)
    timeline = build_timeline(a.sdlc_dir)

    out = a.out or os.path.join(a.sdlc_dir, "dashboard.html")   # 單檔，與文件同層 → SoT 連結可直接點開
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(render_html(a.sdlc_dir, items, gaps, matrix, mer, verified, implemented, diagrams, drill, timeline))

    print(f"✓ 掃描 {len(items)} 個工作項，偵測 {len(gaps)} 個缺口")
    print(f"✓ 儀表板已輸出: {out}")
    if a.check and gaps:
        print("✗ 有缺口，gate 未通過", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
