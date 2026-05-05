import 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js';
import './style.css';

scr = (
    <body>
        <div class="login-screen">
            <h2 style="margin-bottom: 30px;">NekoFaDy</h2>
            <input type="text" id="db_ip" placeholder="Chat HTTP-URL: "></input>
            <input type="text" id="userName" placeholder="Username: "></input>
            <input type="password" id="seedPhrase" placeholder="Chat key: "></input>
            <button onclick="enterChat()">Enter the chat </button>
        </div>
        <div id="chat-screen">
            <div class="header">
                <div class="user-info">
                    <span>👤</span>
                    <span id="display-name"></span>
                </div>
                <div class="action-buttons">
                    <button class="icon-btn" onclick="loadMessages()" title="Update">🔄</button>
                    <button class="icon-btn" onclick="exportChat()" title="Export chat">⬇️</button>
                    <button class="icon-btn" onclick="resetChat()" title="Clear chat">🗑️</button>
                </div>
            </div>
            
            <div id="messages"></div>

            <div class="input-area">
                <input type="file" id="fileInput" style="display:none;" accept="image/*,video/*,audio/*"></input>
                <button class="attach-btn" onclick="document.getElementById('fileInput').click()" title="Add file (max 10 Mb)">📎</button>
                <button class="voice-btn" id="voiceBtn" onclick="toggleRecording()" title="Voice message">🎤</button>
                <input type="text" id="msgInput" placeholder="Message..." autocomplete="off"></input>
                <button class="send-btn" onclick="sendMessage()" title="Send">➤</button>
            </div>
            <div id="compressStatus" style="display:none; background: #2b3138; color:#ffaa00; padding:4px 10px; font-size:12px; text-align:center;">⏳ Processing media...</div>
        </div>
    </body>
)


ReactDOM.render(
    scr,
    document.getElementsById("root")
);


// ================== НАСТРОЙКИ ==================
var DB_IP = '';
const MAX_FILE_SIZE = 16 * 1024 * 1024 * 1024;

let set = false;

let currentUser = '';
let currentSeed = '';
let refreshInterval = null;

// ================== ЗАПИСЬ ГОЛОСА ==================
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// Настройки
function set_db_ip(token, gist) {
    if (set == false) {
        GITHUB_TOKEN = token
        GIST_ID = gist
    }
}

function debug() {
    console.log(GITHUB_TOKEN)
    console.log(GIST_ID)
    console.log(set)
}

async function toggleRecording() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            audioChunks = [];

            mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                // Сжимаем, если нужно (здесь можно применить дополнительные аудио-преобразования)
                await sendVoiceMessage(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            isRecording = true;
            voiceBtn.classList.add('recording');
            voiceBtn.title = 'Stop recording';
        } catch (err) {
            alert('Microphone access denied or not supported');
            console.error(err);
        }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        voiceBtn.classList.remove('recording');
        voiceBtn.title = 'Voice message';
    }
}

async function sendVoiceMessage(blob) {
    const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
    await processAndSendFile(file);
}

// ================== ОТПРАВКА ТЕКСТА ==================
async function sendMessage() {
    const input = document.getElementById('msgInput');
    const text = input.value.trim();
    if (!text) return;

    const messageObj = {
        type: 'text',
        user: currentUser,
        text: text,
        time: Date.now()
    };
    const jsonStr = JSON.stringify(messageObj);
    const encrypted = CryptoJS.AES.encrypt(jsonStr, currentSeed).toString();

    input.value = '';
    await postEncryptedMessage(encrypted);
}

// ================== ОБРАБОТКА ФАЙЛОВ ==================
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await processAndSendFile(file);
    e.target.value = '';
});

async function processAndSendFile(file) {
    if (file.size > 10 * 1024 * 1024) { // 10 МБ лимит до сжатия
        alert('File is too big (max 10 MB)');
        return;
    }

    const statusDiv = document.getElementById('compressStatus');
    statusDiv.style.display = 'block';

    try {
        let processedFile = file;

        // Сжатие изображений в WebP
        if (file.type.startsWith('image/')) {
            processedFile = await compressImageToWebP(file);
        }
        // Сжатие видео
        else if (file.type.startsWith('video/')) {
            processedFile = await compressVideo(file);
        }

        // Читаем файл в base64
        const base64Data = await readFileAsBase64(processedFile);

        const fileObject = {
            type: 'file',
            user: currentUser,
            name: processedFile.name,
            mime: processedFile.type || 'application/octet-stream',
            size: processedFile.size,
            data: base64Data,
            time: Date.now()
        };

        const jsonStr = JSON.stringify(fileObject);
        const encrypted = CryptoJS.AES.encrypt(jsonStr, currentSeed).toString();

        if (encrypted.length > MAX_FILE_SIZE) {
            throw new Error('Encrypted file exceeds 5 MB limit');
        }

        await postEncryptedMessage(encrypted);
    } catch (err) {
        console.error('File processing error:', err);
        alert('Error: ' + err.message);
    } finally {
        statusDiv.style.display = 'none';
    }
}

// Чтение файла как base64
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Сжатие изображения в WebP
function compressImageToWebP(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                const maxDim = 1280;
                if (width > height && width > maxDim) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else if (height > maxDim) {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('WebP compression failed'));
                        return;
                    }
                    const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.webp'), { type: 'image/webp' });
                    resolve(newFile);
                }, 'image/webp', 0.85);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Сжатие видео
async function compressVideo(file) {
    // Простой вариант: используем MediaRecorder для перекодировки
    // Для сложных случаев можно использовать WebAssembly-кодек, но здесь ограничимся базовым
    return new Promise(async (resolve, reject) => {
        try {
            // Создаём элемент video для получения метаданных
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.src = URL.createObjectURL(file);
            await new Promise((r) => { video.onloadedmetadata = r; });

            // Определяем, есть ли аудиодорожка
            const hasAudio = video.mozHasAudio || video.webkitAudioContext || (video.audioTracks && video.audioTracks.length > 0);
            
            // Если видео без звука – конвертируем в анимированный WebP (гифку)
            if (!hasAudio) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const width = Math.min(video.videoWidth, 480);
                const height = Math.min(video.videoHeight, 360);
                canvas.width = width;
                canvas.height = height;

                // Захватываем несколько кадров (упрощённо – первый кадр)
                // Для реальной GIF нужна библиотека, здесь просто отдаём первый кадр как изображение
                video.currentTime = Math.min(1, video.duration / 2);
                await new Promise((r) => { video.onseeked = r; });
                ctx.drawImage(video, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.webp'), { type: 'image/webp' });
                    resolve(newFile);
                }, 'image/webp', 0.8);
            } else {
                // Видео со звуком – используем MediaRecorder для сжатия
                const stream = canvas.captureStream(30);
                // Добавляем аудиодорожку, если есть
                // Это сложно, поэтому пока пропускаем – используе'type':'ACChat'м оригинал с понижением качества
                // В реальности нужно использовать WebCodecs, но для простоты вернём файл как есть
                // с предупреждением
                console.warn('Video with audio – using original (no compression)');
                resolve(file);
            }
            URL.revokeObjectURL(video.src);
        } catch (e) {
            reject(e);
        }
    });
}

// ================== ОТПРАВКА В GIST ==================
async function postEncryptedMessage(encryptedText) {
    try {
        const getResp = await fetch(`${DB_IP}`, {
            headers: {}
        });
        if (!getResp.ok) throw new Error(`GET ${getResp.status}: ${await getResp.text()}`);
        const getData = await getResp.json();

        const oldContent = getData.files[FILE_NAME]?.content || '';
        const separator = oldContent && !oldContent.endsWith('\n') ? '\n' : '';
        const newContent = oldContent + separator + encryptedText;

        const patchResp = await fetch(`${DB_IP}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: { [FILE_NAME]: { content: newContent } }
            })
        });
        if (!patchResp.ok) throw new Error(`PATCH ${patchResp.status}: ${await patchResp.text()}`);

        loadMessages();
    } catch (err) {
        console.error('Sending error:', err);
        alert('Sending error: ' + err.message);
    }
}

// ================== ЗАГРУЗКА СООБЩЕНИЙ ==================
async function loadMessages() {
    const msgDiv = document.getElementById('messages');
    try {
        const response = await fetch(`${DB_IP}?t=${Date.now()}`, {
            headers: {}
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        const content = data.files[FILE_NAME]?.content || '';
        const lines = content.split('\n').filter(line => line.trim() !== '');
        
        const messages = [];
        for (let line of lines) {
            try {
                const bytes = CryptoJS.AES.decrypt(line, currentSeed);
                const decrypted = bytes.toString(CryptoJS.enc.Utf8);
                if (decrypted) {
                    const msg = JSON.parse(decrypted);
                    messages.push(msg);
                }
            } catch (e) {}
        }

        messages.sort((a, b) => (a.time || 0) - (b.time || 0));

        msgDiv.innerHTML = '';
        let lastDate = null;

        for (let msg of messages) {
            const msgDate = msg.time ? new Date(msg.time).toLocaleDateString() : null;
            if (msgDate && msgDate !== lastDate) {
                lastDate = msgDate;
                const divider = document.createElement('div');
                divider.className = 'date-divider';
                divider.innerHTML = `<span>${msgDate}</span>`;
                msgDiv.appendChild(divider);
            }
            displayMessage(msg, msgDiv);
        }

        msgDiv.scrollTop = msgDiv.scrollHeight;
    } catch (err) {
        console.error('Download error:', err);
        msgDiv.innerHTML = '<center>Download error</center>';
    }
}

// ================== ОТРИСОВКА СООБЩЕНИЯ ==================
function displayMessage(msg, container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';
    if (msg.user === currentUser) {
        wrapper.style.alignSelf = 'flex-end';
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg-item';
    if (msg.user === currentUser) {
        msgDiv.classList.add('my-message');
    }

    if (msg.user && msg.user !== currentUser) {
        const authorDiv = document.createElement('div');
        authorDiv.className = 'msg-author';
        authorDiv.textContent = msg.user;
        msgDiv.appendChild(authorDiv);
    }

    if (msg.type === 'file') {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file-message';

        const binary = atob(msg.data);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
        const blob = new Blob([array], { type: msg.mime });
        const url = URL.createObjectURL(blob);

        // Предпросмотр для изображений, видео и аудио
        if (msg.mime.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = url;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '200px';
            img.style.borderRadius = '8px';
            img.style.cursor = 'pointer';
            img.onclick = () => window.open(url, '_blank');
            fileDiv.appendChild(img);
        } else if (msg.mime.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            video.style.maxWidth = '100%';
            video.style.maxHeight = '200px';
            fileDiv.appendChild(video);
        } else if (msg.mime.startsWith('audio/')) {
            const audio = document.createElement('audio');
            audio.src = url;
            audio.controls = true;
            audio.style.width = '100%';
            fileDiv.appendChild(audio);
        }

        const infoDiv = document.createElement('div');
        infoDiv.className = 'file-info';
        infoDiv.innerHTML = `
            <span>📎 ${msg.name} (${formatSize(msg.size)})</span>
            <a href="${url}" download="${msg.name.replace(/["']/g, '_')}" class="file-link">Download</a>
        `;
        fileDiv.appendChild(infoDiv);
        msgDiv.appendChild(fileDiv);
    } else {
        msgDiv.appendChild(document.createTextNode(msg.text || msg));
    }

    if (msg.time) {
        const timeSpan = document.createElement('div');
        timeSpan.className = 'timestamp';
        timeSpan.textContent = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        msgDiv.appendChild(timeSpan);
    }

    wrapper.appendChild(msgDiv);
    container.appendChild(wrapper);
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ================== СБРОС ЧАТА ==================
async function resetChat() {
    if (!confirm('Do you want to clear the chat? It is irreversible.')) {
        return;
    }
    try {
        await fetch(`{DB_IP}`, {
            method: 'PATCH',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                files: { [FILE_NAME]: { content: '' } }
            })
        });
        loadMessages();
    } catch (err) {
        alert('Clearing error');
    }
}

// ================== ЭКСПОРТ ИСТОРИИ ==================
async function exportChat() {
    try {
        const response = await fetch(`{DB_IP}?t=${Date.now()}`, {
            headers: {}
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const content = data.files[FILE_NAME]?.content || '';
        
        const lines = content.split('\n').filter(l => l.trim());
        let decryptedLines = [];

        for (let line of lines) {
            try {
                const bytes = CryptoJS.AES.decrypt(line, currentSeed);
                const decrypted = bytes.toString(CryptoJS.enc.Utf8);
                if (decrypted) {
                    try {
                        const parsed = JSON.parse(decrypted);
                        decryptedLines.push(JSON.stringify(parsed, null, 2));
                    } catch {
                        decryptedLines.push(decrypted);
                    }
                }
            } catch (e) {}
        }

        if (decryptedLines.length === 0) {
            alert('No messages to export.');
            return;
        }

        const blob = new Blob([decryptedLines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chat_export_${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Export error');
    }
}

// ================== ВХОД ==================
function enterChat() {
    currentUser = document.getElementById('userName').value.trim();
    currentSeed = document.getElementById('seedPhrase').value.trim();

    if (!currentUser || !currentSeed) return alert("Enter username and chat key!");

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';
    document.getElementById('display-name').innerText = currentUser;

    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(loadMessages, 10000);
    
    loadMessages();

    set = true;
}

document.getElementById('msgInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendMessage();
});
