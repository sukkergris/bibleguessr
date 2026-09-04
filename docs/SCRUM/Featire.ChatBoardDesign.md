# Chat Board Design

Redesign the chat board so it feels clear, welcoming, and useful during multiplayer games. The design should support conversation without allowing chat to compete with the game itself.

## Core Areas

- **Header:** Show the room name or World chat title, connection status, and access to the Nerd tab.
- **Players:** Show online and offline players in clearly separated sections. Display each player's name, status, score when relevant, and available actions.
- **Messages:** Show recent messages in a readable, scrollable conversation area with the sender's name and timestamp.
- **Composer:** Provide a visible message input, character limit, and send action. Disable sending when the connection is unavailable.
- **Game actions:** Make actions such as inviting a player, accepting or declining a request, and leaving the room easy to find without dominating the chat.

## Design Requirements

- Make the current player easy to identify.
- Use clear visual states for connected, disconnected, reconnecting, and unavailable players.
- Keep pending play requests visible without mixing them into ordinary chat messages.
- Preserve the conversation when the player switches between chat and game views.
- Make the layout work on both desktop and mobile screens.
- Keep the most recent messages visible while allowing the user to review older messages.
- Provide clear empty, loading, error, and disconnected states.
- Do not expose uploaded verse text through chat or player events.

## Ideas to Explore

1. A two-column desktop layout with players on the left and chat on the right.
2. A single-column mobile layout with players and requests in expandable sections above chat.
3. Compact player rows with status dots, score labels, and an action menu.
4. A subtle visual distinction between system messages, player messages, and game events.
5. A focused game mode that collapses chat while a timed round is in progress.

The final design should be tested with realistic player names, long messages, many players, pending invitations, connection loss, and reconnection.
