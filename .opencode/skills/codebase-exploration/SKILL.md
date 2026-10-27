---
name: codebase-exploration
description: Use when you need to explore the codebase, find files, search code, understand how a feature is implemented, or answer questions about project structure. Delegate all exploration to the explorer subagent.
---

# Codebase Exploration

Delegate all codebase exploration to the `explorer` subagent. Do not explore the codebase yourself with Glob/Grep/Read.

## When to use

Use the `explorer` subagent whenever you need to:

- Find files by name or pattern
- Search code for symbols, keywords, or patterns
- Understand how a feature is implemented
- Answer questions about project structure or conventions

## How to delegate

1. Call the Task tool with `subagent_type: "explorer"`.
2. Give a detailed prompt: what to find, where to look, and what to report back.
3. Specify thoroughness (`quick`, `medium`, or `very thorough`) so it scales its effort.
4. Use the findings it returns to continue your work.

## Why

The `explorer` subagent runs on the free Nemotron Lightning model (`openrouter/nvidia/nemotron-3.5-lightning:free`), keeping exploration cheap and preserving the main agent's context for the actual task.