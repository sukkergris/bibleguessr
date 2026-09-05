# Players in the roster cannot be challenged without a mouse

Clicking another player's name in the multiplayer roster is how you challenge
them to a game. That name is a plain list item with a click handler, not a
button, so it cannot be focused with Tab and cannot be activated with Enter or
Space.

A keyboard-only player can join a room and chat, but has no way to start a
game with anyone. A screen-reader user is not told the name is interactive at
all.

Confirmed against the running application: roster rows report a tab index of
-1 and carry no interactive role, so they are absent from the tab order
entirely.

The same applies to any other action exposed only by clicking a row.

## Resolution

Fixed. A challengeable player is now a real `<button>` inside the list item
rather than a clickable list item, so it is focusable, activatable with Enter
and Space, and announced as interactive. Its accessible name includes the
player's name and what activating it does, so a screen-reader user knows who
they are challenging. The button fills the row, so the visible layout is
unchanged.

The connection dot alongside it is now marked decorative, since its meaning is
already carried by the row's text and its section.

Players who cannot be challenged — offline, or already in a game — remain
non-interactive, as before.

Covered by `frontend/e2e/accessibility.spec.ts`, verified by reverting the fix
and confirming the test fails.

## Requirements

- A player who can be challenged must be reachable with Tab and activatable
  with Enter and Space.
- Assistive technology must identify the control as interactive and say what
  activating it does.
- Players who cannot be challenged — offline, or already in a game — must not
  be presented as interactive, consistent with how they are already excluded
  from clicking.
- The visible layout of the roster should not have to change to achieve this.
