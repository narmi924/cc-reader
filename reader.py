"""Read Claude Code's local project transcripts through a loopback web server."""

import argparse
import hashlib
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import webbrowser
from contextlib import closing, contextmanager
from datetime import datetime
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PureWindowsPath
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen


ROOT = (Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude").expanduser() / "projects").resolve()
APP = Path(__file__).resolve().parent
PORT = 48763
ASSETS = {
    "/reader.ico": ("reader.ico", "image/x-icon"),
    "/": ("index.html", "text/html"),
    "/app.js": ("app.js", "text/javascript"),
    "/style.css": ("style.css", "text/css"),
    "/markdown-it.min.js": ("markdown-it.min.js", "text/javascript"),
}


def snippet(value, limit=100):
    return " ".join(str(value or "")[:limit * 3].split())[:limit]


def epoch(timestamp):
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


@lru_cache(maxsize=1024)
def session_header(path, size, modified):
    titles = {}
    cwd = ""
    # Copied or synced transcripts get new file times. The last record keeps the real one.
    last = None
    with path.open("rb") as stream:
        # The directory is encoded ambiguously. Read the original cwd from a record.
        for line in stream:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            cwd = cwd or row.get("cwd", "")
            if row.get("type") == "user" and not row.get("isMeta"):
                content = row.get("message", {}).get("content")
                if isinstance(content, list):
                    content = next((b.get("text") for b in content if isinstance(b, dict) and b.get("type") == "text"), "")
                if content:
                    titles.setdefault("prompt", snippet(content))
            if cwd and ("prompt" in titles or stream.tell() > 256_000):
                break
        stream.seek(max(0, size - 131072))
        if stream.tell():
            stream.readline()
        for line in stream:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            for key in ("customTitle", "aiTitle", "summary", "lastPrompt"):
                if isinstance(row.get(key), str) and row[key].strip():
                    titles[key] = snippet(row[key], 160)
            last = epoch(row.get("timestamp")) or last
    title = next((titles[k] for k in ("customTitle", "aiTitle", "prompt", "summary", "lastPrompt") if titles.get(k)), path.stem)
    return dict(id=path.relative_to(ROOT).as_posix(), cwd=cwd, title=title, date=last or modified / 1e9, size=size)


def catalog():
    groups = {}
    for path in ROOT.glob("*/*.jsonl"):
        if not path.resolve().is_relative_to(ROOT):
            continue
        try:
            stat = path.stat()
            item = session_header(path, stat.st_size, stat.st_mtime_ns)
        except FileNotFoundError:
            continue
        groups.setdefault(path.parent.name, []).append(item)
    projects = []
    for folder, sessions in groups.items():
        sessions.sort(key=lambda s: s["date"], reverse=True)
        cwd = next((s["cwd"] for s in sessions if s["cwd"]), folder)
        projects.append(dict(id=folder, path=cwd, name=PureWindowsPath(cwd).name or cwd, sessions=sessions))
    return sorted(projects, key=lambda p: p["sessions"][0]["date"], reverse=True)


def transcript_path(key):
    path = (ROOT / key).resolve()
    parts = path.relative_to(ROOT.resolve()).parts
    if path.suffix != ".jsonl" or not (len(parts) == 2 or len(parts) >= 4 and parts[2] == "subagents"):
        raise ValueError("Invalid transcript path")
    return path


def subagents(path):
    agents = []
    if path.parent.parent != ROOT:
        return agents
    for file in sorted((path.with_suffix("") / "subagents").rglob("*.jsonl")):
        if not file.resolve().is_relative_to(ROOT):
            continue
        try:
            metadata = file.with_suffix(".meta.json").resolve()
            meta = json.loads(metadata.read_bytes()) if metadata.is_relative_to(ROOT) else {}
        except (OSError, ValueError):
            meta = {}
        agents.append(dict(id=file.relative_to(ROOT).as_posix(), name=meta.get("description") or meta.get("agentType") or file.stem,
                           kind=meta.get("agentType", ""), tool=meta.get("toolUseId", "")))
    return agents


def blocks(row):
    content = row.get("message", {}).get("content", [])
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return content if isinstance(content, list) else [content]


def queued_message(attachment):
    origin = attachment.get("origin") or {}
    return (attachment.get("type") == "queued_command" and attachment.get("prompt") and not attachment.get("isMeta")
            and not (isinstance(origin, dict) and origin.get("kind") == "task-notification"))


def context_message(row):
    return row.get("isMeta") or row.get("isCompactSummary") or row.get("type") == "user" and row.get("promptSource") == "system"


def transcript(path):
    events, calls = [], {}
    skipped = 0
    with path.open("rb") as stream:
        revision = str(os.fstat(stream.fileno()).st_mtime_ns)
        for line in stream:
            at = stream.tell() - len(line)
            try:
                row = json.loads(line)
            except ValueError:
                skipped += 1
                continue
            role = row.get("type")
            time = row.get("timestamp", "")
            if role in ("attachment", "system", "progress", "summary"):
                attachment = row.get("attachment") or {}
                label = attachment.get("type") or row.get("subtype") or role
                if queued_message(attachment):
                    events.append(dict(role="user", kind="queued", at=at, time=time, label="Queued message"))
                else:
                    events.append(dict(role="context", kind="record", at=at, time=time, label=label))
                continue
            if role not in ("user", "assistant"):
                continue
            for index, value in enumerate(blocks(row)):
                b = value if isinstance(value, dict) else {"type": "data"}
                kind = b.get("type", "data")
                e = dict(role=role, kind=kind, at=at, index=index, time=time)
                if kind == "tool_result":
                    call = calls.get(b.get("tool_use_id"))
                    if call is not None:
                        call.setdefault("results", []).append(e)
                        call["error"] = call.get("error", False) or bool(b.get("is_error"))
                        continue
                    e.update(role="assistant", label="Tool result")
                elif kind in ("tool_use", "server_tool_use"):
                    inp = b.get("input") or {}
                    e.update(label=b.get("name", "Tool"), tool=b.get("id"), hint=snippet(next((inp[k] for k in (
                        "description", "file_path", "pattern", "command", "query", "url", "prompt"
                    ) if isinstance(inp, dict) and inp.get(k)), "")))
                    if b.get("id"):
                        calls[b["id"]] = e
                elif kind == "text":
                    value = b.get("text", "")
                    if context_message(row):
                        e.update(role="context", label="Session summary" if row.get("isCompactSummary") else "Context message")
                    elif len(value) > 16000:
                        e["preview"] = value[:1000]
                    else:
                        e["text"] = value
                    if role == "assistant" and row["message"].get("stop_reason"):
                        e["stopReason"] = row["message"]["stop_reason"]
                elif kind == "thinking":
                    e["label"] = "Thinking"
                events.append(e)
    return dict(events=events, agents=subagents(path), skipped=skipped, revision=revision)


def saved_outputs(path, content):
    parts = path.relative_to(ROOT).parts
    session_id = path.stem if len(parts) == 2 else parts[1]
    directory = (ROOT / parts[0] / session_id / "tool-results").resolve()
    outputs = []
    for value in content if isinstance(content, list) else [content]:
        text = value.get("text") if isinstance(value, dict) else value
        if not isinstance(text, str) or not text.startswith("<persisted-output>"):
            continue
        match = re.search(r"Full output saved to:\s*([^\r\n]+)", text[:4096])
        if match:
            file = Path(match[1].strip()).resolve()
            if file.parent == directory and directory.is_relative_to(ROOT) and file.is_file():
                outputs.append(file)
    return outputs


def detail(path, at, index, part=None):
    with path.open("rb") as stream:
        stream.seek(at)
        row = json.loads(stream.readline())
    role = row.get("type")
    if role in ("assistant", "user"):
        block = blocks(row)[index]
        if isinstance(block, dict) and block.get("type") == "tool_result":
            if part == "structured":
                return row.get("toolUseResult")
            files = saved_outputs(path, block.get("content"))
            if part is not None:
                return files[int(part)].read_text(encoding="utf-8-sig", errors="replace")
            return {**block, "savedFiles": [f.name for f in files], "structured": "toolUseResult" in row}
        return block
    if role == "attachment":
        return row.get("attachment")
    if role in ("system", "progress", "summary"):
        return row.get("content") or row.get("data") or row.get("summary") or row
    raise ValueError("Invalid message offset")


def search_database(root):
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Caches"
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    key = hashlib.sha256(os.fsencode(os.path.normcase(str(root)))).hexdigest()[:24]
    return base / "claude-session-reader" / key / "search.sqlite3"


SEARCH_DB = search_database(ROOT)
index_status = "building"
index_lock = threading.Lock()
stopping = threading.Event()
generated_text = re.compile(r"<(local-command-stdout|local-command-stderr|local-command-caveat|task-notification|system-reminder)\b[^>]*>.*?</\1>", re.S)


def search_blocks(row):
    role = row.get("type")
    if role == "attachment" and queued_message(row.get("attachment") or {}):
        prompt = row["attachment"]["prompt"]
        text = prompt if isinstance(prompt, str) else "\n".join(b["text"] for b in prompt if isinstance(b, dict) and b.get("type") == "text")
        yield 0, "user", text
    elif role in ("user", "assistant") and not context_message(row):
        for index, block in enumerate(blocks(row)):
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                yield index, role, block["text"]


def init_search():
    with closing(sqlite3.connect(SEARCH_DB)) as db:
        # The index is a cache. Rebuild it when its layout changes.
        if db.execute("PRAGMA user_version").fetchone()[0] != 2:
            db.executescript("DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS sources;")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS sources (
                path TEXT PRIMARY KEY, project TEXT, parent TEXT, identity TEXT,
                size INTEGER, modified INTEGER, position INTEGER, tail BLOB, line INTEGER);
            CREATE TABLE IF NOT EXISTS messages (
                path TEXT, at INTEGER, idx INTEGER, role TEXT, body TEXT, line INTEGER,
                PRIMARY KEY (path, at, idx));
            PRAGMA user_version = 2;
        """)


def sync_search(project="", file=""):
    if project and (ROOT / project).resolve().parent != ROOT:
        raise ValueError("Invalid project")
    where, args = search_scope(project, file)
    with index_lock, closing(sqlite3.connect(SEARCH_DB, timeout=60)) as db, db:
        db.execute("BEGIN IMMEDIATE")
        known = {r[0]: r[1:] for r in db.execute("SELECT path,identity,size,modified,position,tail,line FROM sources" + where, args)}
        if file:
            paths = [transcript_path(file)]
        else:
            base = ROOT / project
            prefix = "" if project else "*/"
            paths = [*base.glob(prefix + "*.jsonl"), *base.glob(prefix + "*/subagents/**/*.jsonl")]
        for path in paths:
            key = path.relative_to(ROOT).as_posix()
            try:
                st = path.stat()
                old = known.get(key)
                ident = str(st.st_ino)
                if old and old[:3] == (ident, st.st_size, st.st_mtime_ns):
                    del known[key]
                    continue
                # Resolving every path is slow on Windows, so only check files that need reading.
                if not path.resolve().is_relative_to(ROOT):
                    continue
                with path.open("rb") as fp:
                    st = os.fstat(fp.fileno())
                    ident = str(st.st_ino)
                    pos = lines = 0
                    if old and ident == old[0] and st.st_size > old[1]:
                        fp.seek(old[3] - len(old[4]))
                        if fp.read(len(old[4])) == old[4]:
                            pos, lines = old[3], old[5]
                    if not pos:
                        db.execute("DELETE FROM messages WHERE path=?", (key,))
                    fp.seek(pos)
                    while pos < st.st_size:
                        if stopping.is_set():
                            raise InterruptedError("Reader closed")
                        record = fp.readline(st.st_size - pos)
                        if not record.endswith(b"\n"):
                            break
                        at, pos = pos, fp.tell()
                        lines += 1
                        try:
                            row = json.loads(record)
                        except ValueError:
                            continue
                        for idx, role, text in search_blocks(row):
                            body = generated_text.sub("", text) if role == "user" else text
                            if body.strip():
                                # SQLite TEXT must be valid UTF-8, even for malformed pasted Unicode.
                                db.execute("INSERT INTO messages VALUES (?,?,?,?,?,?)",
                                           (key, at, idx, role, body.encode("utf-8", "replace").decode(), lines))
                    fp.seek(max(0, pos - 128))
                    tail = fp.read(min(pos, 128))
            except FileNotFoundError:
                continue
            parts = key.split("/")
            parent = key if len(parts) == 2 else parts[0] + "/" + parts[1] + ".jsonl"
            db.execute("INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?,?,?,?)",
                       (key, parts[0], parent, ident, st.st_size, st.st_mtime_ns, pos, tail, lines))
            known.pop(key, None)
        for key in known:
            db.execute("DELETE FROM messages WHERE path=?", (key,))
            db.execute("DELETE FROM sources WHERE path=?", (key,))


def build_index():
    global index_status
    try:
        sync_search()
        index_status = "ready"
    except (OSError, ValueError, sqlite3.Error) as error:
        if stopping.is_set():
            return
        index_status = "failed"
        print(f"Could not build the search index: {error}", file=sys.stderr, flush=True)


def search_scope(project, file):
    if file:
        return " WHERE path=?", (file,)
    return (" WHERE project=?", (project,)) if project else ("", ())


def search_messages(term, project="", file=""):
    # A message matches when it contains every word, in any order.
    words = term.split()
    if not words:
        return []
    sync_search(project, file)
    where, args = search_scope(project, file)
    sql = ("SELECT s.parent,m.path,m.at,m.idx,m.role,m.body,m.line FROM messages m JOIN "
           "(SELECT path,parent FROM sources" + where + ") s ON s.path=m.path WHERE " +
           " AND ".join(["instr(lower(m.body),lower(?))>0"] * len(words)) + " ORDER BY m.path,m.at,m.idx")
    matches = []
    pattern = re.compile("|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)), re.I | re.ASCII)
    with closing(sqlite3.connect(SEARCH_DB)) as db:
        db.execute("BEGIN")
        for parent, path, at, idx, role, body, line in db.execute(sql, (*args, *words)):
            hit = pattern.search(body)
            a, b = hit.span()
            matches.append(dict(parent=parent, file=path, at=at, index=idx, role=role, line=line,
                                before=("…" if a > 56 else "") + body[max(0,a-56):a], match=body[a:b],
                                after=body[b:b+80] + ("…" if b+80 < len(body) else ""),
                                count=sum(1 for _ in pattern.finditer(body)) if file else 1,
                                **({"body": body} if file or len(body) <= 400 else {})))
        if file:
            source = db.execute("SELECT modified FROM sources WHERE path=?", (file,)).fetchone()
            return {"hits": matches, "revision": str(source[0]) if source else ""}
    return matches


class ReaderServer(ThreadingHTTPServer):
    allow_reuse_address = os.name != "nt"

    def __init__(self, address, handler, *, wait_for_browser):
        super().__init__(address, handler)
        self.timeout = 0.5
        self.page_lock = threading.Lock()
        self.connections = 0
        self.close_at = None if wait_for_browser else time.monotonic() + 60

    @contextmanager
    def connected_page(self):
        with self.page_lock:
            self.connections += 1
            self.close_at = None
        try:
            yield
        finally:
            with self.page_lock:
                self.connections -= 1
                if not self.connections:
                    # A refresh briefly disconnects the last page.
                    self.close_at = time.monotonic() + 3

    def serve_until_closed(self):
        while True:
            with self.page_lock:
                if self.close_at is not None and time.monotonic() >= self.close_at:
                    return
            self.handle_request()

    def reopening(self):
        with self.page_lock:
            if not self.connections and self.close_at is not None:
                self.close_at = time.monotonic() + 60

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def access_key():
    # Other accounts on a shared machine can reach 127.0.0.1 too. Only the
    # current user can read this file, and the browser keeps the key in a cookie.
    path = SEARCH_DB.parent / "key"
    try:
        key = path.read_text().strip()
    except FileNotFoundError:
        key = ""
    if not key:
        key = secrets.token_urlsafe(24)
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as stream:
            stream.write(key)
    return key


LOCAL_HOST = re.compile(r"(127\.0\.0\.1|localhost|\[::1\])(:\d+)?", re.I)
KEY = ""
LOCKED = "This reader only opens from the link it printed when it started.\n只能通过阅读器启动时打印的链接打开。\n".encode()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime if mime.startswith("image/") else mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(content)

    def cookie(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            name, _, value = part.strip().partition("=")
            if name == f"reader-{PORT}":
                return value
        return ""

    def do_GET(self):
        # Checking the host name blocks DNS rebinding. Any port is fine, so SSH can forward to another one.
        if not LOCAL_HOST.fullmatch(self.headers.get("Host") or "") or self.headers.get("Sec-Fetch-Site") == "cross-site" and self.headers.get("Sec-Fetch-Mode") != "navigate":
            self.send_error(403)
            return
        parts = urlsplit(self.path)
        query = parse_qs(parts.query)
        if parts.path == "/" and secrets.compare_digest(query.get("key", [""])[0].encode(), KEY.encode()):
            self.send_response(303)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie", f"reader-{PORT}={KEY}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax")
            self.end_headers()
            return
        if parts.path != "/reader.ico" and not secrets.compare_digest(self.cookie().encode(), KEY.encode()):
            self.reply(403, LOCKED, "text/plain")
            return
        try:
            if parts.path in ASSETS:
                name, mime = ASSETS[parts.path]
                self.reply(200, (APP / name).read_bytes(), mime)
                return
            if parts.path == "/api/open":
                with self.server.connected_page():
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(b"retry: 500\n: reader open\n\n")
                    # A cancelled event stream closes the socket, including on browser exit.
                    self.rfile.read(1)
                return
            if parts.path == "/api/projects":
                data = catalog()
            elif parts.path == "/api/search":
                data = search_messages(query["q"][0], query.get("project", [""])[0], query.get("file", [""])[0])
            elif parts.path == "/api/session":
                data = transcript(transcript_path(query["id"][0]))
            elif parts.path == "/api/block":
                data = detail(transcript_path(query["id"][0]), int(query["at"][0]), int(query.get("index", [0])[0]), query.get("part", [None])[0])
            elif parts.path == "/api/info":
                if "launch" in query:
                    self.server.reopening()
                data = dict(app="claude-local-session-reader", root=ROOT.as_posix(), index=index_status)
            elif parts.path == "/api/identity":
                data = "claude-local-session-reader"
            else:
                self.send_error(404)
                return
            self.reply(200, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "backslashreplace"), "application/json")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except (OSError, KeyError, IndexError, ValueError, sqlite3.Error):
            self.send_error(400, "Cannot read the selected record")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serve", action="store_true", help="print the URL without opening a browser")
    parser.add_argument("--port", type=int, default=PORT, help="choose a local port (default 48763)")
    args = parser.parse_args()
    PORT = args.port
    if not 1 <= PORT <= 65535:
        parser.error("port must be between 1 and 65535")
    try:
        SEARCH_DB.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        KEY = access_key()
    except OSError as error:
        sys.exit(f"Could not start the reader: {error}")
    base = f"http://127.0.0.1:{PORT}"
    url = f"{base}/?key={KEY}"
    try:
        server = ReaderServer(("127.0.0.1", PORT), Handler, wait_for_browser=args.serve)
    except OSError:
        try:
            with urlopen(Request(base + "/api/info?launch=1", headers={"Cookie": f"reader-{PORT}={KEY}"}), timeout=2) as response:
                info = json.load(response)
            if info.get("app") != "claude-local-session-reader" or Path(info.get("root", "")) != ROOT:
                raise ValueError
        except (OSError, ValueError, AttributeError):
            sys.exit(f"Port {PORT} is in use. Choose another with --port.")
        print(url, flush=True)
        if not args.serve:
            webbrowser.open(url)
        sys.exit()
    index_thread = threading.Thread(target=build_index)
    try:
        init_search()
        index_thread.start()
        print(f"Claude Code Session Reader  {url}", flush=True)
        if not args.serve:
            threading.Thread(target=webbrowser.open, args=(url,), daemon=True).start()
        server.serve_until_closed()
    except KeyboardInterrupt:
        pass
    except (OSError, sqlite3.Error) as error:
        sys.exit(f"Could not start the reader: {error}")
    finally:
        stopping.set()
        server.server_close()
        if index_thread.is_alive():
            index_thread.join()
