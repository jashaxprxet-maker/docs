import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
const server = http.createServer();
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const clients = new Map();
wss.on('connection', (ws) => {
    const id = Math.random().toString(36).slice(2, 10);
    const client = { id, ws, last: Date.now() };
    clients.set(id, client);
    ws.send(JSON.stringify({ t: 'welcome', id }));
    broadcast({ t: 'join', id });
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(String(data));
            if (msg.t === 'state') {
                client.last = Date.now();
                // Relay position/rotation to others
                broadcast({ t: 'state', id, p: msg.p, r: msg.r }, id);
            }
            if (msg.t === 'shot') {
                broadcast({ t: 'shot', id, from: msg.from, dir: msg.dir }, id);
            }
            if (msg.t === 'hit') {
                broadcast({ t: 'hit', id: msg.id, amount: msg.amount });
            }
        }
        catch { }
    });
    ws.on('close', () => {
        clients.delete(id);
        broadcast({ t: 'leave', id });
    });
});
function broadcast(msg, exceptId) {
    const str = JSON.stringify(msg);
    for (const [cid, c] of clients) {
        if (cid === exceptId)
            continue;
        if (c.ws.readyState === WebSocket.OPEN)
            c.ws.send(str);
    }
}
server.listen(PORT, () => console.log(`WS server on :${PORT}`));
