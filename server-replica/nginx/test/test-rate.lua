-- Streaming rate matches the configured bytes/second.
local p = require("probes")
for _, c in ipairs({ { "/_rate/slow", 4096 }, { "/_rate/fast", 10240 } }) do
    local r, err = p.read_for(c[1], 4)
    if not r then
        ngx.say(string.format("%-13s ERROR %s", c[1], err))
    else
        ngx.say(string.format("%-13s configured=%5d measured=%6.0f B/s bytes=%d",
            c[1], c[2], r.bytes / r.elapsed, r.bytes))
    end
end
