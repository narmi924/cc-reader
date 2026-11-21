[English](README.md) · [简体中文](README.zh-CN.md)

# Claude Code Session Reader

Find an old Claude Code conversation by a detail you remember, read the exchange in context, and give your next agent the exact message.

[![Search for Parakeet, open the original exchange, and paste its reference into a new prompt](media/session-reader.gif)](media/session-reader.mp4)

## Why I built this

I use Claude Code in the terminal and in VS Code. Weeks later I can often remember a model name, sometimes even half a sentence Claude wrote, but rarely which session it came from. I used to open my whole `.claude` directory in VS Code and search the JSONL files. Sometimes I'd ask Codex to look for me. Even with the right word on screen, I still had a question. Was this an option we'd considered, or what we'd actually decided to do?

| Existing option | What it finds | What's still missing for me |
| --- | --- | --- |
| Claude Code's `/resume` | I can preview an old session and pick up where I left off. | Once a message has been summarized, resuming gives Claude the summary. To see the original wording, I still need the transcript on disk. [What a resumed session restores](https://code.claude.com/docs/en/sessions#what-a-resumed-session-restores) |
| Searching JSONL in VS Code | One search across projects takes me straight to the matching line. | A question and its answer can sit several tool calls apart. I have to sort my follow-ups from tool output to read the exchange. |
| claude-history | I can find a message in the terminal and press `y` to copy it. | That puts the raw Markdown on my clipboard. The file path and session ID have separate copy commands, so I still have to assemble the quote and its source for Codex. [Viewer shortcuts](https://github.com/raine/claude-history#keyboard-navigation-viewer-mode) |
| Claude Code Chat Explorer | I can search messages and tool output in the browser. An agent can find matching excerpts over MCP, too. | The browser exports a whole conversation, and an MCP result links to the conversation transcript. I still have to point the next agent to the particular message I picked. [Conversation viewer and MCP search](https://github.com/drewburchfield/claude-code-chat-explorer#conversation-viewer) |

That's why there's a **Copy reference** button beside each matching passage. In the demo, `Parakeet` turns up twice. The subagent is tracing a caption callback. In the main conversation, Claude is answering my question about which model finalizes a caption. I open that match, read my question and the reply together, then copy the excerpt with its speaker and its exact position in the local file. All I need to add when I paste it into Codex is “Does the code still follow this split?”

## Quick start

Download or clone the repository and open its folder. You’ll need **Python 3.9+** and a browser.

| Platform | Launch |
| --- | --- |
| Windows | Double-click **Open Reader.cmd**, or run `py -3 reader.py` |
| macOS / Linux | Run `python3 reader.py` |

The reader opens in your browser. Choose **简体中文** in the project sidebar to switch languages. The reader remembers your choice.

**Prefer to ask your agent?** Paste this with the repository open.

> Start Claude Code Session Reader on this computer using the README, find my local Claude Code sessions, and give me the browser link.

**Try it without a history.** Add `--demo` to the launch command. The demo uses its own port and search index, so you can keep your personal reader open. In **Search all sessions**, type `Parakeet`, open the main conversation's match, and click **Copy reference**.

I haven't tried the full workflow with real Claude Code sessions on macOS or Linux yet, so please open an issue or send a fix if you run into trouble.

## Finding a conversation

- **Remember a model, API, or field?** Search across projects or within one project. Results include the original words from user, Claude, and subagent messages. Select a snippet to jump to it.
- **Need the reasoning around it?** Read the surrounding turns. Expand **Activity** for recorded thinking, tool inputs, and results, or choose a subagent from the conversation menu.
- **Need the whole session?** **Copy ID** gives a local agent the session ID. **Copy reference** includes the transcript path, byte offset, content block, speaker, and an excerpt. A local agent with file access can go straight to it.

## How it works

![Local JSONL transcripts feed a SQLite message index for search. The reader opens the original transcript for context and serves the result to the local browser.](media/architecture.png)

The Python server reads `~/.claude/projects/` or the `projects/` directory under `CLAUDE_CONFIG_DIR`. It leaves transcripts untouched and keeps its SQLite index in your OS user cache. The interface and its Markdown renderer are bundled. Everything runs on `127.0.0.1`.

Use `--serve` to print the URL without opening a browser, or `--port 48800` to choose another port.

[MIT license](LICENSE) · [Bundled markdown-it license](markdown-it.LICENSE)
