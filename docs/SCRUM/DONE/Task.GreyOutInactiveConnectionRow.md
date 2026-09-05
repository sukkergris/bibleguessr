# Grey out the realtime row when it reports nothing

The connection details panel showed a **Realtime (SignalR)** row on every
screen. Outside the multiplayer room there is no hub connection at all, but
the row still rendered in green and read *"not needed yet"* — which looks
like a check that ran and passed.

That is misleading in the way that matters most for a diagnostic: it invites
the reader to conclude something has been verified when nothing has been
measured. Two green rows imply two healthy signals; in reality only one of
them was ever consulted.

## What changed

The row now renders in muted grey and reads **"not used on this screen"**
when no hub connection exists. It is deliberately neither a pass nor a
failure, because it is neither — it simply does not apply there.

Inside the multiplayer room the row is unchanged: green *connected*, or the
real state when something is wrong.

Two smaller things were fixed while in the file:

- The details panel never handled `reconnecting`, so a reconnecting hub was
  reported as *disconnected* — the same conflation the indicator itself had
  already been fixed for.
- `.value.bad` still used a hard-coded red. The dark-mode migration had
  missed it, so it did not adapt with the rest of the palette.

## Why grey rather than hiding the row

Hiding it would remove the question rather than answer it. Someone opening a
diagnostics panel is asking *what is the state of my connection* — telling
them realtime is not in use here is a real answer, and it explains why the
dot reflects HTTP alone on that screen. An absent row explains nothing.

## Verification

Covered by `frontend/e2e/connection-status.spec.ts`: the row reads as
inactive where no hub exists, and reports a real connection inside
multiplayer. Verified by restoring the old green *"not needed yet"*
rendering and confirming the test fails.

The grey uses the muted theme token, so it adapts rather than being a fixed
colour — measured at roughly 7:1 against the panel surface in dark mode,
above the 4.5:1 threshold.

## Related

The underlying inconsistency — that realtime is only tracked inside the
multiplayer room — is not fixed by this and remains recommendation 2 in
`BACKLOG/Flag.BrokenConnectionIndicator.md`. This change makes the current
behaviour honest; it does not make the indicator complete.
