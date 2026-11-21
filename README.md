[English](README.md) · [简体中文](README.zh-CN.md)

# Claude Code Session Reader

Find an old Claude Code conversation by a detail you remember, read the exchange in context, and give your next agent the exact message.

[![Search for Parakeet, open the original exchange, and paste its reference into a new prompt](media/session-reader.gif)](media/session-reader.mp4)

## Why I built this

I use Claude Code in the terminal and in VS Code. Weeks later I might remember a model name or something Claude said, but rarely the session title. I used to open my `.claude` directory in VS Code, search across JSONL files, and untangle the matching line. Sometimes I just asked another agent to find the conversation for me.

I wanted to see my question and Claude’s answer together. If the conversation had been compacted, I still wanted to read the earlier exchange when it was on disk. And once I’d found it, I wanted to give Claude or Codex the source and get on with the next question.

## Quick start

Download or clone the repository and open its folder. You’ll need **Python 3.9+** and a browser.

| Platform | Launch |
| --- | --- |
| Windows | Double-click **Open Reader.cmd**, or run `py -3 reader.py` |
| macOS / Linux | Run `python3 reader.py` |

The reader opens in your browser. Choose **简体中文** in the project sidebar to switch languages. The reader remembers your choice.

**Prefer to ask your agent?** Paste this with the repository open.

> Start Claude Code Session Reader on this computer using the README, find my local Claude Code sessions, and give me the browser link.

**Try it without a history.** Add `--demo` to the launch command. In **Search all sessions**, type `Parakeet` and open the hit from the main conversation. You’ll see why Moonshine owns the live captions and where Parakeet takes over. Click **Copy reference**, paste it into a new agent prompt, and ask *“Does the code still follow this split?”*

I haven't tried the full workflow with real Claude Code sessions on macOS or Linux yet, so please open an issue or send a fix if you run into trouble.

## Finding a conversation

- **Remember a model, API, or field?** Search across projects or within one project. Results include the original words from user, Claude, and subagent messages. Select a snippet to jump to it.
- **Need the reasoning around it?** Read the surrounding turns. Expand **Activity** for recorded thinking, tool inputs, and results, or choose a subagent from the conversation menu.
- **Need the whole session?** **Copy ID** gives a local agent the session ID. **Copy reference** includes the transcript path, byte offset, content block, speaker, and an excerpt. A local agent with file access can go straight to it.

When I already know which conversation to continue, I use Claude Code’s `/resume`. For raw tool output or a string inside tool arguments, a text search across the JSONL files also works. I open the reader when I remember what we discussed and want to read or reuse that exchange. [Claude Code session commands](https://code.claude.com/docs/en/sessions)

## How it works

![Local JSONL transcripts feed a SQLite message index for search. The reader opens the original transcript for context and serves the result to the local browser.](media/architecture.png)

The Python server reads `~/.claude/projects/` or the `projects/` directory under `CLAUDE_CONFIG_DIR`. It leaves transcripts untouched and keeps its SQLite index in your OS user cache. The interface and its Markdown renderer are bundled. Everything runs on `127.0.0.1`.

Use `--serve` to print the URL without opening a browser, or `--port 48800` to choose another port.

[MIT license](LICENSE) · [Bundled markdown-it license](markdown-it.LICENSE)
