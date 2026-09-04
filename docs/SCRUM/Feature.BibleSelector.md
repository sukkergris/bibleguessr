# Select a Bible

Singleplayer is split into three separate game types, chosen up front from
the home screen (alongside Multiplayer):

1. **The Bible** — the entire Bible, no restriction.
2. **Books** — the user picks which books to quiz on, via a grid of
   checkboxes (one per book in the chosen translation). In-game, the guess
   form's Book field becomes a closed dropdown listing only the selected
   books — no free typing, and no guessing a book outside the selection.
3. **Chapters** — the user picks a single book, then which of its chapters
   to quiz on, via a grid of checkboxes.

Each of the three game types is its own entry point with its own setup
screen — not a single shared screen with a dropdown/switch inside it. Each
type's book/chapter selection is remembered independently: leaving the
setup screen (e.g. going back Home) and returning to the same game type
later restores whatever was selected last time, without affecting the
other two game types' selections.

The book grid uses the translation's own book name text as-is. There's no
acronym/abbreviation data available for any translation this app supports,
so there's no canonical short label to show instead.
