-- max_seconds must end the response instead of streaming forever.
local p = require("probes")
local r = p.read_for("/_capped", 8)   -- endpoint is capped at 2s
if not r then ngx.say("ERROR") return end
ngx.say(string.format("elapsed=%.1f bytes=%d", r.elapsed, r.bytes))
