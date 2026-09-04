# Custom Forfeit Confirmation

Replace the browser's built-in confirmation popup for forfeiting a game with a polished, in-app confirmation dialog that matches the application's design.

## Requirements

- Clearly explain that forfeiting will end the player's current game.
- Provide explicit **Forfeit** and **Cancel** actions.
- Make **Cancel** the safe default action.
- Close the dialog when the user selects Cancel, presses Escape, or clicks outside the dialog when appropriate.
- Require an explicit confirmation before sending the forfeit request.
- Prevent duplicate submissions while the request is being processed.
- Show a clear error if the forfeit request fails.
- Keep focus inside the dialog while it is open and return focus to the triggering control when it closes.
- Make the dialog usable with keyboard navigation and screen readers.
