const crypto = require('crypto');

async function requestWithTimeout(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    let fetchOptions = {
        method: options.method || 'GET',
        headers: options.headers || {},
        signal: controller.signal
    };

    if (options.form) {
        fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        fetchOptions.body = new URLSearchParams(options.form).toString();
    }

    try {
        const res = await fetch(url, fetchOptions);
        let body;
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('json')) {
            body = await res.json();
        } else {
            body = await res.text();
            try {
                body = JSON.parse(body);
            } catch(e) {}
        }
        
        return {
            statusCode: res.status,
            body: body
        };
    } catch (err) {
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

const md5Hex = (text) => crypto.createHash('md5').update(text).digest('hex');

const generateWycheckToken = (url, version) => {
    let urlParts = url.split('//');
    if (!urlParts[1]) return '';
    let path = urlParts[1].substring(urlParts[1].indexOf('/'));
    if (path.indexOf('?') !== -1) {
        path = path.split('?')[0];
    }
    return md5Hex(path + "wycheck" + version).substr(0, 16);
};

const fetchFromItooiAPI = async (platform, songId, quality, os_plat, version) => {
    const apiHostBase64 = "aHR0cDovL2x4Lml0b29pLmNuL29wZW5BcGkvcm91dGUvbHgvdjIvdXJsLw==";
    const apiHost = Buffer.from(apiHostBase64, "base64").toString("utf-8");
    const apiUrl = `${apiHost}${platform}/${songId}/${quality}?p=${os_plat}&v=${version}`;
    
    console.log('[Itooi API]', apiUrl);
    
    try {
        const res = await requestWithTimeout(apiUrl, {
            method: "GET",
            headers: {
                'User-Agent': "lx-music request",
                'wycheck': generateWycheckToken(apiUrl, version)
            }
        });
        console.log('[Itooi API result]', res.body);
    } catch (e) {
        console.log('[Itooi API error]', e.message);
    }
};

(async () => {
    // try fetching from the proxy (which is the fallback for kg, tx, and only way for mg)
    await fetchFromItooiAPI('mg', '60054701923', '128k', 'pc', '1.2.1');
})();
