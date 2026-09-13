-- Probes that exercise the tarpit over real TCP connections.
--
-- These run inside the test container (content_by_lua_file) rather than as a
-- shell client, because the tarpit response is open-ended: curl/wget cannot
-- read "for N seconds then stop" without the timeout killing the byte count.
-- A cosocket can.

local M = {}

local TARPIT_PORT = 8095

-- Read a tarpit URL for `seconds`, return bytes read, elapsed time and the
-- raw response (headers + body) that was seen.
function M.read_for(path, seconds)
    local sock = ngx.socket.tcp()
    sock:settimeout(500)
    local ok, err = sock:connect("127.0.0.1", TARPIT_PORT)
    if not ok then
        return nil, "connect failed: " .. tostring(err)
    end
    sock:send("GET " .. path .. " HTTP/1.1\r\nHost: tarpit-test\r\nConnection: close\r\n\r\n")

    local started, total, buf = ngx.now(), 0, {}
    while ngx.now() - started < seconds do
        local data, rerr, partial = sock:receive(128)
        local got = data or partial
        if got and #got > 0 then
            total = total + #got
            buf[#buf + 1] = got
        end
        -- a read timeout just means "nothing yet", keep waiting
        if not data and rerr ~= "timeout" then break end
    end
    local elapsed = ngx.now() - started
    sock:close()
    return { bytes = total, elapsed = elapsed, raw = table.concat(buf) }
end

-- Connect, read briefly, then hang up mid-stream.
function M.abort_early(path, seconds)
    local sock = ngx.socket.tcp()
    sock:settimeout(500)
    local ok, err = sock:connect("127.0.0.1", TARPIT_PORT)
    if not ok then return nil, tostring(err) end
    sock:send("GET " .. path .. " HTTP/1.1\r\nHost: tarpit-test\r\nConnection: close\r\n\r\n")
    local started, total = ngx.now(), 0
    while ngx.now() - started < seconds do
        local data, rerr, partial = sock:receive(128)
        local got = data or partial
        if got then total = total + #got end
        if not data and rerr ~= "timeout" then break end
    end
    sock:close()   -- abrupt close while the server is still generating
    return total
end

-- Is the tarpit still accepting connections?
function M.still_serving()
    local sock = ngx.socket.tcp()
    sock:settimeout(1000)
    local ok = sock:connect("127.0.0.1", TARPIT_PORT)
    if ok then sock:close() end
    return ok ~= nil
end

function M.body_of(raw)
    return raw:match("\r\n\r\n(.*)") or raw
end

return M
