'use strict';

/**
 * 洛雪音乐 (LX Music) 自定义音源脚本 - 纯净反混淆重构版
 * 平台支持: 酷我 (kw), 酷狗 (kg), 企鹅/QQ (tx), 网易云 (wy), 咪咕 (mg)
 * 仅用于学习逆向和交流，切勿用于商业用途。
 */

const {
    EVENT_NAMES,
    on: lxOn,
    send: lxSend,
    env: lxEnv,
    currentScriptInfo: lxScriptInfo,
    request: lxRequest,
    utils: lxUtils,
    version: lxVersion
} = globalThis.lx;

const lxHelper = {
    buffer: {
        from: lxUtils.buffer.from,
        bufToString: lxUtils.buffer.bufToString
    },
    crypto: {
        aesEncrypt: lxUtils.crypto.aesEncrypt,
        md5: lxUtils.crypto.md5,
        randomBytes: lxUtils.crypto.randomBytes,
        rsaEncrypt: lxUtils.crypto.rsaEncrypt
    }
};

const requestWithTimeout = function (...args) {
    setTimeout(() => {
        return lxRequest.apply(this, args);
    }, 500);
};

const SCRIPT_VERSION = "1.2.1";

const bufferToHex = (buffer) => {
    return lxVersion 
        ? lxHelper.buffer.bufToString(buffer, "hex") 
        : [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const aesEncryptHex = (text, key, iv, mode) => {
    if (!lxVersion) {
        mode = mode.split('-').pop();
    }
    return lxHelper.crypto.aesEncrypt(text, mode, key, iv);
};

const md5Hex = (text) => lxHelper.crypto.md5(text);

const generateWycheckToken = (url, version) => {
    let urlParts = url.split('//');
    let path = urlParts[1].substring(urlParts[1].indexOf('/'));
    if (path.indexOf('?') !== -1) {
        path = path.split('?')[0];
    }
    return lxHelper.crypto.md5(path + "wycheck" + version).substr(0, 16);
};

const fetchFromItooiAPI = (platform, songId, quality, os_plat, version, reject, resolve) => {
    const apiHostBase64 = "aHR0cDovL2x4Lml0b29pLmNuL29wZW5BcGkvcm91dGUvbHgvdjIvdXJsLw==";
    const apiHost = lxHelper.buffer.bufToString(lxHelper.buffer.from(apiHostBase64, "base64"), "utf-8");
    const apiUrl = `${apiHost}${platform}/${songId}/${quality}?p=${os_plat}&v=${version}`;
    
    requestWithTimeout(apiUrl, {
        method: "GET",
        headers: {
            'User-Agent': "lx-music request",
            'wycheck': generateWycheckToken(apiUrl, version)
        }
    }, (err, resp) => {
        if (err) return reject(err);
        if (resp.statusCode !== 200) return reject(new Error("failed"));
        resolve(resp.body.result);
    });
};

// ==========================================
// 酷我音乐 (Kuwo) 自定义加密算法 
// ==========================================
const kuwoCryptoAlgorithm = (function() {
    const C0 = [0x1fn, 0x0n, 0x1n, 0x2n, 0x3n, 0x4n, -0x1n, -0x1n, 0x3n, 0x4n, 0x5n, 0x6n, 0x7n, 0x8n, -0x1n, -0x1n, 0x7n, 0x8n, 0x9n, 0xan, 0xbn, 0xcn, -0x1n, -0x1n, 0xbn, 0xcn, 0xdn, 0xen, 0xfn, 0x10n, -0x1n, -0x1n, 0xfn, 0x10n, 0x11n, 0x12n, 0x13n, 0x14n, -0x1n, -0x1n, 0x13n, 0x14n, 0x15n, 0x16n, 0x17n, 0x18n, -0x1n, -0x1n, 0x17n, 0x18n, 0x19n, 0x1an, 0x1bn, 0x1cn, -0x1n, -0x1n, 0x1bn, 0x1cn, 0x1dn, 0x1en, 0x1fn, 0x1en, -0x1n, -0x1n];
    const C1 = [0x39n, 0x31n, 0x29n, 0x21n, 0x19n, 0x11n, 0x9n, 0x1n, 0x3bn, 0x33n, 0x2bn, 0x23n, 0x1bn, 0x13n, 0xbn, 0x3n, 0x3dn, 0x35n, 0x2dn, 0x25n, 0x1dn, 0x15n, 0xdn, 0x5n, 0x3fn, 0x37n, 0x2fn, 0x27n, 0x1fn, 0x17n, 0xfn, 0x7n, 0x38n, 0x30n, 0x28n, 0x20n, 0x18n, 0x10n, 0x8n, 0x0n, 0x3an, 0x32n, 0x2an, 0x22n, 0x1an, 0x12n, 0xan, 0x2n, 0x3cn, 0x34n, 0x2cn, 0x24n, 0x1cn, 0x14n, 0xcn, 0x4n, 0x3en, 0x36n, 0x2en, 0x26n, 0x1en, 0x16n, 0xen, 0x6n];
    const C2 = [0x27n, 0x7n, 0x2fn, 0xfn, 0x37n, 0x17n, 0x3fn, 0x1fn, 0x26n, 0x6n, 0x2en, 0xen, 0x36n, 0x16n, 0x3en, 0x1en, 0x25n, 0x5n, 0x2dn, 0xdn, 0x35n, 0x15n, 0x3dn, 0x1dn, 0x24n, 0x4n, 0x2cn, 0xcn, 0x34n, 0x14n, 0x3cn, 0x1cn, 0x23n, 0x3n, 0x2bn, 0xbn, 0x33n, 0x13n, 0x3bn, 0x1bn, 0x22n, 0x2n, 0x2an, 0xan, 0x32n, 0x12n, 0x3an, 0x1an, 0x21n, 0x1n, 0x29n, 0x9n, 0x31n, 0x11n, 0x39n, 0x19n, 0x20n, 0x0n, 0x28n, 0x8n, 0x30n, 0x10n, 0x38n, 0x18n];
    const C3 = [0x1n, 0x1n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x1n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x2n, 0x1n];
    const C4 = [0x0n, 0x100001n, 0x300003n];
    const BIT_MASKS = [0x1n, 0x2n, 0x4n, 0x8n, 0x10n, 0x20n, 0x40n, 0x80n, 0x100n, 0x200n, 0x400n, 0x800n, 0x1000n, 0x2000n, 0x4000n, 0x8000n, 0x10000n, 0x20000n, 0x40000n, 0x80000n, 0x100000n, 0x200000n, 0x400000n, 0x800000n, 0x1000000n, 0x2000000n, 0x4000000n, 0x8000000n, 0x10000000n, 0x20000000n, 0x40000000n, 0x80000000n, 0x100000000n, 0x200000000n, 0x400000000n, 0x800000000n, 0x1000000000n, 0x2000000000n, 0x4000000000n, 0x8000000000n, 0x10000000000n, 0x20000000000n, 0x40000000000n, 0x80000000000n, 0x100000000000n, 0x200000000000n, 0x400000000000n, 0x800000000000n, 0x1000000000000n, 0x2000000000000n, 0x4000000000000n, 0x8000000000000n, 0x10000000000000n, 0x20000000000000n, 0x40000000000000n, 0x80000000000000n, 0x100000000000000n, 0x200000000000000n, 0x400000000000000n, 0x800000000000000n, 0x1000000000000000n, 0x2000000000000000n, 0x4000000000000000n, -0x8000000000000000n];
    const P = [0xfn, 0x6n, 0x13n, 0x14n, 0x1cn, 0xbn, 0x1bn, 0x10n, 0x0n, 0xen, 0x16n, 0x19n, 0x4n, 0x11n, 0x1en, 0x9n, 0x1n, 0x7n, 0x17n, 0xdn, 0x1fn, 0x1an, 0x2n, 0x8n, 0x12n, 0xcn, 0x1dn, 0x5n, 0x15n, 0xan, 0x3n, 0x18n];
    const Q = [0x38n, 0x30n, 0x28n, 0x20n, 0x18n, 0x10n, 0x8n, 0x0n, 0x39n, 0x31n, 0x29n, 0x21n, 0x19n, 0x11n, 0x9n, 0x1n, 0x3an, 0x32n, 0x2an, 0x22n, 0x1an, 0x12n, 0xan, 0x2n, 0x3bn, 0x33n, 0x2bn, 0x23n, 0x3en, 0x36n, 0x2en, 0x26n, 0x1en, 0x16n, 0xen, 0x6n, 0x3dn, 0x35n, 0x2dn, 0x25n, 0x1dn, 0x15n, 0xdn, 0x5n, 0x3cn, 0x34n, 0x2cn, 0x24n, 0x1cn, 0x14n, 0xcn, 0x4n, 0x1bn, 0x13n, 0xbn, 0x3n];
    const S = [0xdn, 0x10n, 0xan, 0x17n, 0x0n, 0x4n, -0x1n, -0x1n, 0x2n, 0x1bn, 0xen, 0x5n, 0x14n, 0x9n, -0x1n, -0x1n, 0x16n, 0x12n, 0xbn, 0x3n, 0x19n, 0x7n, -0x1n, -0x1n, 0xfn, 0x6n, 0x1an, 0x13n, 0xcn, 0x1n, -0x1n, -0x1n, 0x28n, 0x33n, 0x1en, 0x24n, 0x2en, 0x36n, -0x1n, -0x1n, 0x1dn, 0x27n, 0x32n, 0x2cn, 0x20n, 0x2fn, -0x1n, -0x1n, 0x2bn, 0x30n, 0x26n, 0x37n, 0x21n, 0x34n, -0x1n, -0x1n, 0x2dn, 0x29n, 0x31n, 0x23n, 0x1cn, 0x1fn, -0x1n, -0x1n];
    const SBOX = [[0xen, 0x4n, 0x3n, 0xfn, 0x2n, 0xdn, 0x5n, 0x3n, 0xdn, 0xen, 0x6n, 0x9n, 0xbn, 0x2n, 0x0n, 0x5n, 0x4n, 0x1n, 0xan, 0xcn, 0xfn, 0x6n, 0x9n, 0xan, 0x1n, 0x8n, 0xcn, 0x7n, 0x8n, 0xbn, 0x7n, 0x0n, 0x0n, 0xfn, 0xan, 0x5n, 0xen, 0x4n, 0x9n, 0xan, 0x7n, 0x8n, 0xcn, 0x3n, 0xdn, 0x1n, 0x3n, 0x6n, 0xfn, 0xcn, 0x6n, 0xbn, 0x2n, 0x9n, 0x5n, 0x0n, 0x4n, 0x2n, 0xbn, 0xen, 0x1n, 0x7n, 0x8n, 0xdn], [0xfn, 0x0n, 0x9n, 0x5n, 0x6n, 0xan, 0xcn, 0x9n, 0x8n, 0x7n, 0x2n, 0xcn, 0x3n, 0xdn, 0x5n, 0x2n, 0x1n, 0xen, 0x7n, 0x8n, 0xbn, 0x4n, 0x0n, 0x3n, 0xen, 0xbn, 0xdn, 0x6n, 0x4n, 0x1n, 0xan, 0xfn, 0x3n, 0xdn, 0xcn, 0xbn, 0xfn, 0x3n, 0x6n, 0x0n, 0x4n, 0xan, 0x1n, 0x7n, 0x8n, 0x4n, 0xbn, 0xen, 0xdn, 0x8n, 0x0n, 0x6n, 0x2n, 0xfn, 0x9n, 0x5n, 0x7n, 0x1n, 0xan, 0xcn, 0xen, 0x2n, 0x5n, 0x9n], [0xan, 0xdn, 0x1n, 0xbn, 0x6n, 0x8n, 0xbn, 0x5n, 0x9n, 0x4n, 0xcn, 0x2n, 0xfn, 0x3n, 0x2n, 0xen, 0x0n, 0x6n, 0xdn, 0x1n, 0x3n, 0xfn, 0x4n, 0xan, 0xen, 0x9n, 0x7n, 0xcn, 0x5n, 0x0n, 0x8n, 0x7n, 0xdn, 0x1n, 0x2n, 0x4n, 0x3n, 0x6n, 0xcn, 0xbn, 0x0n, 0xdn, 0x5n, 0xen, 0x6n, 0x8n, 0xfn, 0x2n, 0x7n, 0xan, 0x8n, 0xfn, 0x4n, 0x9n, 0xbn, 0x5n, 0x9n, 0x0n, 0xen, 0x3n, 0xan, 0x7n, 0x1n, 0xcn], [0x7n, 0xan, 0x1n, 0xfn, 0x0n, 0xcn, 0xbn, 0x5n, 0xen, 0x9n, 0x8n, 0x3n, 0x9n, 0x7n, 0x4n, 0x8n, 0xdn, 0x6n, 0x2n, 0x1n, 0x6n, 0xbn, 0xcn, 0x2n, 0x3n, 0x0n, 0x5n, 0xen, 0xan, 0xdn, 0xfn, 0x4n, 0xdn, 0x3n, 0x4n, 0x9n, 0x6n, 0xan, 0x1n, 0xcn, 0xbn, 0x0n, 0x2n, 0x5n, 0x0n, 0xdn, 0xen, 0x2n, 0x8n, 0xfn, 0x7n, 0x4n, 0xfn, 0x1n, 0xan, 0x7n, 0x5n, 0x6n, 0xcn, 0xbn, 0x3n, 0x8n, 0x9n, 0xen], [0x2n, 0x4n, 0x8n, 0xfn, 0x7n, 0xan, 0xdn, 0x6n, 0x4n, 0x1n, 0x3n, 0xcn, 0xbn, 0x7n, 0xen, 0x0n, 0xcn, 0x2n, 0x5n, 0x9n, 0xan, 0xdn, 0x0n, 0x3n, 0x1n, 0xbn, 0xfn, 0x5n, 0x6n, 0x8n, 0x9n, 0xen, 0xen, 0xbn, 0x5n, 0x6n, 0x4n, 0x1n, 0x3n, 0xan, 0x2n, 0xcn, 0xfn, 0x0n, 0xdn, 0x2n, 0x8n, 0x5n, 0xbn, 0x8n, 0x0n, 0xfn, 0x7n, 0xen, 0x9n, 0x4n, 0xcn, 0x7n, 0xan, 0x9n, 0x1n, 0xdn, 0x6n, 0x3n], [0xcn, 0x9n, 0x0n, 0x7n, 0x9n, 0x2n, 0xen, 0x1n, 0xan, 0xfn, 0x3n, 0x4n, 0x6n, 0xcn, 0x5n, 0xbn, 0x1n, 0xen, 0xdn, 0x0n, 0x2n, 0x8n, 0x7n, 0xdn, 0xfn, 0x5n, 0x4n, 0xan, 0x8n, 0x3n, 0xbn, 0x6n, 0xan, 0x4n, 0x6n, 0xbn, 0x7n, 0x9n, 0x0n, 0x6n, 0x4n, 0x2n, 0xdn, 0x1n, 0x9n, 0xfn, 0x3n, 0x8n, 0xfn, 0x3n, 0x1n, 0xen, 0xcn, 0x5n, 0xbn, 0x0n, 0x2n, 0xcn, 0xen, 0x7n, 0x5n, 0xan, 0x8n, 0xdn], [0x4n, 0x1n, 0x3n, 0xan, 0xfn, 0xcn, 0x5n, 0x0n, 0x2n, 0xbn, 0x9n, 0x6n, 0x8n, 0x7n, 0x6n, 0x9n, 0xbn, 0x4n, 0xcn, 0xfn, 0x0n, 0x3n, 0xan, 0x5n, 0xen, 0xdn, 0x7n, 0x8n, 0xdn, 0xen, 0x1n, 0x2n, 0xdn, 0x6n, 0xen, 0x9n, 0x4n, 0x1n, 0x2n, 0xen, 0xbn, 0xdn, 0x5n, 0x0n, 0x1n, 0xan, 0x8n, 0x3n, 0x0n, 0xbn, 0x3n, 0x5n, 0x9n, 0x4n, 0xfn, 0x2n, 0x7n, 0x8n, 0xcn, 0xfn, 0xan, 0x7n, 0x6n, 0xcn], [0xdn, 0x7n, 0xan, 0x0n, 0x6n, 0x9n, 0x5n, 0xfn, 0x8n, 0x4n, 0x3n, 0xan, 0xbn, 0xen, 0xcn, 0x5n, 0x2n, 0xbn, 0x9n, 0x6n, 0xfn, 0xcn, 0x0n, 0x3n, 0x4n, 0x1n, 0xen, 0xdn, 0x1n, 0x2n, 0x7n, 0x8n, 0x1n, 0x2n, 0xcn, 0xfn, 0xan, 0x4n, 0x0n, 0x3n, 0xdn, 0xen, 0x6n, 0x9n, 0x7n, 0x8n, 0x9n, 0x6n, 0xfn, 0x1n, 0x5n, 0xcn, 0x3n, 0xan, 0xen, 0x5n, 0x8n, 0x7n, 0xbn, 0x0n, 0x4n, 0xdn, 0x2n, 0xbn]];
    
    const applyMask = (arr, len, val) => {
        let res = 0x0n;
        for (let i = 0; i < len; i++) {
            if (arr[i] < 0 || BigInt(val & BIT_MASKS[arr[i]]) == 0x0n) continue;
            res |= BIT_MASKS[i];
        }
        return res;
    };
    
    const encryptBlock = (keyArr, data) => {
        let res = applyMask(C1, 0x40n, data);
        let blocks = [0xffffffffn & res, (-0x100000000n & res) >> 0x20n];
        
        for (let i = 0; i < 16; i++) {
            let rightBlock = applyMask(C0, 0x40n, blocks[1]) ^ keyArr[i];
            let sboxOut = 0x0n;
            for (let j = 7; j > -1; j--) {
                const b = 0xffn & rightBlock >> BigInt(j) * 0x8n;
                sboxOut <<= 0x4n;
                sboxOut |= SBOX[j][b];
            }
            rightBlock = applyMask(P, 0x20n, sboxOut);
            
            let temp = blocks[0];
            blocks[0] = blocks[1];
            blocks[1] = temp ^ rightBlock;
        }
        
        blocks = blocks.reverse();
        res = -0x100000000n & blocks[1] << 0x20n | 0xffffffffn & blocks[0];
        return applyMask(C2, 0x40n, res);
    };
    
    const prepareKey = (key, keyArr) => {
        let keyVal = applyMask(Q, 0x38n, key);
        for (let i = 0; i < 16; i++) {
            keyVal = (keyVal & C4[C3[i]]) << 0x1cn - C3[i] | (keyVal & ~C4[C3[i]]) >> C3[i];
            keyArr[i] = applyMask(S, 0x40n, keyVal);
        }
    };
    
    return (text, keyStr = "ylzsxkwm") => {
        let keyInt = 0x0n;
        for (let i = 0; i < 8; i++) {
            keyInt |= BigInt(keyStr.charCodeAt(i)) << BigInt(i) * 0x8n;
        }
        
        let blockCount = Math.floor(text.length / 8);
        let keyArr = new Array(16).fill(0x0n);
        prepareKey(keyInt, keyArr);
        
        let dataBlocks = new Array(blockCount).fill(0x0n);
        for (let i = 0; i < blockCount; i++) {
            for (let j = 0; j < 8; j++) {
                dataBlocks[i] |= BigInt(text.charCodeAt(j + i * 8)) << BigInt(j) * 0x8n;
            }
        }
        
        let cipherBlocks = new Array(Math.floor((1 + 8 * (blockCount + 1)) / 8)).fill(0x0n);
        for (let i = 0; i < blockCount; i++) {
            cipherBlocks[i] = encryptBlock(keyArr, dataBlocks[i]);
        }
        
        let remainingStr = text.substring(blockCount * 8);
        let lastBlock = 0x0n;
        for (let i = 0; i < text.length % 8; i++) {
            lastBlock |= BigInt(remainingStr.charCodeAt(i)) << BigInt(i) * 0x8n;
        }
        cipherBlocks[blockCount] = encryptBlock(keyArr, lastBlock);
        
        let resArr = new Array(8 * cipherBlocks.length).fill(0);
        let idx = 0;
        cipherBlocks.forEach(block => {
            for (let i = 0; i < 8; i++) {
                resArr[idx++] = Number(0xffn & block >> BigInt(i) * 0x8n);
            }
        });
        
        return resArr;
    };
})();

// ==========================================
// User Agent Lists
// ==========================================
const USER_AGENTS = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1", 
    "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36", 
    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36", 
    "Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36", 
    "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_2 like Mac OS X) AppleWebKit/603.2.4 (KHTML, like Gecko) Mobile/14F89;GameHelper", 
    "Mozilla/5.0 (iPhone; CPU iPhone OS 10_0 like Mac OS X) AppleWebKit/602.1.38 (KHTML, like Gecko) Version/10.0 Mobile/14A300 Safari/602.1", 
    "Mozilla/5.0 (iPad; CPU OS 10_0 like Mac OS X) AppleWebKit/602.1.38 (KHTML, like Gecko) Version/10.0 Mobile/14A300 Safari/602.1", 
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:46.0) Gecko/20100101 Firefox/46.0", 
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Safari/537.36", 
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/603.2.4 (KHTML, like Gecko) Version/10.1.1 Safari/603.2.4", 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:46.0) Gecko/20100101 Firefox/46.0", 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36", 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/13.10586"
];

const getRandomUserAgent = type => {
    let index = 0;
    if (type === "mobile") {
        index = Math.floor(Math.random() * 7);
    } else if (type === 'pc') {
        index = Math.floor(Math.random() * 5) + 8;
    } else {
        index = Math.floor(Math.random() * USER_AGENTS.length);
    }
    return USER_AGENTS[index];
};


// ==========================================
// 核心逻辑: 五大平台音源解析
// ==========================================

const KuwoLogic = {
    info: {
        name: "酷我音乐",
        type: "music",
        actions: ["musicUrl"]
    },
    musicUrl({ songmid }, quality) {
        let bitrate;
        let format;
        switch (quality) {
            case "128k": bitrate = "128kmp3"; format = "mp3"; break;
            case "192k": bitrate = "192kmp3"; format = "mp3"; break;
            case "320k": bitrate = "320kmp3"; format = "mp3"; break;
            case "ape": bitrate = "2000kape"; format = "ape"; break;
            case "flac": bitrate = "2000kflac"; format = "flac"; break;
            case "flac24bit": bitrate = "4000kflac"; format = "flac"; break;
            default: bitrate = "128kmp3"; format = "mp3"; break;
        }

        const params = `type=convert_url&br=${bitrate}&format=${format}&sig=0&rid=${songmid}&network=wifi&response=url&prod=kwplayer_ar_10.3.3.0`;
        const endpoint = lxHelper.buffer.bufToString(lxHelper.buffer.from("aHR0cDovL21vYmkua3V3by5jbi9tb2JpLnM/Zj1rdXdvJnE9", "base64"), "utf-8"); // http://mobi.kuwo.cn/mobi.s?f=kuwo&q=
        
        // kuwo enc -> base64
        const encBytes = kuwoCryptoAlgorithm(params);
        const qParams = lxHelper.buffer.bufToString(encBytes, "base64");
        const apiUrl = endpoint + qParams;

        return new Promise((resolve, reject) => {
            requestWithTimeout(apiUrl, {
                method: "GET",
                headers: {
                    'User-Agent': getRandomUserAgent("mobile"),
                    'Referer': "http://kuwo.cn/"
                }
            }, (err, resp) => {
                if (err) return reject(err);
                if (resp.statusCode !== 200) return reject(new Error("failed"));
                
                const bodyStr = resp.body;
                if (bodyStr.includes("bitrate=1\r\n")) return reject(new Error("failed"));
                
                const match = bodyStr.match(/url=(.+)/);
                if (!match) return reject(new Error("failed"));
                
                resolve(match[1].split('?')[0]);
            });
        });
    }
};

const KugouLogic = {
    info: {
        name: "酷狗音乐",
        type: "music",
        actions: ["musicUrl"]
    },
    musicUrl({ hash, albumId, platform, version }, quality) {
        const endpoint = lxHelper.buffer.bufToString(lxHelper.buffer.from("aHR0cHM6Ly93d3dhcGkua3Vnb3UuY29tL3l5L2luZGV4LnBocD9yPXBsYXkvZ2V0ZGF0YSZoYXNoPQ==", "base64"), "utf-8"); // https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=
        const apiUrl = `${endpoint}${hash}&dfid=dfid&mid=mid&platid=4&album_id=${albumId}`;
        
        return new Promise((resolve, reject) => {
            requestWithTimeout(apiUrl, {
                method: "GET"
            }, (err, resp) => {
                if (err) return fetchFromItooiAPI("kugou", hash, quality, platform, version, reject, resolve);
                
                const body = resp.body;
                if (body.status !== 1) return fetchFromItooiAPI("kugou", hash, quality, platform, version, reject, resolve);
                if (body.data.privilege > 9) return fetchFromItooiAPI("kugou", hash, quality, platform, version, reject, resolve);
                
                resolve(body.data.play_url);
            });
        });
    }
};

const TencentLogic = {
    info: {
        name: "企鹅音乐",
        type: "music",
        actions: ["musicUrl"]
    },
    musicUrl({ songmid, tencentCookie, platform, version }, quality) {
        let filenamePrefix;
        switch (quality) {
            case "128k": filenamePrefix = "M5000.mp3"; break;
            case "320k": filenamePrefix = "M8000.mp3"; break;
            case "flac": filenamePrefix = "F0000.flac"; break;
        }
        
        const endpoint = lxHelper.buffer.bufToString(lxHelper.buffer.from("aHR0cHM6Ly91LnkucXEuY29tL2NnaS1iaW4vbXVzaWN1LmZjZz9kYXRhPXsicXVlcnl2a2V5Ijp7Im1ldGhvZCI6IkNnaUdldFZrZXkiLCJtb2R1bGUiOiJ2a2V5LkdldFZrZXlTZXJ2ZXIiLCJwYXJhbSI6eyJjaGVja2xpbWl0IjowLCJjdHgiOjEsImRvd25sb2FkZnJvbSI6MCwidWluIjoiMCIsImZpbGVuYW1lIjpbIg==", "base64"), "utf-8");
        const apiUrl = `${endpoint}${filenamePrefix}"],"guid":"0","songmid":["${songmid}"]}}}`;
        
        return new Promise((resolve, reject) => {
            requestWithTimeout(apiUrl, {
                method: "GET",
                headers: {
                    'User-Agent': getRandomUserAgent('pc'),
                    'origin': "https://y.qq.com",
                    'referer': "https://y.qq.com/portal/search.html",
                    'cookie': tencentCookie
                }
            }, (err, resp) => {
                if (err) return fetchFromItooiAPI('qq', songmid, quality, platform, version, reject, resolve);
                if (resp.statusCode !== 200) return fetchFromItooiAPI('qq', songmid, quality, platform, version, reject, resolve);
                
                const purl = resp.body.queryvkey?.data?.midurlinfo?.[0]?.purl;
                if (!purl) return fetchFromItooiAPI('qq', songmid, quality, platform, version, reject, resolve);
                
                const streamHost = lxHelper.buffer.bufToString(lxHelper.buffer.from("aHR0cDovL3dzLnN0cmVhbS5xcW11c2ljLnFxLmNvbS8=", "base64"), "utf-8"); // http://ws.stream.qqmusic.qq.com/
                resolve(`${streamHost}${purl}`);
            });
        });
    }
};

const NeteaseLogic = {
    info: {
        name: "网易音乐",
        type: "music",
        actions: ["musicUrl"]
    },
    musicUrl({ songmid, neteaseCookie }, quality) {
        const qualityMap = {
            "128k": 128000,
            "320k": 320000,
            "flac": 999000
        };
        const bitrate = qualityMap[quality];
        
        const apiUrl = lxHelper.buffer.bufToString(lxHelper.buffer.from("aHR0cHM6Ly9pbnRlcmZhY2UzLm11c2ljLjE2My5jb20vZWFwaS9zb25nL2VuaGFuY2UvcGxheWVyL3VybA==", "base64"), "utf-8"); // https://interface3.music.163.com/eapi/song/enhance/player/url
        const reqPath = "/api/song/enhance/player/url";
        
        const payload = {
            ids: `[${songmid}]`,
            br: bitrate
        };
        
        // 网易云 eapi 签名算法
        const payloadStr = JSON.stringify(payload);
        const hashStr = `nobody${reqPath}use${payloadStr}md5forencrypt`;
        const md5Hash = md5Hex(hashStr);
        const encryptTarget = `${reqPath}-36cd479b6b5-${payloadStr}-36cd479b6b5-${md5Hash}`;
        const aesKey = "e82ckenh8dichen8";
        
        const formParams = {
            params: bufferToHex(aesEncryptHex(encryptTarget, aesKey, '', "aes-128-ecb")).toUpperCase()
        };

        return new Promise((resolve, reject) => {
            requestWithTimeout(apiUrl, {
                method: "POST",
                form: formParams,
                headers: {
                    cookie: "os=pc;" + neteaseCookie
                }
            }, (err, resp) => {
                if (err) return reject(err);
                const url = resp.body?.data?.[0]?.url;
                if (!url) return reject(new Error("failed"));
                resolve(url);
            });
        });
    }
};

const MiguLogic = {
    info: {
        name: "咪咕音乐",
        type: "music",
        actions: ["musicUrl"]
    },
    musicUrl({ copyrightId, platform, version }, quality) {
        const apiHostBase64 = "aHR0cDovL2x4Lml0b29pLmNuL29wZW5BcGkvcm91dGUvbHgvdjIvdXJsLw=="; // http://lx.itooi.cn/openApi/route/lx/v2/url/
        const apiHost = lxHelper.buffer.bufToString(lxHelper.buffer.from(apiHostBase64, "base64"), "utf-8");
        const apiUrl = `${apiHost}migu/${copyrightId}/${quality}?p=${platform}&v=${version}`;
        
        return new Promise((resolve, reject) => {
            requestWithTimeout(apiUrl, {
                method: "GET",
                headers: {
                    'User-Agent': "lx-music request",
                    'wycheck': generateWycheckToken(apiUrl, version)
                }
            }, (err, resp) => {
                if (err) return reject(err);
                if (resp.statusCode !== 200) return reject(new Error("failed"));
                resolve(resp.body.result);
            });
        });
    }
};

const MusicSources = {
    kw: KuwoLogic,
    kg: KugouLogic,
    tx: TencentLogic,
    wy: NeteaseLogic,
    mg: MiguLogic
};

// ==========================================
// 初始化 & 防盗用检验
// ==========================================
const verifyClientVersion = () => {
    if (!lxScriptInfo || !lxEnv) {
        lxSend(EVENT_NAMES.updateAlert, {
            'log': "加载音源脚本失败，请前往下载最新版本",
            'updateUrl': "https://www.sixyin.com"
        });
        throw new Error("当前客户端不支持，请更新至最新版本！");
    }
    
    let name = lxScriptInfo.name?.trim();
    let desc = lxScriptInfo.description?.trim();
    let ver = lxScriptInfo.version?.trim().replace('v', '');
    
    if (name !== "六音音源" || desc !== "v1.2.1 如失效请前往 www.sixyin.com 下载最新版本" || ver !== "1.2.1") {
        lxSend(EVENT_NAMES.updateAlert, {
            'log': "加载音源脚本失败，请前往下载最新版本",
            'updateUrl': "https://www.sixyin.com"
        });
        throw new Error("加载音源脚本失败，请前往 http://www.sixyin.com 下载最新版本！");
    }
    
    const verifyApi = lxHelper.buffer.bufToString(lxHelper.buffer.from("aHR0cDovL3d3dy5oaWJhaS5jbi9hcGkucGhwP3A9", "base64"), "utf-8"); // http://www.hibai.cn/api.php?p=
    const apiUrl = `${verifyApi}${lxEnv}&v=${ver}`;
    
    return new Promise((resolve, reject) => {
        requestWithTimeout(apiUrl, { method: "GET" }, (err, resp) => {
            if (err || resp.statusCode !== 200) {
                reject("当前版本音源已关闭，请前往 http://www.sixyin.com 下载最新版本！");
            } else {
                resolve(resp.body);
            }
        });
    });
};

const parseCookies = (script) => {
    const rx = /@([^\s]+)\s([^\s;]+)/g;
    let match;
    const result = {};
    while ((match = rx.exec(script)) !== null) {
        result[match[1]] = match[2].trim();
    }
    return result;
};

// 启动注册
verifyClientVersion().then(verifyData => {
    let qualities = ["128k"];
    let platforms = [];
    
    if (verifyData.success) {
        qualities = verifyData.qualityList;
        platforms = verifyData.platformList;
        
        let cookies = parseCookies(lxScriptInfo.rawScript);
        let wyCookie = cookies.netease;
        if (wyCookie && wyCookie.trim().replace("MUSIC_U=;", '').length > 0) {
            platforms.push('wy');
        }
        
        let txCookie = cookies.tencent;
        if (txCookie && txCookie.trim().indexOf("ts_last=y.qq.com/n/ryqq/album;") < 0) {
            txCookie = '';
        }
        
        lxOn(EVENT_NAMES.request, ({ source, action, info }) => {
            info.musicInfo.platform = lxEnv;
            info.musicInfo.version = lxScriptInfo.version;
            info.musicInfo.neteaseCookie = wyCookie;
            info.musicInfo.tencentCookie = txCookie;
            
            if (action === "musicUrl") {
                return MusicSources[source].musicUrl(info.musicInfo, info.type).catch(err => {
                    console.log(err.message);
                    return Promise.reject(err);
                });
            }
        });
        
        const sourceInfos = {};
        for (const [key, source] of Object.entries(MusicSources)) {
            if (platforms.includes(key)) {
                source.info.qualitys = qualities;
                sourceInfos[key] = source.info;
            }
        }
        
        lxSend(EVENT_NAMES.inited, {
            openDevTools: false,
            sources: sourceInfos
        });
    } else {
        throw new Error("当前版本音源已关闭，请前往 http://www.sixyin.com 下载最新版本！");
    }
}).catch(err => {
    console.log(err);
    throw new Error(err);
});
