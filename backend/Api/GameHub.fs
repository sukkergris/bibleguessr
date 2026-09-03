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

/// Messages the server pushes to clients. Keep in sync with the Lit
/// frontend's SignalR event handlers (frontend/src/signalr-client.ts).
[<Literal>]
let PlayerJoinedEvent = "PlayerJoined"

[<Literal>]
let RoundStartedEvent = "RoundStarted"

[<Literal>]
let RoundScoredEvent = "RoundScored"

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

                do! this.Groups.AddToGroupAsync(this.Context.ConnectionId, roomCode)
                do! this.Clients.Group(roomCode).SendAsync(PlayerJoinedEvent, player.Name)
        }
