import http from 'k6/http';

export const options = {
    vus: 20,
    duration: '30s',
};

export default function () {
    const res = http.get(
        'https://mathsmanthrarecordings-production.up.railway.app/'
    );

    if (res.status !== 200) {
        console.log(
            `FAIL Status: ${res.status} URL: ${res.url}`
        );
    }
}