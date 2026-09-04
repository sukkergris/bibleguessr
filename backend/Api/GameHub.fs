module BibleGuessr.Api.GameHub

open System
open System.Threading.Tasks
open Microsoft.AspNetCore.SignalR
open BibleGuessr.Domain

/// The always-open room everyone lands in via "World chat" — just pick a
/// name, no room code needed. Reserved as a non-numeric code so it can
/// never collide with a randomly generated room code (those are always
/// 4 digits, see CreateRoom).
[<Literal>]
let WorldChatRoomCode = "WORLD"

/// In-memory room registry for multiplayer sessions.
/// Fine for a single-instance dev/hobby deployment; swap for a distributed
/// store (Redis backplane + shared state) before scaling out to multiple
/// server instances.
type RoomStore() =
    let rooms = System.Collections.Concurrent.ConcurrentDictionary<string, Room>()

    // Tracks which room/player a hub connection belongs to, so a later call
    // on the same connection (e.g. SendChatMessage) can identify its sender
    // without trusting a client-supplied identity.
    let connections = System.Collections.Concurrent.ConcurrentDictionary<string, RoomCode * Player>()

    member _.TryGet(code: string) =
        match rooms.TryGetValue(code) with
        | true, room -> Some room
        | false, _ -> None

    member _.Set(code: string, room: Room) = rooms[code] <- room

    member _.CreateRoom() =
        let code = Random.Shared.Next(1000, 9999) |> string
        let room = Room.create (RoomCode code)
        rooms[code] <- room
        room

    /// Ensures the World chat room exists, creating it on first use. Safe
    /// to call concurrently — GetOrAdd is atomic per key.
    member _.GetOrCreateWorldRoom() =
        rooms.GetOrAdd(WorldChatRoomCode, fun code -> Room.create (RoomCode code))

    member _.RegisterConnection(connectionId: string, roomCode: RoomCode, player: Player) =
        connections[connectionId] <- (roomCode, player)

    member _.TryGetConnection(connectionId: string) =
        match connections.TryGetValue(connectionId) with
        | true, value -> Some value
        | false, _ -> None

/// Messages the server pushes to clients. Keep in sync with the Lit
/// frontend's SignalR event handlers (frontend/src/signalr-client.ts).
[<Literal>]
let PlayerJoinedEvent = "PlayerJoined"

[<Literal>]
let RoundStartedEvent = "RoundStarted"

[<Literal>]
let RoundScoredEvent = "RoundScored"

[<Literal>]
let ChatMessageReceivedEvent = "ChatMessageReceived"

/// Sent only to a newly-joined player, once, right after they join — the
/// room's last Room.maxRecentMessages messages (oldest first, so the
/// client can just append them in order), so they land in a chat that
/// already has context instead of an empty one.
[<Literal>]
let ChatHistoryEvent = "ChatHistory"

/// Chat messages are capped to keep a single overlong paste from bloating
/// every other client's message list; empty/whitespace-only messages are
/// dropped rather than broadcast.
let private maxChatMessageLength = 500

type GameHub(rooms: RoomStore) =
    inherit Hub()

    /// Adds the caller to `room` as a new player, registers the connection,
    /// broadcasts PlayerJoined, and sends the joiner (only) recent chat
    /// history — shared by JoinRoom and JoinWorldChat, which differ only in
    /// how they find/create the room to join.
    member private this.JoinExistingRoom(room: Room, playerName: string) : Task =
        task {
            let (RoomCode roomCode) = room.Code

            let player =
                { Id = PlayerId(Guid.NewGuid())
                  Name = playerName
                  Score = 0 }

            let updated = { room with Players = player :: room.Players }
            rooms.Set(roomCode, updated)
            rooms.RegisterConnection(this.Context.ConnectionId, room.Code, player)

            do! this.Groups.AddToGroupAsync(this.Context.ConnectionId, roomCode)
            do! this.Clients.Group(roomCode).SendAsync(PlayerJoinedEvent, player.Name)

            // RecentMessages is stored newest-first (see Room.addMessage);
            // reverse so the client receives/renders oldest-first.
            let history = room.RecentMessages |> List.rev
            do! this.Clients.Caller.SendAsync(ChatHistoryEvent, history)
        }

    member this.JoinRoom(roomCode: string, playerName: string) : Task =
        task {
            match rooms.TryGet(roomCode) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "Room not found")
            | Some room -> do! this.JoinExistingRoom(room, playerName)
        }

    /// Joins the always-open World chat room — just a name, no room code.
    member this.JoinWorldChat(playerName: string) : Task =
        this.JoinExistingRoom(rooms.GetOrCreateWorldRoom(), playerName)

    member this.SendChatMessage(text: string) : Task =
        task {
            match rooms.TryGetConnection(this.Context.ConnectionId) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "You haven't joined a room")
            | Some(RoomCode roomCode, player) ->
                let trimmed = text.Trim()

                if trimmed = "" then
                    do! this.Clients.Caller.SendAsync("Error", "Message can't be empty")
                elif trimmed.Length > maxChatMessageLength then
                    do! this.Clients.Caller.SendAsync("Error", $"Message is too long (max {maxChatMessageLength} characters)")
                else
                    let message: ChatMessage =
                        { PlayerId = player.Id
                          PlayerName = player.Name
                          Text = trimmed
                          SentAt = DateTimeOffset.UtcNow }

                    // Record it into the room's history before broadcasting,
                    // so it's there for the next player who joins.
                    match rooms.TryGet(roomCode) with
                    | Some room -> rooms.Set(roomCode, Room.addMessage message room)
                    | None -> ()

                    do! this.Clients.Group(roomCode).SendAsync(ChatMessageReceivedEvent, message)
        }
