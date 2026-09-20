// Response shape: chunked, no Content-Length, attachment filename, generated
// header appears exactly once, and two requests differ.
import probes from 'probes.js';

async function run(r) {
    let a, b;
    try {
        a = await probes.readAll('/_capped');
        b = await probes.readAll('/_capped');
    } catch (e) {
        r.return(200, 'ERROR: probe failed: ' + e.message + '\n');
        return;
    }

    let transferEncoding = a.headers.get('Transfer-Encoding') || '';
    let contentLength = a.headers.get('Content-Length');
    let disposition = a.headers.get('Content-Disposition') || '';

    let generated = a.body.split('Generated').length - 1;

    let lines = [
        'chunked: ' + (transferEncoding.toLowerCase() === 'chunked'),
        'no-content-length: ' + (contentLength === null),
        'attachment: ' + (disposition.indexOf('attachment; filename=production.conf') >= 0),
        'generated-headers: ' + generated,
        'bodies-differ: ' + (a.body !== b.body),
        'has-bait: ' + (a.body.indexOf('[auth]') >= 0 && a.body.indexOf('api_key') >= 0),
    ];
    r.return(200, lines.join('\n') + '\n');
}

export default { run };
