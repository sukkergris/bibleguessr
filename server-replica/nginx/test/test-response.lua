-- Response shape: chunked, no Content-Length, attachment filename, generated
-- header appears exactly once, and two requests differ.
local p = require("probes")

local a = p.read_for("/_rate/fast", 2)
local b = p.read_for("/_rate/fast", 2)

if not a or not b then ngx.say("ERROR: probe failed") return end

local head = a.raw:sub(1, a.raw:find("\r\n\r\n") or 400)
ngx.say("chunked: ",         tostring(head:lower():find("transfer%-encoding: chunked") ~= nil))
ngx.say("no-content-length: ", tostring(head:lower():find("content%-length") == nil))
ngx.say("attachment: ",      tostring(head:find("attachment; filename=production.conf") ~= nil))

local body = p.body_of(a.raw)
local _, generated = body:gsub("Generated", "")
ngx.say("generated-headers: ", generated)
ngx.say("bodies-differ: ",   tostring(a.raw ~= b.raw))
ngx.say("has-bait: ",        tostring(body:find("%[auth%]") ~= nil and body:find("api_key") ~= nil))
