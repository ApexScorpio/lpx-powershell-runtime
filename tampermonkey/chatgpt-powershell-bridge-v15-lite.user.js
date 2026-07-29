// ==UserScript==
// @name         ChatGPT PowerShell Bridge — v15 Lite Multi-Conversation
// @namespace    apexscorpio.local
// @version      2026.07.29.15.0.3
// @description  Executa anexos PowerShell através da bridge local, publica o resultado no GitHub e envia apenas o URL para o ChatGPT.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      127.0.0.1
// @connect      chatgpt.com
// @connect      chat.openai.com
// @connect      raw.githubusercontent.com
// @connect      oaiusercontent.com
// @connect      files.oaiusercontent.com
// @connect      *
// @downloadURL  https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js
// @updateURL    https://raw.githubusercontent.com/ApexScorpio/lpx-powershell-runtime/main/tampermonkey/chatgpt-powershell-bridge-v15-lite.user.js
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '15.0.3';
    const BRIDGE_URL = 'http://127.0.0.1:17351';
    const TOKEN_KEY = 'lpxPsb15:token';
    const CLAIMS_KEY = 'lpxPsb15:claims';
    const HANDLED_PREFIX = 'lpxPsb15:handled:';
    const TAB_ID_KEY = 'lpxPsb15:tabId';
    const ENABLED_KEY = 'lpxPsb15:enabled';
    const BOUND_CONVERSATION_KEY = 'lpxPsb15:conversation';
    const CLAIM_TTL_MS = 30 * 60 * 1000;
    const POLL_MS = 750;
    const SETTLE_MS = 900;
    const PUBLISH_WAIT_MS = 90 * 1000;

    let candidateAssistant = null;
    let settleTimer = 0;
    let activeJobId = '';
    let activeManifest = null;
    let observer = null;
    let observerRoot = null;
    let lastStatus = 'A iniciar…';

    function randomId() {
        return globalThis.crypto?.randomUUID?.()
            || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function tabId() {
        let value = sessionStorage.getItem(TAB_ID_KEY);

        if (!value) {
            value = `tab-${randomId()}`;
            sessionStorage.setItem(TAB_ID_KEY, value);
        }

        return value;
    }

    const TAB_ID = tabId();

    function conversationId() {
        const path = location.pathname.replace(/\/+$/, '') || '/';
        const direct = path.match(/(?:^|\/)c\/([A-Za-z0-9-]+)/);

        if (direct) {
            return `c:${direct[1]}`;
        }

        const project = path.match(/(?:^|\/)g\/([^/]+)(?:\/c\/([^/]+))?/);

        if (project) {
            return project[2]
                ? `g:${project[1]}:c:${project[2]}`
                : `g:${project[1]}:${path}`;
        }

        return `path:${path}`;
    }

    function simpleHash(text) {
        let hash = 2166136261;

        for (let index = 0; index < text.length; index++) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function handledKey() {
        return `${HANDLED_PREFIX}${simpleHash(conversationId())}`;
    }

    function handledSet() {
        const value = GM_getValue(handledKey(), []);
        return new Set(Array.isArray(value) ? value : []);
    }

    function markHandled(id) {
        const set = handledSet();
        set.add(id);
        GM_setValue(handledKey(), [...set].slice(-200));
    }

    function isHandled(id) {
        return handledSet().has(id);
    }

    function cleanClaims() {
        const now = Date.now();
        const current = GM_getValue(CLAIMS_KEY, {});
        const clean = {};

        if (current && typeof current === 'object') {
            for (const [key, value] of Object.entries(current)) {
                if (value && Number(value.expiresAt) > now) {
                    clean[key] = value;
                }
            }
        }

        GM_setValue(CLAIMS_KEY, clean);
        return clean;
    }

    function claim(id) {
        const claims = cleanClaims();
        const existing = claims[id];

        if (existing && existing.tabId !== TAB_ID) {
            return false;
        }

        claims[id] = {
            tabId: TAB_ID,
            conversation: conversationId(),
            expiresAt: Date.now() + CLAIM_TTL_MS
        };

        GM_setValue(CLAIMS_KEY, claims);
        return true;
    }

    function releaseClaim(id) {
        const claims = cleanClaims();

        if (claims[id]?.tabId === TAB_ID) {
            delete claims[id];
            GM_setValue(CLAIMS_KEY, claims);
        }
    }

    function enabled() {
        return sessionStorage.getItem(ENABLED_KEY) === '1'
            && sessionStorage.getItem(BOUND_CONVERSATION_KEY) === conversationId();
    }

    function setEnabled(value) {
        sessionStorage.setItem(ENABLED_KEY, value ? '1' : '0');

        if (value) {
            sessionStorage.setItem(BOUND_CONVERSATION_KEY, conversationId());
        } else {
            sessionStorage.removeItem(BOUND_CONVERSATION_KEY);
        }

        render();
    }

    function token() {
        return String(GM_getValue(TOKEN_KEY, '')).trim();
    }

    function authHeaders() {
        return {
            'X-Bridge-Token': token(),
            'Content-Type': 'application/json; charset=UTF-8',
            'Cache-Control': 'no-cache'
        };
    }

    function request(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                ...options,
                onload: resolve,
                onerror: () => reject(new Error('Não foi possível contactar o endereço pedido.')),
                ontimeout: () => reject(new Error('O pedido expirou.'))
            });
        });
    }

    function parseJson(response) {
        try {
            return JSON.parse(response.responseText || '{}');
        } catch {
            return {
                ok: false,
                error: response.responseText || `HTTP ${response.status}`
            };
        }
    }

    function setStatus(text) {
        lastStatus = String(text);
        const node = document.querySelector('#lpx-psb15-status');

        if (node) {
            node.textContent = lastStatus;
        }
    }

    const style = document.createElement('style');
    style.textContent = `
        #lpx-psb15 {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483647;
            width: 330px;
            padding: 10px;
            border: 1px solid #46505c;
            border-radius: 10px;
            background: #11151a;
            color: #f1f5f9;
            box-shadow: 0 12px 36px rgba(0,0,0,.5);
            font: 12px/1.35 Arial, sans-serif;
        }

        #lpx-psb15-title {
            font-weight: 700;
            margin-bottom: 6px;
        }

        #lpx-psb15-status {
            min-height: 34px;
            color: #b9d8f5;
            overflow-wrap: anywhere;
        }

        #lpx-psb15-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 8px;
        }

        #lpx-psb15 button {
            padding: 6px 8px;
            border: 0;
            border-radius: 6px;
            cursor: pointer;
            background: #dbe5ef;
            color: #111;
            font-size: 11px;
            font-weight: 700;
        }

        #lpx-psb15 button.primary { background: #8ee59f; }
        #lpx-psb15 button.danger { background: #ff9696; }
        #lpx-psb15 button.warning { background: #ffd166; }
        #lpx-psb15 button.admin { background: #d3a7ff; }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'lpx-psb15';
    document.documentElement.appendChild(panel);

    function button(label, handler, className = '') {
        const node = document.createElement('button');
        node.type = 'button';
        node.textContent = label;
        node.className = className;
        node.addEventListener('click', handler);
        return node;
    }

    function render() {
        panel.replaceChildren();

        const title = document.createElement('div');
        title.id = 'lpx-psb15-title';
        title.textContent = `PowerShell Bridge v${VERSION} · ${enabled() ? 'ATIVA' : 'PARADA'}`;

        const status = document.createElement('div');
        status.id = 'lpx-psb15-status';
        status.textContent = lastStatus;

        const actions = document.createElement('div');
        actions.id = 'lpx-psb15-actions';

        actions.append(
            enabled()
                ? button('Parar nesta aba', () => {
                    setEnabled(false);
                    setStatus('Autonomia parada nesta aba.');
                }, 'danger')
                : button('Ativar nesta aba', () => {
                    if (!token()) {
                        configureToken();
                    }

                    if (!token()) {
                        return;
                    }

                    baselineCurrentAssistant();
                    setEnabled(true);
                    setStatus('Ativa. À espera de um novo PSB_JOB_V2 nesta conversa.');
                }, 'primary'),

            button('Executar último', () => {
                void inspectCandidate(true);
            }, 'warning'),

            button('Token', configureToken),

            button('Testar', () => {
                void healthCheck(false);
            }),

            button('Cancelar', () => {
                void cancelActive();
            }, 'danger'),

            button('ADMIN', () => {
                void setAdmin();
            }, 'admin')
        );

        panel.append(title, status, actions);
    }

    function configureToken() {
        const value = window.prompt('Cola o token da PowerShell Bridge:', token());

        if (value === null) {
            return;
        }

        const clean = value.trim();

        if (!/^[A-Fa-f0-9]{64}$/.test(clean)) {
            window.alert('O token deve ter 64 caracteres hexadecimais.');
            return;
        }

        GM_setValue(TOKEN_KEY, clean);
        setStatus('Token guardado.');
        void healthCheck(false);
    }

    async function healthCheck(quiet = true) {
        try {
            const response = await request({
                method: 'GET',
                url: `${BRIDGE_URL}/health?_=${Date.now()}`,
                timeout: 5000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            if (!quiet) {
                setStatus(
                    `Bridge pronta · protocolo ${data.protocol} · modo ${String(data.mode || '').toUpperCase()} · ` +
                    `${data.runningJobs || 0}/${data.maxConcurrentJobs || 1} jobs · GitHub ${data.githubConfigured ? 'OK' : 'não configurado'}.`
                );
            }

            return data;
        } catch (error) {
            if (!quiet) {
                setStatus(`Bridge indisponível: ${error.message}`);
            }

            throw error;
        }
    }

    function assistantWriting() {
        return Boolean(
            document.querySelector(
                '[data-testid="stop-button"], ' +
                'button[aria-label*="Stop generating"], ' +
                'button[aria-label*="Parar de gerar"], ' +
                'button[aria-label*="Parar resposta"]'
            )
        );
    }

    function closestAssistant(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node
            : node?.parentElement;

        return element?.closest?.('[data-message-author-role="assistant"]') || null;
    }

    function latestAssistantFallback() {
        const nodes = document.querySelectorAll('[data-message-author-role="assistant"]');
        return nodes.length ? nodes[nodes.length - 1] : null;
    }

    function baselineCurrentAssistant() {
        const latest = latestAssistantFallback();

        if (!latest) {
            return;
        }

        for (const manifest of manifestsIn(latest)) {
            if (manifest.protocol === 'PSB_JOB_V2' && manifest.jobId) {
                markHandled(String(manifest.jobId));
            }

            if (manifest.protocol === 'PSB_LEARN_V1' && manifest.id) {
                markHandled(`learn:${manifest.id}`);
            }
        }
    }

    function scheduleCandidate(node) {
        const assistant = closestAssistant(node);

        if (assistant) {
            candidateAssistant = assistant;
        }

        clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
            void inspectCandidate(false);
        }, SETTLE_MS);
    }

    function installObserver() {
        const root = document.querySelector('main') || document.body;

        if (observerRoot === root) {
            return;
        }

        observer?.disconnect();
        observerRoot = root;

        observer = new MutationObserver(records => {
            for (const record of records) {
                scheduleCandidate(record.target);

                for (const added of record.addedNodes) {
                    scheduleCandidate(added);
                }
            }
        });

        observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function manifestsIn(assistant) {
        const manifests = [];

        for (const pre of assistant.querySelectorAll('pre')) {
            const text = String(pre.innerText || pre.textContent || '').trim();

            if (!text || (!text.includes('PSB_JOB_V2') && !text.includes('PSB_LEARN_V1'))) {
                continue;
            }

            try {
                const value = JSON.parse(text);

                if (value && typeof value === 'object' && value.protocol) {
                    manifests.push(value);
                }
            } catch {
                // Apenas JSON válido é aceite.
            }
        }

        return manifests;
    }

    async function inspectCandidate(forced) {
        if (!enabled() && !forced) {
            return;
        }

        if (activeJobId) {
            return;
        }

        if (assistantWriting()) {
            scheduleCandidate(candidateAssistant || document.body);
            return;
        }

        const assistant = candidateAssistant || latestAssistantFallback();

        if (!assistant) {
            setStatus('Não foi encontrada uma resposta do assistente.');
            return;
        }

        const manifests = manifestsIn(assistant);

        if (!manifests.length) {
            if (forced) {
                setStatus('O último turno não contém PSB_JOB_V2 nem PSB_LEARN_V1.');
            }
            return;
        }

        for (const manifest of manifests) {
            if (manifest.protocol === 'PSB_JOB_V2') {
                await processJobManifest(assistant, manifest, forced);
            } else if (manifest.protocol === 'PSB_LEARN_V1') {
                await processKnowledgeManifest(manifest, forced);
            }
        }
    }

    function turnContainer(assistant) {
        return assistant.closest(
            '[data-testid^="conversation-turn-"], article, [data-message-id]'
        ) || assistant;
    }

    function findAttachmentLink(assistant, fileName) {
        const wanted = String(fileName || '').trim().toLowerCase();

        function labelFor(anchor) {
            let href = '';

            try {
                href = decodeURIComponent(
                    anchor.getAttribute('href') || anchor.href || ''
                );
            } catch {
                href = anchor.getAttribute('href') || anchor.href || '';
            }

            return [
                anchor.textContent || '',
                anchor.getAttribute('download') || '',
                anchor.getAttribute('aria-label') || '',
                anchor.getAttribute('title') || '',
                href
            ].join(' ').toLowerCase();
        }

        const roots = [
            turnContainer(assistant),
            assistant,
            document
        ].filter(Boolean);

        for (const root of roots) {
            const anchors = [...root.querySelectorAll('a[href]')];

            const exact = anchors.find(anchor => {
                return wanted && labelFor(anchor).includes(wanted);
            });

            if (exact) {
                return exact;
            }
        }

        const globalAnchors = [...document.querySelectorAll('a[href]')];

        const attachmentAnchors = globalAnchors.filter(anchor => {
            const label = labelFor(anchor);

            return (
                label.includes('sandbox:/mnt/data/') ||
                label.includes('files.oaiusercontent.com') ||
                label.includes('oaiusercontent.com') ||
                label.includes('/backend-api/files/') ||
                label.includes('/files/')
            );
        });

        if (attachmentAnchors.length) {
            return attachmentAnchors[attachmentAnchors.length - 1];
        }

        return null;
    }

    async function downloadAttachment(anchor) {
        const href = anchor?.href || anchor?.getAttribute('href');

        if (!href) {
            throw new Error('O anexo não tem um URL utilizável.');
        }

        try {
            const response = await fetch(href, {
                credentials: 'include',
                cache: 'no-store'
            });

            if (response.ok) {
                return await response.text();
            }
        } catch {
            // Tenta GM_xmlhttpRequest a seguir.
        }

        const response = await request({
            method: 'GET',
            url: href,
            responseType: 'arraybuffer',
            timeout: 30000
        });

        if (response.status >= 400) {
            throw new Error(`Falha ao descarregar o anexo: HTTP ${response.status}.`);
        }

        const bytes = response.response instanceof ArrayBuffer
            ? new Uint8Array(response.response)
            : new TextEncoder().encode(String(response.responseText || ''));

        return new TextDecoder('utf-8').decode(bytes);
    }

    async function sha256(text) {
        const bytes = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest('SHA-256', bytes);

        return [...new Uint8Array(digest)]
            .map(value => value.toString(16).padStart(2, '0'))
            .join('');
    }

    function decodeBase64Utf8(value) {
        const clean = String(value || '').replace(/\s+/g, '');
        const binary = atob(clean);
        const bytes = Uint8Array.from(
            binary,
            character => character.charCodeAt(0)
        );

        return new TextDecoder('utf-8').decode(bytes);
    }

    async function processJobManifest(assistant, manifest, forced) {
        const jobId = String(manifest.jobId || '').trim();
        const fileName = String(manifest.file || '').trim();
        const commandBase64 = String(manifest.commandBase64 || '').trim();
        const inlineCommand = typeof manifest.command === 'string'
            ? manifest.command
            : '';

        if (
            !jobId ||
            (!fileName && !commandBase64 && !inlineCommand)
        ) {
            setStatus(
                'Manifesto PSB_JOB_V2 incompleto: falta jobId e uma fonte de comando.'
            );
            return;
        }

        if (isHandled(jobId) && !forced) {
            return;
        }

        if (!claim(jobId)) {
            setStatus(`O job ${jobId} já está a ser tratado noutra aba.`);
            return;
        }

        try {
            let command = '';

            if (commandBase64) {
                setStatus('A descodificar o comando incorporado no manifesto…');
                command = decodeBase64Utf8(commandBase64);
            }
            else if (inlineCommand) {
                setStatus('A preparar o comando incorporado no manifesto…');
                command = inlineCommand;
            }
            else {
                setStatus(`A obter o anexo ${fileName}…`);

                const anchor = findAttachmentLink(
                    assistant,
                    fileName
                );

                if (!anchor) {
                    throw new Error(
                        `Não foi encontrado o link do anexo ${fileName}.`
                    );
                }

                command = await downloadAttachment(anchor);
            }

            if (!command.trim()) {
                throw new Error('O anexo PowerShell está vazio.');
            }

            if (manifest.sha256) {
                const actualHash = await sha256(command);

                if (actualHash.toLowerCase() !== String(manifest.sha256).toLowerCase()) {
                    throw new Error('O SHA-256 do anexo não coincide com o manifesto.');
                }
            }

            const response = await request({
                method: 'POST',
                url: `${BRIDGE_URL}/run`,
                headers: authHeaders(),
                data: JSON.stringify({
                    command,
                    jobId,
                    commandKey: jobId,
                    signature: jobId,
                    purpose: String(manifest.purpose || ''),
                    clientId: TAB_ID,
                    tabId: TAB_ID,
                    conversationId: conversationId(),
                    clientVersion: VERSION
                }),
                timeout: 15000
            });

            const data = parseJson(response);

            if (![200, 202].includes(Number(response.status)) || !data.jobId) {
                throw new Error(data.error || `A bridge rejeitou o job: HTTP ${response.status}.`);
            }

            activeJobId = String(data.jobId);
            activeManifest = manifest;
            setStatus(`Job ${activeJobId} em execução. Esta aba continua leve; só existe polling enquanto o job está ativo.`);

            await monitorActiveJob();
        } catch (error) {
            releaseClaim(jobId);
            activeJobId = '';
            activeManifest = null;
            setStatus(`Falha no job ${jobId}: ${error.message}`);
        }
    }

    async function monitorActiveJob() {
        const started = Date.now();
        let finishedAt = 0;

        while (activeJobId) {
            const response = await request({
                method: 'GET',
                url: `${BRIDGE_URL}/job/${encodeURIComponent(activeJobId)}?metadata=1&_=${Date.now()}`,
                headers: {
                    'X-Bridge-Token': token(),
                    'Cache-Control': 'no-cache'
                },
                timeout: 8000
            });

            const data = parseJson(response);

            if (response.status >= 400) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            if (data.running) {
                setStatus(`Job ${activeJobId} em execução · ${Math.floor((Date.now() - started) / 1000)} s.`);
                await wait(POLL_MS);
                continue;
            }

            if (!finishedAt) {
                finishedAt = Date.now();
            }

            if (data.publishStatus === 'published' && data.resultJsonUrl) {
                const manifest = activeManifest;
                const completedJobId = activeJobId;

                markHandled(completedJobId);
                releaseClaim(completedJobId);
                activeJobId = '';
                activeManifest = null;

                const message = [
                    'PSBRIDGE_RESULT_V2',
                    `job: ${completedJobId}`,
                    `status: ${String(data.status || '').toUpperCase()}`,
                    `exitCode: ${data.exitCode ?? 'desconhecido'}`,
                    `result: ${data.resultJsonUrl}`,
                    `log: ${data.resultUrl || ''}`,
                    'instruction: lê apenas este resultado público, considera o que já foi tentado e continua o diagnóstico. Não reproduzas o log completo na conversa.'
                ].join('\n');

                setStatus(`Resultado publicado. A enviar apenas o URL para esta conversa…`);
                await sendMessage(message, manifest);
                setStatus(`Job ${completedJobId} concluído e enviado por URL.`);
                return;
            }

            if (data.publishStatus === 'failed' || data.publishStatus === 'disabled') {
                throw new Error(data.publishError || 'A publicação no GitHub falhou.');
            }

            if (Date.now() - finishedAt > PUBLISH_WAIT_MS) {
                throw new Error('O job terminou, mas a publicação no GitHub ultrapassou o tempo limite.');
            }

            setStatus(`Job terminado. A publicar o resultado no GitHub…`);
            await wait(POLL_MS);
        }
    }

    async function processKnowledgeManifest(manifest, forced) {
        const id = String(manifest.id || '').trim();
        const handledId = `learn:${id}`;

        if (!id) {
            return;
        }

        if (isHandled(handledId) && !forced) {
            return;
        }

        try {
            setStatus(`A guardar a lição ${id} no GitHub…`);

            const response = await request({
                method: 'POST',
                url: `${BRIDGE_URL}/knowledge`,
                headers: authHeaders(),
                data: JSON.stringify({ entry: manifest }),
                timeout: 30000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            markHandled(handledId);
            setStatus(`Lição ${id} guardada: ${data.url}`);
        } catch (error) {
            setStatus(`Falha ao guardar a lição ${id}: ${error.message}`);
        }
    }

    function composer() {
        return document.querySelector('#prompt-textarea')
            || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
            || document.querySelector('textarea[placeholder]');
    }

    function setComposerText(editor, text) {
        editor.focus();

        if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')?.set;

            if (setter) {
                setter.call(editor, text);
            } else {
                editor.value = text;
            }

            editor.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        editor.replaceChildren();

        for (const line of text.split('\n')) {
            const paragraph = document.createElement('p');

            if (line) {
                paragraph.textContent = line;
            } else {
                paragraph.appendChild(document.createElement('br'));
            }

            editor.appendChild(paragraph);
        }

        editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text
        }));
    }

    function findSendButton() {
        return document.querySelector('[data-testid="send-button"]')
            || [...document.querySelectorAll('button')].find(node => /enviar|send/i.test(node.getAttribute('aria-label') || ''))
            || null;
    }

    async function sendMessage(text) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const editor = composer();

            if (!editor) {
                await wait(250);
                continue;
            }

            setComposerText(editor, text);
            await wait(250);

            const send = findSendButton();

            if (send && !send.disabled) {
                send.click();
                return;
            }

            await wait(250);
        }

        throw new Error('Não foi possível enviar automaticamente o URL do resultado.');
    }

    async function cancelActive() {
        if (!activeJobId) {
            setStatus('Não existe nenhum job ativo nesta aba.');
            return;
        }

        try {
            await request({
                method: 'POST',
                url: `${BRIDGE_URL}/cancel`,
                headers: authHeaders(),
                data: JSON.stringify({ jobId: activeJobId }),
                timeout: 8000
            });

            setStatus(`Cancelamento pedido para ${activeJobId}.`);
        } catch (error) {
            setStatus(`Falha ao cancelar: ${error.message}`);
        }
    }

    async function setAdmin() {
        try {
            const response = await request({
                method: 'POST',
                url: `${BRIDGE_URL}/set-admin`,
                headers: authHeaders(),
                data: JSON.stringify({ enabled: true }),
                timeout: 8000
            });

            const data = parseJson(response);

            if (!data.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            setStatus(data.restarting
                ? 'Elevação pedida. Confirma a janela UAC.'
                : 'A bridge já está em modo ADMIN.');
        } catch (error) {
            setStatus(`Falha no modo ADMIN: ${error.message}`);
        }
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    window.addEventListener('focus', () => {
        installObserver();
        scheduleCandidate(candidateAssistant || document.body);
    }, true);

    window.addEventListener('popstate', () => {
        candidateAssistant = null;
        installObserver();
        render();
    }, true);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            installObserver();
            scheduleCandidate(candidateAssistant || document.body);
        }
    });

    render();
    installObserver();

    void healthCheck(true)
        .then(data => {
            setStatus(
                `Bridge protocolo ${data.protocol} · ${String(data.mode || '').toUpperCase()} · ` +
                `GitHub ${data.githubConfigured ? 'OK' : 'não configurado'} · ` +
                `${enabled() ? 'autonomia ativa nesta aba' : 'autonomia parada'}.`
            );
        })
        .catch(() => {
            setStatus('Bridge indisponível. Liga-a pelo atalho do Ambiente de Trabalho.');
        });
})();
