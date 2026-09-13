-- Tarpit body generator.
--
-- Serves an endlessly generated fake configuration file to vulnerability
-- scanners, instead of a large decoy file committed to the repository. The
-- bytes are produced on the fly, so nothing has to be stored, mounted or
-- cloned -- see docs/web/cyber-security/index.html.
--
-- Pacing is done here rather than with `limit_rate`, which only throttles
-- nginx's own file/proxy output filters and does not apply to ngx.print from
-- a content_by_lua handler.

local _M = {}

-- Tunables. Named rather than inlined so a location can override them and so
-- the numbers are readable in one place.
local default_rate_bytes_per_second = 10240
local default_max_seconds = 900

-- Written once at the top of the response; not part of the repeating body.
local header_template = "# %s\n# Generated %s -- do not edit by hand\n\n"

-- Bait values, repeated in order for as long as the client keeps reading.
-- Deliberately worthless: everything here is disabled, empty or /dev/null.
local sections = {
    "[core]\nadmin_enabled = false\ndebug = false\nmaintenance_mode = true\n\n",
    "[auth]\nsession_timeout = 86400\npassword_hash = %s\nmfa_required = true\n\n",
    "[api]\napi_key = \"%s\"\nrate_limit = 10\nallowed_origins = \n\n",
    "[storage]\nbackup_location = /dev/null\nretention_days = 0\nencrypted = true\n\n",
    "[ssh]\nssh_access = disabled\npermit_root_login = no\nauthorized_keys = \n\n",
    "[db]\nhost = 127.0.0.1\nport = 5432\nname = %s\nuser = %s\npassword = %s\n\n",
}

local function random_token(len)
    local chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    local out = {}
    for i = 1, len do
        local n = math.random(#chars)
        out[i] = chars:sub(n, n)
    end
    return table.concat(out)
end

-- One plausible-looking block of config text.
local function next_block(index)
    local template = sections[(index % #sections) + 1]
    local slots = select(2, template:gsub("%%s", ""))
    if slots == 0 then
        return template
    end
    local args = {}
    for i = 1, slots do
        args[i] = random_token(12 + math.random(20))
    end
    return string.format(template, unpack(args))
end

function _M.run(opts)
    opts = opts or {}
    local rate = tonumber(opts.rate) or default_rate_bytes_per_second
    local max_seconds = tonumber(opts.max_seconds) or default_max_seconds
    local filename = opts.filename or "production.conf"

    -- Seed per request so two scanners do not receive byte-identical bodies.
    math.randomseed(ngx.now() * 1000 % 2 ^ 31 + (tonumber(ngx.var.connection) or 0))

    ngx.header["Content-Type"] = "text/plain"
    ngx.header["Content-Disposition"] = 'attachment; filename=' .. filename
    -- No Content-Length: the body is open-ended, so the response is chunked.
    ngx.header["Cache-Control"] = "no-store"
    ngx.status = ngx.HTTP_OK

    -- Notice when the scanner hangs up so the worker stops generating.
    local ok, err = ngx.on_abort(function() ngx.exit(499) end)
    if not ok then
        ngx.log(ngx.WARN, "tarpit: on_abort unavailable: ", err or "?")
    end

    local started = ngx.now()
    local sent = 0
    local index = 0

    ngx.print(string.format(header_template, filename, ngx.http_time(ngx.time())))
    ngx.flush(true)

    while true do
        local elapsed = ngx.now() - started
        if elapsed >= max_seconds then break end

        -- Pace against elapsed wall-clock time rather than sleeping per block:
        -- blocks vary in size and ngx.sleep has millisecond granularity, so
        -- per-block sleeps drift well above the target rate. Sleep only while
        -- we are ahead of the budget the rate allows so far.
        local budget = elapsed * rate
        if sent > budget then
            ngx.sleep((sent - budget) / rate)
        end

        local block = next_block(index)
        index = index + 1

        local printed, perr = ngx.print(block)
        if not printed then
            ngx.log(ngx.INFO, "tarpit: client gone after ", sent, " bytes: ", perr or "?")
            return
        end

        local flushed, ferr = ngx.flush(true)
        if not flushed then
            ngx.log(ngx.INFO, "tarpit: flush failed after ", sent, " bytes: ", ferr or "?")
            return
        end

        sent = sent + #block
    end

    ngx.log(ngx.INFO, "tarpit: held client for ", max_seconds, "s, sent ", sent, " bytes")
end

return _M
