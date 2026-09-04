# BibleGuessr

## Language

Code, comments, commit messages, and documentation (README, this file,
etc.) are written in English (US), regardless of what language the conversation
with the user happens to be in.

## Documentation

Each feature should be documented here: `docs/web`.

Use only HTML, JavaScript, and CSS.

Each feature should have its own file and be organized in folders.

The consumer will use a VS Code extension to display the documentation.

Keep the `README.md` minimal and intended for developers. Explain how to use `docs/web` in `README.md`.

## Code architecture

Always consider using DDD in some form, but do not follow it blindly or dogmatically.
Always consider using TDD, but do not follow it dogmatically.

## Data security

Uploaded verse text must never be sent to the server or to other players. Only the book number, chapter number, and verse number may be transmitted.
