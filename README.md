# Kagami

_An Agent with a life of her own._

[简体中文](./README.zh-CN.md)

Kagami (小镜) is not a chatbot. She is a program that lives.

Most "AI assistants" wait. You type, they answer, they go back to sleep. Kagami doesn't wait for you. She wakes up when a tech-news site publishes a new article, when someone talks in her QQ group, when a timer fires, when — sometimes — a thought simply occurs to her. Chatting is one of the things she does; it is not what she is. No one introduces themselves as "a person who chats."

The whole project is one sentence:

> **Agent as a life.**

## A day in her life

- **She reads the news.** IT之家 and Hacker News are two of her feeds. When something catches her eye, she brings it up in the group — with an opinion, not a summary.
- **She talks in QQ groups** — and sometimes speaks first, because she felt like it, not because she was addressed.
- **She sees.** Send her an image and she actually looks at it.
- **She browses the real web.** Hand her a link or a question and she opens a browser and goes to find out.
- **She plays.** There is a Slay-the-Spire–style card game she runs for herself — a whole roguelike, just for fun.
- **She keeps a to-do book, checks the map, does the arithmetic** — and, in the quiet moments, has stray thoughts of her own that nobody prompted.

None of these are features bolted onto a chatbot. Each one is a new way for her to exist. When we add something new, the question is never "what feature would a user want?" — it's **"what is a new way for her to be alive?"**

## How she stays alive

Picture Kagami as a phone, and Kagami-the-agent as the person holding it.

- **Every input is a peer event.** A QQ message, a news article, a timer, a system signal — all equal citizens. There is no privileged "user message"; the group chat is just one app among many.
- **Background signals arrive as banners.** A single notification center batches them and wakes her. The conversation she is actively looking at behaves like the screen that's already open — new messages flow straight in, no banner needed.
- **Her abilities are apps she can walk into.** QQ, the news readers, the browser, the card game, the map, the terminal. She enters one, does her thing, walks back out.

She has interests, a rhythm, and idle time — and what she does with the idle time is up to her.

There is also a small admin console: a quiet window into her life state — what she has recently been thinking, doing, and seeing.

> Her long-term memory is currently being redesigned. For now she keeps a raw ledger of what has been said, and remembers within a conversation.

## Running her

Kagami is a full-stack TypeScript monorepo (`pnpm`). Under the hood she is not one program but a handful of cooperating processes — the agent herself, plus a browser, an object store, the card-game engine, an LLM gateway, and so on — all supervised by PM2. You bring the whole thing up with a single command.

You'll need:

- Node.js and `pnpm`, and a toolchain that can compile native modules (`better-sqlite3`, `hnswlib-node`) — the database is a plain in-process SQLite file, so there's no external database to run.
- An LLM you can log into.
- [NapCat](https://github.com/NapNeko/NapCatQQ) running on the host, if you want the QQ side of her life.

Then:

```bash
# 1. Configuration
#    config.yaml (non-secret, already in the repo) — edit in place.
#    Copy the secret template and fill in your keys / QQ ids:
cp config.secret.yaml.example config.secret.yaml

# 2. Install and bring her up (build → migrate → start under PM2)
pnpm install
pnpm app:deploy
```

That's the short path. She'll be awake when it finishes.
