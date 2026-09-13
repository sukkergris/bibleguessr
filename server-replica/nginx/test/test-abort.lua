-- A scanner hanging up mid-stream must not wedge the worker.
local p = require("probes")
local got = p.abort_early("/_rate/fast", 1)
ngx.say("read-before-abort: ", tostring(got))
ngx.sleep(1)
ngx.say("still-serving: ", tostring(p.still_serving()))
