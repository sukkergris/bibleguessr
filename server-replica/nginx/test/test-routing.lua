-- Which location rule answers each scanner path, and at what rate.
local p = require("probes")

-- Each path is read for a fixed window, so the byte count reveals which rate
-- tier answered it. That is what distinguishes the CMS rule (4 KB/s) from the
-- generic .php rule (8 KB/s) -- both tarpit, but a location-ordering mistake
-- silently downgrades CMS paths to the faster tier.
local cases = {
    { path = "/.env",         tier = "generic" },
    { path = "/.git/config",  tier = "generic" },
    { path = "/wp-login.php", tier = "cms"     },
    { path = "/phpMyAdmin",   tier = "cms"     },
    { path = "/index.php",    tier = "php"     },
    { path = "/dns-query",    tier = "generic" },
    { path = "/",             tier = "normal"  },
}

for _, c in ipairs(cases) do
    local r, err = p.read_for(c.path, 1)
    if not r then
        ngx.say(string.format("%-18s ERROR %s", c.path, err))
    else
        local body = p.body_of(r.raw)
        local kind = body:find("normal") and "normal" or "tarpit"
        ngx.say(string.format("%-18s %-7s %-8s %6d bytes", c.path, kind, c.tier, r.bytes))
    end
end
