import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    // TC-22: Stress testing - simulate a high volume of concurrent users
    stages: [
        { duration: '30s', target: 20 }, // Ramp up to 20 users
        { duration: '1m', target: 20 },  // Stay at 20 users
        { duration: '30s', target: 0 },  // Ramp down
    ],
    thresholds: {
        // TC-21: Verify system responds promptly (95% of requests < 500ms)
        http_req_duration: ['p(95)<500'],
    },
};

const BASE_URL = 'http://localhost:3000/api';

export default function () {
    // 1. Test Ping
    let res = http.get(`${BASE_URL}/test-ping`);
    check(res, { 'ping is 200': (r) => r.status === 200 });

    // 2. Test Listings (Public API)
    res = http.get(`${BASE_URL}/listings`);
    check(res, { 'listings is 200': (r) => r.status === 200 });

    sleep(1);
}
