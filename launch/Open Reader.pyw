"""Open the reader with the Windows GUI interpreter."""

import ctypes
import runpy
from pathlib import Path

try:
    runpy.run_path(str(Path(__file__).resolve().parents[1] / "reader.py"), run_name="__main__")
except SystemExit as error:
    if error.code:
        ctypes.windll.user32.MessageBoxW(None, str(error.code), "Claude Code Session Reader", 0x10)
    raise
