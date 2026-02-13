const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const usernameModal = document.getElementById('username-modal');
const usernameForm = document.getElementById('username-form');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');

// WebRTC Configuration
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

const myPeer = new RTCPeerConnection(iceServers); // Init with config
const peers = {};
let myStream;
let myUserId;
let myUsername;
let isConnected = false;
let isMuted = false;
let isDeafened = false;

// 1. Handle Username Submission
usernameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (username) {
        myUsername = username;
        usernameModal.classList.add('hidden');

        // Generate ID
        myUserId = 'user-' + Math.floor(Math.random() * 100000);

        // Join Text Chat immediately
        socket.emit('join-chat', { username: myUsername, userId: myUserId });
    }
});

// 2. Chat Logic
messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (message && myUsername) {
        socket.emit('send-message', {
            username: myUsername,
            message: message,
            roomId: 'general'
        });
        messageInput.value = '';
    }
});

socket.on('chat-message', (data) => {
    appendMessage(data);
});

socket.on('chat-history', (messages) => {
    messagesContainer.innerHTML = ''; // Clear placeholders
    messages.forEach(msg => appendMessage(msg));
    scrollToBottom();
});

function appendMessage(data) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message');

    const date = new Date(data.timestamp || Date.now());
    const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    messageElement.innerHTML = `
        <div class="message-header">
            <span class="message-username">${data.username}</span>
            <span class="message-timestamp">${timeString}</span>
        </div>
        <div class="message-content">${escapeHtml(data.message)}</div>
    `;

    messagesContainer.appendChild(messageElement);
    scrollToBottom();
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// 3. Voice Logic (Click to Join)
joinBtn.addEventListener('click', () => {
    if (isConnected) return;
    if (!myUsername) {
        // Show modal if not set
        usernameModal.classList.remove('hidden');
        return;
    }

    isConnected = true;
    joinBtn.classList.add('connected');
    const channelName = joinBtn.querySelector('.channel-icon').nextSibling;
    if (channelName) channelName.textContent = ' General (Connected)';

    navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
    }).then(stream => {
        myStream = stream;

        // Mute/Deafen State check
        myStream.getAudioTracks()[0].enabled = !isMuted;

        addVideoStream(createMyVideoElement(), stream);

        socket.on('user-connected', userId => {
            connectToNewUser(userId, stream);
        });

        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);

        socket.on('user-disconnected', userId => {
            if (peers[userId]) {
                peers[userId].close();
                delete peers[userId];
            }
            const video = document.getElementById(userId);
            if (video) video.remove();
        });

        // Join Voice Room
        socket.emit('join-room', 'general', myUserId);

    }).catch(error => {
        console.error('Error accessing media devices:', error);
        isConnected = false;
        joinBtn.classList.remove('connected');
        if (channelName) channelName.textContent = ' General';
        alert("Could not access microphone.");
    });
});

function createMyVideoElement() {
    const video = document.createElement('video');
    video.muted = true; // Always mute self
    return video;
}

function connectToNewUser(userId, stream) {
    const peer = createPeerConnection(userId);
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peers[userId] = peer;

    peer.createOffer().then(offer => {
        peer.setLocalDescription(offer);
        socket.emit('offer', { target: userId, caller: myUserId, sdp: offer });
    });
}

function handleOffer(payload) {
    const peer = createPeerConnection(payload.caller);
    peers[payload.caller] = peer;

    if (myStream) {
        myStream.getTracks().forEach(track => peer.addTrack(track, myStream));
    }

    peer.setRemoteDescription(payload.sdp).then(() => {
        return peer.createAnswer();
    }).then(answer => {
        peer.setLocalDescription(answer);
        socket.emit('answer', { target: payload.caller, caller: myUserId, sdp: answer });
    });
}

function handleAnswer(payload) {
    const peer = peers[payload.caller];
    if (peer) {
        peer.setRemoteDescription(payload.sdp);
    }
}

function handleIceCandidate(payload) {
    const peer = peers[payload.caller];
    if (peer) {
        peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
}

function createPeerConnection(targetUserId) {
    const peer = new RTCPeerConnection(iceServers);

    peer.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetUserId, caller: myUserId, candidate: event.candidate });
        }
    };

    peer.ontrack = event => {
        const audio = document.createElement('audio'); // Audio element
        audio.id = targetUserId;
        audio.autoplay = true; // Essential for auto-playing audio
        addVideoStream(audio, event.streams[0]);
    };

    return peer;
}

function addVideoStream(element, stream) {
    element.srcObject = stream;
    element.addEventListener('loadedmetadata', () => {
        element.play().catch(e => console.log("Play error:", e));
    });
    videoGrid.append(element);
}

// Controls
const muteBtn = document.getElementById('mic-btn');

muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (myStream) {
        myStream.getAudioTracks()[0].enabled = !isMuted;
    }
    muteBtn.innerHTML = isMuted ? '🔇' : '🎤';
    muteBtn.classList.toggle('muted', isMuted);
});

const deafenBtn = document.getElementById('deafen-btn');

deafenBtn.addEventListener('click', () => {
    isDeafened = !isDeafened;
    // For a real deafen, we'd mute all incoming audio elements.
    // Since we append videos to videoGrid, we can iterate them.
    const videos = videoGrid.querySelectorAll('audio');
    videos.forEach(v => {
        if (v !== myVideo) v.muted = isDeafened; // Mute others
        // Note: myVideo is always muted.
    });

    deafenBtn.innerHTML = isDeafened ? '🔇' : '🎧';
    deafenBtn.classList.toggle('deafened', isDeafened);
});
