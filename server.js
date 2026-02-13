const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database Setup
const dbPath = path.resolve(__dirname, 'chat.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            message TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    }
});

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', socket => {
    console.log('User connected', socket.id);

    // VOICE: Join Room
    socket.on('join-room', (roomId, userId) => {
        console.log(`User ${userId} joined room ${roomId}`);
        socket.join(roomId);
        socket.to(roomId).emit('user-connected', userId);

        socket.on('disconnect', () => {
            console.log(`User ${userId} disconnected`);
            socket.to(roomId).emit('user-disconnected', userId);
        });

        // WebRTC Signaling
        socket.on('offer', (payload) => {
            io.to(payload.target).emit('offer', payload);
        });

        socket.on('answer', (payload) => {
            io.to(payload.target).emit('answer', payload);
        });

        socket.on('ice-candidate', (payload) => {
            io.to(payload.target).emit('ice-candidate', payload);
        });
    });

    // CHAT: Join & History
    socket.on('join-chat', (data) => {
        // Retrieve last 50 messages
        db.all(`SELECT username, message, timestamp FROM messages ORDER BY timestamp DESC LIMIT 50`, [], (err, rows) => {
            if (err) {
                console.error(err);
                return;
            }
            // Rows are in desc order (newest first), reverse them for chat display
            socket.emit('chat-history', rows.reverse());
        });
    });

    // CHAT: Send Message
    socket.on('send-message', (data) => {
        const { username, message, roomId } = data;
        const timestamp = new Date().toISOString();

        // Save to DB
        db.run(`INSERT INTO messages (username, message, timestamp) VALUES (?, ?, ?)`, [username, message, timestamp], function (err) {
            if (err) {
                return console.error(err.message);
            }
            // Broadcast to everyone (including sender for simplicity, or exclude sender if optimistically updating UI)
            io.emit('chat-message', { username, message, timestamp });
        });
    });
});


const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
