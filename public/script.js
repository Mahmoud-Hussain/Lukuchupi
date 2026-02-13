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

const myPeer = new RTCPeerConnection(iceServers);
const peers = {};
const iceCandidateQueue = {}; // Queue for early candidates

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

        // Update User Interface (Sidebar)
        const sidebarUsername = document.querySelector('.user-info .username');
        const sidebarAvatar = document.querySelector('.user-info .avatar');
        if (sidebarUsername) sidebarUsername.textContent = myUsername;
        if (sidebarAvatar) sidebarAvatar.textContent = myUsername.charAt(0).toUpperCase();

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
    messagesContainer.innerHTML = '';
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
        usernameModal.classList.remove('hidden');
        return;
    }

    // Animation Start
    joinBtn.classList.add('joining');

    setTimeout(() => {
        initializeVoiceConnection();
    }, 600);
});

function initializeVoiceConnection() {
    navigator.mediaDevices.getUserMedia({
        video: false,
        audio: true
    }).then(stream => {
        myStream = stream;

        if (myStream.getAudioTracks().length > 0) {
            myStream.getAudioTracks()[0].enabled = !isMuted;
        }

        // Add my own stream (muted)
        // Note: For audio-only, we don't strictly *need* to append our own stream to the DOM unless we want to monitor levels visually later.
        // But let's keep it consistent with the logic.
        // addVideoStream(createMyVideoElement(), stream); 

        socket.on('user-connected', userId => {
            console.log("User connected: " + userId);
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
            const audio = document.getElementById(userId);
            if (audio) audio.remove();
        });

        socket.emit('join-room', 'general', myUserId);

        // Success
        isConnected = true;
        joinBtn.classList.remove('joining');
        joinBtn.classList.add('connected');
        const channelName = joinBtn.querySelector('.channel-icon').nextSibling;
        if (channelName) channelName.textContent = ' General (Connected)';

    }).catch(error => {
        console.error('Error accessing media devices:', error);
        isConnected = false;
        joinBtn.classList.remove('joining');
        alert("Could not access microphone. Ensure permissions are granted.");
    });
}

function createMyVideoElement() {
    const video = document.createElement('audio');
    video.muted = true;
    return video;
}

function connectToNewUser(userId, stream) {
    const peer = createPeerConnection(userId);
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peers[userId] = peer;

    // Init candidate queue for this user
    iceCandidateQueue[userId] = [];

    peer.createOffer().then(offer => {
        peer.setLocalDescription(offer);
        socket.emit('offer', { target: userId, caller: myUserId, sdp: offer });
    });
}

function handleOffer(payload) {
    const peer = createPeerConnection(payload.caller);
    peers[payload.caller] = peer;

    // Init candidate queue
    if (!iceCandidateQueue[payload.caller]) {
        iceCandidateQueue[payload.caller] = [];
    }

    if (myStream) {
        myStream.getTracks().forEach(track => peer.addTrack(track, myStream));
    }

    peer.setRemoteDescription(payload.sdp).then(() => {
        // Apply buffered candidates
        const queue = iceCandidateQueue[payload.caller];
        if (queue) {
            queue.forEach(candidate => {
                peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.log("Buffered Candidate Error:", e));
            });
            delete iceCandidateQueue[payload.caller];
        }
        return peer.createAnswer();
    }).then(answer => {
        peer.setLocalDescription(answer);
        socket.emit('answer', { target: payload.caller, caller: myUserId, sdp: answer });
    });
}

function handleAnswer(payload) {
    const peer = peers[payload.caller];
    if (peer) {
        peer.setRemoteDescription(payload.sdp).then(() => {
            // Apply buffered candidates
            const queue = iceCandidateQueue[payload.caller];
            if (queue) {
                queue.forEach(candidate => {
                    peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.log("Buffered Candidate Error:", e));
                });
                delete iceCandidateQueue[payload.caller];
            }
        });
    }
}

function handleIceCandidate(payload) {
    const peer = peers[payload.caller];
    if (peer) {
        if (peer.remoteDescription) {
            peer.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(e => console.log("Candidate Error:", e));
        } else {
            // Buffer it
            if (!iceCandidateQueue[payload.caller]) {
                iceCandidateQueue[payload.caller] = [];
            }
            iceCandidateQueue[payload.caller].push(payload.candidate);
        }
    }
}

function createPeerConnection(targetUserId) {
    const peer = new RTCPeerConnection(iceServers);

    peer.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetUserId, caller: myUserId, candidate: event.candidate });
        }
    };

    peer.onconnectionstatechange = () => {
        console.log(`Connection state with ${targetUserId}: ${peer.connectionState}`);
    };

    peer.ontrack = event => {
        console.log("Receive Track from: " + targetUserId);
        const audio = document.createElement('audio');
        audio.id = targetUserId;
        audio.autoplay = true;
        audio.playsInline = true; // Important for iOS
        addVideoStream(audio, event.streams[0]);
    };

    return peer;
}

function addVideoStream(element, stream) {
    element.srcObject = stream;
    element.addEventListener('loadedmetadata', () => {
        element.play().catch(e => {
            console.log("Auto-play prevented. User interaction needed.", e);
        });
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
    const audios = videoGrid.querySelectorAll('audio');
    audios.forEach(a => {
        a.muted = isDeafened;
    });

    deafenBtn.innerHTML = isDeafened ? '🔇' : '🎧';
    deafenBtn.classList.toggle('deafened', isDeafened);
});
