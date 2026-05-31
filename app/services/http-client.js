import axios from 'axios';
import http from 'http';
import https from 'https';

/**
 * Shared axios instance with HTTP keep-alive enabled.
 *
 * Reuses TCP connections across requests to the same host, eliminating the
 * TCP+TLS handshake overhead on every call. Critical for portals like Greenhouse,
 * Lever, and Ashby that issue hundreds of sequential requests to the same domain.
 *
 * All scrapers should import and use this instance instead of calling axios directly.
 */
const httpClient = axios.create({
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: 50 }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
    timeout: 15000,
    headers: {
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    },
});

export default httpClient;
