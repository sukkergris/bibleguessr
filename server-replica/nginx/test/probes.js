// Probes that exercise the tarpit over real HTTP requests.
//
// These run inside the test container (js_content) rather than as a shell
// client, because the tarpit response is open-ended: curl/wget cannot read
// "for N seconds then stop" without the timeout killing the byte count.
//
// The Lua version used cosockets for that. njs has no cosocket API, so the
// reads go through ngx.fetch, which resolves once the body is complete. The
// tarpit endpoints used by the tests are therefore capped with
// $tarpit_max_seconds so every probe terminates on its own.

let TARPIT_ORIGIN = 'http://127.0.0.1:8095';

// Read a tarpit URL to completion, returning bytes read, elapsed seconds and
// the body. The endpoint must be capped, or this never resolves.
async function readAll(path) {
    let started = Date.now();
    let response = await ngx.fetch(TARPIT_ORIGIN + path);
    let body = await response.text();
    return {
        bytes: body.length,
        elapsed: (Date.now() - started) / 1000,
        body: body,
        headers: response.headers,
        status: response.status,
    };
}

// Is the tarpit still accepting connections and serving normally?
async function stillServing() {
    try {
        let response = await ngx.fetch(TARPIT_ORIGIN + '/');
        await response.text();
        return response.status === 200;
    } catch (e) {
        return false;
    }
}

export default { readAll, stillServing, TARPIT_ORIGIN };
