// Streaming rate matches the configured bytes/second.
import probes from 'probes.js';

let cases = [
    { path: '/_rate/slow', configured: 4096 },
    { path: '/_rate/fast', configured: 10240 },
];

async function run(r) {
    let lines = [];
    for (let i = 0; i < cases.length; i++) {
        let c = cases[i];
        try {
            let result = await probes.readAll(c.path);
            let measured = Math.round(result.bytes / result.elapsed);
            lines.push(c.path + ' configured=' + c.configured +
                ' measured= ' + measured + ' B/s bytes=' + result.bytes);
        } catch (e) {
            lines.push(c.path + ' ERROR ' + e.message);
        }
    }
    r.return(200, lines.join('\n') + '\n');
}

export default { run };
