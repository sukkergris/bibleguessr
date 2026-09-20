// max_seconds must end the response instead of streaming forever.
import probes from 'probes.js';

async function run(r) {
    try {
        let result = await probes.readAll('/_capped');   // endpoint is capped at 2s
        r.return(200, 'elapsed=' + result.elapsed.toFixed(1) +
            ' bytes=' + result.bytes + '\n');
    } catch (e) {
        r.return(200, 'ERROR: ' + e.message + '\n');
    }
}

export default { run };
