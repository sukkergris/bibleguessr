// Tarpit body generator.
//
// Serves an endlessly generated fake configuration file to vulnerability
// scanners, instead of a large decoy file committed to the repository. The
// bytes are produced on the fly, so nothing has to be stored, mounted or
// cloned -- see docs/web/cyber-security/index.html.
//
// Pacing is done here rather than with `limit_rate`, which only throttles
// nginx's own file/proxy output filters and does not apply to r.send() from
// a js_content handler.

// Tunables. Named rather than inlined so a location can override them and so
// the numbers are readable in one place.
let defaultRateBytesPerSecond = 10240;
let defaultMaxSeconds = 900;

// Written once at the top of the response; not part of the repeating body.
let headerTemplate = '# %s\n# Generated %s -- do not edit by hand\n\n';

// Bait values, repeated in order for as long as the client keeps reading.
// Deliberately worthless: everything here is disabled, empty or /dev/null.
let sections = [
    '[core]\nadmin_enabled = false\ndebug = false\nmaintenance_mode = true\n\n',
    '[auth]\nsession_timeout = 86400\npassword_hash = %s\nmfa_required = true\n\n',
    '[api]\napi_key = "%s"\nrate_limit = 10\nallowed_origins = \n\n',
    '[storage]\nbackup_location = /dev/null\nretention_days = 0\nencrypted = true\n\n',
    '[ssh]\nssh_access = disabled\npermit_root_login = no\nauthorized_keys = \n\n',
    '[db]\nhost = 127.0.0.1\nport = 5432\nname = %s\nuser = %s\npassword = %s\n\n',
];

let tokenChars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// njs has no ngx.sleep; setTimeout wrapped in a promise is the async
// equivalent, and awaiting it yields the worker instead of blocking it.
function sleep(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
}

function randomToken(length) {
    let out = '';
    for (let i = 0; i < length; i++) {
        out += tokenChars[Math.floor(Math.random() * tokenChars.length)];
    }
    return out;
}

// Substitute each %s in turn, like Lua's string.format, which njs lacks.
function format(template, argsProvider) {
    return template.replace(/%s/g, argsProvider);
}

// One plausible-looking block of config text.
function nextBlock(index) {
    let template = sections[index % sections.length];
    return format(template, function () {
        return randomToken(12 + Math.floor(Math.random() * 21));
    });
}

// RFC 1123 date, the format ngx.http_time produced in the Lua version.
function httpTime(date) {
    return date.toUTCString();
}

async function run(r) {
    // Per-location overrides, read from the `js_content` location's own
    // variables so the rules stay declarative in tarpit.conf.
    let rate = Number(r.variables.tarpit_rate) || defaultRateBytesPerSecond;
    let maxSeconds = Number(r.variables.tarpit_max_seconds) || defaultMaxSeconds;
    let filename = r.variables.tarpit_filename || 'production.conf';

    r.headersOut['Content-Type'] = 'text/plain';
    r.headersOut['Content-Disposition'] = 'attachment; filename=' + filename;
    // No Content-Length: the body is open-ended, so the response is chunked.
    r.headersOut['Cache-Control'] = 'no-store';
    r.status = 200;
    r.sendHeader();

    let started = Date.now();
    let sent = 0;
    let index = 0;

    let headerValues = [filename, httpTime(new Date())];
    let headerIndex = 0;
    r.send(format(headerTemplate, function () { return headerValues[headerIndex++]; }));

    while (true) {
        let elapsed = (Date.now() - started) / 1000;
        if (elapsed >= maxSeconds) { break; }

        // Pace against elapsed wall-clock time rather than sleeping per block:
        // blocks vary in size and timers have millisecond granularity, so
        // per-block sleeps drift well above the target rate. Sleep only while
        // we are ahead of the budget the rate allows so far.
        let budget = elapsed * rate;
        if (sent > budget) {
            await sleep(((sent - budget) / rate) * 1000);
        }

        let block = nextBlock(index);
        index += 1;

        // r.send throws once the client has gone away; that is the njs
        // equivalent of the Lua version noticing a failed print/flush.
        try {
            r.send(block);
        } catch (e) {
            r.log('tarpit: client gone after ' + sent + ' bytes: ' + e.message);
            return;
        }

        sent += block.length;
    }

    r.log('tarpit: held client for ' + maxSeconds + 's, sent ' + sent + ' bytes');
    r.finish();
}

export default { run };
