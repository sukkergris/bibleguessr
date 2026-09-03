module BibleGuessr.Api.GameHub

open System
open System.Threading.Tasks
open Microsoft.AspNetCore.SignalR
open BibleGuessr.Domain

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
        let room =
            { Code = RoomCode code
              Players = []
              Round = WaitingForPlayers }
        rooms[code] <- room
        room

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

/// Chat messages are capped to keep a single overlong paste from bloating
/// every other client's message list; empty/whitespace-only messages are
/// dropped rather than broadcast.
let private maxChatMessageLength = 500

type GameHub(rooms: RoomStore) =
    inherit Hub()

    member this.JoinRoom(roomCode: string, playerName: string) : Task =
        task {
            match rooms.TryGet(roomCode) with
            | None -> do! this.Clients.Caller.SendAsync("Error", "Room not found")
            | Some room ->
                let player =
                    { Id = PlayerId(Guid.NewGuid())
                      Name = playerName
                      Score = 0 }

                let updated = { room with Players = player :: room.Players }
                rooms.Set(roomCode, updated)
                rooms.RegisterConnection(this.Context.ConnectionId, RoomCode roomCode, player)

                do! this.Groups.AddToGroupAsync(this.Context.ConnectionId, roomCode)
                do! this.Clients.Group(roomCode).SendAsync(PlayerJoinedEvent, player.Name)
        }

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

                    do! this.Clients.Group(roomCode).SendAsync(ChatMessageReceivedEvent, message)
        }
