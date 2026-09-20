// Which location rule answers each scanner path, and at what rate.
import probes from 'probes.js';

// Every path is read to completion under the fixture's short cap, so the byte
// count reveals which rate tier answered it. That is what distinguishes the
// CMS rule (4 KB/s) from the generic .php rule (8 KB/s) -- both tarpit, but a
// location-ordering mistake silently downgrades CMS paths to the faster tier.
let cases = [
    { path: '/.env',         tier: 'generic' },
    { path: '/.git/config',  tier: 'generic' },
    { path: '/wp-login.php', tier: 'cms'     },
    { path: '/phpMyAdmin',   tier: 'cms'     },
    { path: '/index.php',    tier: 'php'     },
    { path: '/dns-query',    tier: 'generic' },
    { path: '/',             tier: 'normal'  },
];

function pad(text, width) {
    let out = String(text);
    while (out.length < width) { out += ' '; }
    return out;
}

async function run(r) {
    let lines = [];
    for (let i = 0; i < cases.length; i++) {
        let c = cases[i];
        try {
            let result = await probes.readAll(c.path);
            let kind = result.body.indexOf('normal') >= 0 ? 'normal' : 'tarpit';
            lines.push(pad(c.path, 18) + ' ' + pad(kind, 7) + ' ' +
                pad(c.tier, 8) + ' ' + result.bytes + ' bytes');
        } catch (e) {
            lines.push(pad(c.path, 18) + ' ERROR ' + e.message);
        }
    }
    r.return(200, lines.join('\n') + '\n');
}

export default { run };
