"""Add the reader to the current user's application menu."""

import os
import sys
from pathlib import Path


def exec_argument(path):
    # Desktop entries unescape the value before parsing Exec's quoted arguments.
    value = str(path).replace("%", "%%")
    for char in ('\\', '"', '`', '$'):
        value = value.replace(char, '\\' + char)
    return '"' + value.replace('\\', '\\\\') + '"'


root = Path(__file__).resolve().parents[1]
data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
entry = data_home / "applications" / "claude-session-reader.desktop"
entry.parent.mkdir(parents=True, exist_ok=True)
icon = str(root / "media" / "icon.png").replace("\\", "\\\\")
entry.write_text(
    "[Desktop Entry]\n"
    "Type=Application\n"
    "Name=Claude Code Session Reader\n"
    "Name[zh_CN]=Claude Code 会话阅读器\n"
    f"Exec={exec_argument(sys.executable)} {exec_argument(root / 'reader.py')}\n"
    f"Icon={icon}\n"
    "Terminal=false\n"
    "Categories=Utility;\n",
    encoding="utf-8",
)
print(entry)
