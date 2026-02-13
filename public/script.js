const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const usernameModal = document.getElementById('username-modal');
const usernameForm = document.getElementById('username-form');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const voiceUserList = document.getElementById('voice-user-list');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const micSelect = document.getElementById('mic-select');
const micBar = document.getElementById('mic-bar');

// WebRTC Configuration
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

const myPeer = new RTCPeerConnection(iceServers);
const peers = {};
const iceCandidateQueue = {};

let myStream;
let myUserId;
let myUsername;
let isConnected = false;
let isMuted = false;
let isDeafened = false;

// Global Audio Context for VAD (Single Instance)
let globalAudioContext;
let vadIntervals = [];

// Debug Logger
function logDebug(msg) {
    console.log(`[DEBUG] ${msg}`);
    // Optional: visible logs for user to report issues
    // const div = document.createElement('div');
    // div.style.color = 'orange';
    // div.style.fontSize = '10px';
    // div.innerText = `[SYS] ${msg}`;
    // messagesContainer.appendChild(div);
    // messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

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

// 3. Voice Logic (Toggle to Join/Leave)
joinBtn.addEventListener('click', () => {
    if (!myUsername) {
        usernameModal.classList.remove('hidden');
        return;
    }

    if (isConnected) {
        leaveVoiceChannel();
    } else {
        // Init Audio Context on User Interaction
        if (!globalAudioContext) {
            globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (globalAudioContext.state === 'suspended') {
            globalAudioContext.resume();
        }

        // Animation Start
        joinBtn.classList.add('joining');
        setTimeout(() => {
            initializeVoiceConnection();
        }, 600);
    }
});

function leaveVoiceChannel() {
    if (!isConnected) return;

    // Cleanup WebRTC
    if (myStream) {
        myStream.getTracks().forEach(track => track.stop());
        myStream = null;
    }

    Object.keys(peers).forEach(key => {
        peers[key].close();
        delete peers[key];
    });

    // Backend Leave
    socket.emit('leave-room', 'general', myUserId);

    // Remove self from local list
    removeUserFromVoiceList(myUserId);

    // UI Reset
    isConnected = false;
    joinBtn.classList.remove('connected');
    const channelName = joinBtn.querySelector('.channel-icon').nextSibling;
    if (channelName) channelName.textContent = ' General';

    // Cleanup VAD
    if (vadIntervals) {
        vadIntervals.forEach(clearInterval);
        vadIntervals = [];
    }

    // Clear list
    voiceUserList.innerHTML = '';
}

function initializeVoiceConnection(deviceId = null) {
    const constraints = {
        video: false,
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
    };

    navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        myStream = stream;
        logDebug("Microphone access granted.");

        if (myStream.getAudioTracks().length > 0) {
            myStream.getAudioTracks()[0].enabled = !isMuted;
        }

        socket.on('room-users', (users) => {
            updateVoiceUserList(users);
        });

        // Handle new user connection (modified to accept object)
        socket.on('user-connected', ({ userId, username }) => {
            logDebug(`User connected: ${username} (${userId})`);
            addUserToVoiceList(userId, username);
            connectToNewUser(userId, stream);
        });

        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);

        socket.on('user-disconnected', userId => {
            logDebug(`User disconnected: ${userId}`);
            if (peers[userId]) {
                peers[userId].close();
                delete peers[userId];
            }
            const audio = document.getElementById(userId);
            if (audio) audio.remove();

            // Remove from list
            removeUserFromVoiceList(userId);
        });

        // Join Voice Room with Username
        socket.emit('join-room', 'general', myUserId, myUsername);

        // Success
        isConnected = true;
        joinBtn.classList.remove('joining');
        joinBtn.classList.add('connected');
        const channelName = joinBtn.querySelector('.channel-icon').nextSibling;
        if (channelName) channelName.textContent = ' General (Connected)';

        // Setup Mic Test Visualizer if Settings Open
        setupMicVisualizer(stream);

        // Start VAD for Self
        setupVoiceActivityDetection(stream, myUserId);

    }).catch(error => {
        console.error('Error accessing media devices:', error);
        isConnected = false;
        joinBtn.classList.remove('joining');
        alert("Could not access microphone.");
    });
}

function updateVoiceUserList(users) {
    voiceUserList.innerHTML = ''; // Clear
    users.forEach(u => addUserToVoiceList(u.userId, u.username));
}

function addUserToVoiceList(userId, username) {
    const existing = document.getElementById(`voice-user-${userId}`);
    if (existing) return;

    const div = document.createElement('div');
    div.id = `voice-user-${userId}`;
    div.classList.add('voice-user');
    div.innerHTML = `
        <div class="voice-avatar">${username.charAt(0).toUpperCase()}</div>
        <div class="voice-username">${username}</div>
    `;
    voiceUserList.appendChild(div);
}

function removeUserFromVoiceList(userId) {
    const el = document.getElementById(`voice-user-${userId}`);
    if (el) el.remove();
}

function connectToNewUser(userId, stream) {
    logDebug(`Calling new user: ${userId}`);
    const peer = createPeerConnection(userId);
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    peers[userId] = peer;

    iceCandidateQueue[userId] = [];

    peer.createOffer().then(offer => {
        peer.setLocalDescription(offer);
        socket.emit('offer', { target: userId, caller: myUserId, sdp: offer });
    });
}

function handleOffer(payload) {
    logDebug(`Received offer from: ${payload.caller}`);
    const peer = createPeerConnection(payload.caller);
    peers[payload.caller] = peer;

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
    logDebug(`Received answer from: ${payload.caller}`);
    const peer = peers[payload.caller];
    if (peer) {
        peer.setRemoteDescription(payload.sdp).then(() => {
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
        logDebug(`Connection state with ${targetUserId}: ${peer.connectionState}`);
    };

    peer.ontrack = event => {
        logDebug(`Received TRACK from: ${targetUserId}`);
        const audio = document.createElement('audio');
        audio.id = targetUserId;
        audio.autoplay = true;
        audio.playsInline = true;
        addVideoStream(audio, event.streams[0]);

        // Start VAD for Remote User
        setupVoiceActivityDetection(event.streams[0], targetUserId);
    };

    return peer;
}

function addVideoStream(element, stream) {
    element.srcObject = stream;
    element.addEventListener('loadedmetadata', () => {
        element.play().catch(e => {
            console.error("Auto-play prevented. Please interact with document.", e);
        });
    });

    // Explicit play attempt for good measure
    setTimeout(() => {
        element.play().catch(e => console.error("Retry play failed", e));
    }, 1000);

    videoGrid.append(element);
}

// Voice Activity Detection (VAD)
function setupVoiceActivityDetection(stream, userId) {
    if (!globalAudioContext) {
        logDebug("Warning: AudioContext not initialized.");
        return;
    }

    try {
        const source = globalAudioContext.createMediaStreamSource(stream);
        const analyser = globalAudioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const checkSpeaking = () => {
            const userEl = document.getElementById(`voice-user-${userId}`);
            if (!userEl) return;

            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;

            const avatar = userEl.querySelector('.voice-avatar');
            if (average > 10) {
                avatar.classList.add('speaking');
            } else {
                avatar.classList.remove('speaking');
            }
        };

        const intervalId = setInterval(checkSpeaking, 100);
        vadIntervals.push(intervalId);
    } catch (e) {
        console.error("VAD Setup Error:", e);
    }
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

// --- Settings Logic ---

settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    enumerateDevices();
    if (myStream) setupMicVisualizer(myStream);
});

closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

async function enumerateDevices() {
    micSelect.innerHTML = '';
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices.forEach(device => {
        if (device.kind === 'audioinput') {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Microphone ${micSelect.length + 1}`;
            micSelect.appendChild(option);
        }
    });
}

micSelect.addEventListener('change', () => {
    if (isConnected) {
        const deviceId = micSelect.value;
        navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } }).then(stream => {
            const audioTrack = stream.getAudioTracks()[0];
            if (myStream) {
                const oldTrack = myStream.getAudioTracks()[0];
                oldTrack.stop();
                myStream.removeTrack(oldTrack);
                myStream.addTrack(audioTrack);

                Object.values(peers).forEach(peer => {
                    const sender = peer.getSenders().find(s => s.track.kind === 'audio');
                    if (sender) sender.replaceTrack(audioTrack);
                });

                setupMicVisualizer(myStream);
            }
        });
    }
});

function setupMicVisualizer(stream) {
    if (!stream) return;
    if (!globalAudioContext) globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Note: Creating multiple sources from same stream in same context is fine.
    const source = globalAudioContext.createMediaStreamSource(stream);
    const analyser = globalAudioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (settingsModal.classList.contains('hidden')) return;
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const width = (average / 255) * 100 * 2;

        micBar.style.width = Math.min(width, 100) + '%';
    }
    draw();
}
