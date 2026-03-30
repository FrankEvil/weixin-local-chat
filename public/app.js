const state = {
  config: {
    baseUrl: "",
    cdnBaseUrl: "",
    botType: "3",
    defaultWorkspace: "",
    codexWorkspace: "",
    claudeWorkspace: "",
    openclawMode: "auto",
    openclawWorkspace: "",
    openclawCommand: "",
    openclawDataDir: "",
    openclawContainer: "",
  },
  accounts: [],
  selectedAccountId: "",
  conversations: [],
  selectedPeerId: "",
  messages: [],
  searchQuery: "",
  searchResults: [],
  debugOpen: false,
  debugData: null,
  status: null,
  currentLoginSessionKey: "",
  loginPollTimer: null,
  busy: false,
};

const elements = {
  healthBadge: document.querySelector("#healthBadge"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  cdnBaseUrlInput: document.querySelector("#cdnBaseUrlInput"),
  botTypeInput: document.querySelector("#botTypeInput"),
  defaultWorkspaceInput: document.querySelector("#defaultWorkspaceInput"),
  codexWorkspaceInput: document.querySelector("#codexWorkspaceInput"),
  claudeWorkspaceInput: document.querySelector("#claudeWorkspaceInput"),
  openclawModeInput: document.querySelector("#openclawModeInput"),
  openclawWorkspaceInput: document.querySelector("#openclawWorkspaceInput"),
  openclawCommandInput: document.querySelector("#openclawCommandInput"),
  openclawDataDirInput: document.querySelector("#openclawDataDirInput"),
  openclawContainerInput: document.querySelector("#openclawContainerInput"),
  configForm: document.querySelector("#configForm"),
  loginBtn: document.querySelector("#loginBtn"),
  newPeerInput: document.querySelector("#newPeerInput"),
  openConversationBtn: document.querySelector("#openConversationBtn"),
  accountsList: document.querySelector("#accountsList"),
  refreshConversationsBtn: document.querySelector("#refreshConversationsBtn"),
  conversationsList: document.querySelector("#conversationsList"),
  chatTitle: document.querySelector("#chatTitle"),
  chatMeta: document.querySelector("#chatMeta"),
  searchInput: document.querySelector("#searchInput"),
  searchBtn: document.querySelector("#searchBtn"),
  clearSearchBtn: document.querySelector("#clearSearchBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  debugBtn: document.querySelector("#debugBtn"),
  debugPanel: document.querySelector("#debugPanel"),
  debugContent: document.querySelector("#debugContent"),
  statusBadge: document.querySelector("#statusBadge"),
  statusText: document.querySelector("#statusText"),
  messagesList: document.querySelector("#messagesList"),
  fileInput: document.querySelector("#fileInput"),
  selectedFileName: document.querySelector("#selectedFileName"),
  messageInput: document.querySelector("#messageInput"),
  sendTextBtn: document.querySelector("#sendTextBtn"),
  sendMediaBtn: document.querySelector("#sendMediaBtn"),
  loginDialog: document.querySelector("#loginDialog"),
  closeLoginDialogBtn: document.querySelector("#closeLoginDialogBtn"),
  startLoginFlowBtn: document.querySelector("#startLoginFlowBtn"),
  pollLoginBtn: document.querySelector("#pollLoginBtn"),
  loginStatusText: document.querySelector("#loginStatusText"),
  qrContainer: document.querySelector("#qrContainer"),
  toast: document.querySelector("#toast"),
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(text || response.statusText);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function checkHealth() {
  try {
    const result = await request("/api/health");
    elements.healthBadge.textContent = result.message || "服务可用";
  } catch (error) {
    elements.healthBadge.textContent = "服务异常";
  }
}

function showToast(message, level = "info") {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  elements.toast.style.background = level === "error"
    ? "rgba(179, 65, 43, 0.95)"
    : "rgba(49, 36, 25, 0.95)";
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3600);
}

function isLikelyImageUrl(url) {
  return /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
}

function renderQrContent(qrcode, qrcodeUrl) {
  const qrPayload = qrcodeUrl?.trim() || qrcode?.trim() || "";
  if (qrPayload) {
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrPayload)}`;
    elements.qrContainer.innerHTML = `
      <div class="qr-webview">
        <img src="${qrImageUrl}" alt="登录二维码" />
        <a href="${qrcodeUrl || qrImageUrl}" target="_blank" rel="noreferrer">如果扫码异常，点这里打开微信原始二维码页面</a>
      </div>
    `;
    return;
  }
  if (!qrcodeUrl) {
    elements.qrContainer.textContent = "等待生成二维码";
    return;
  }
  if (isLikelyImageUrl(qrcodeUrl)) {
    elements.qrContainer.innerHTML = `<img src="${qrcodeUrl}" alt="登录二维码" />`;
    return;
  }
  elements.qrContainer.innerHTML = `
    <div class="qr-webview">
      <iframe src="${qrcodeUrl}" title="登录二维码页面" loading="lazy" referrerpolicy="no-referrer"></iframe>
      <a href="${qrcodeUrl}" target="_blank" rel="noreferrer">如果下方没有显示二维码，点这里在新标签打开</a>
    </div>
  `;
}

function setBusy(next) {
  state.busy = next;
  [
    elements.sendTextBtn,
    elements.sendMediaBtn,
    elements.startLoginFlowBtn,
    elements.pollLoginBtn,
    elements.openConversationBtn,
    elements.loginBtn,
  ].forEach((button) => {
    button.disabled = next;
  });
}

function setConfigForm(config) {
  elements.baseUrlInput.value = config.baseUrl || "";
  elements.cdnBaseUrlInput.value = config.cdnBaseUrl || "";
  elements.botTypeInput.value = config.botType || "3";
  elements.defaultWorkspaceInput.value = config.defaultWorkspace || "";
  elements.codexWorkspaceInput.value = config.codexWorkspace || "";
  elements.claudeWorkspaceInput.value = config.claudeWorkspace || "";
  elements.openclawModeInput.value = config.openclawMode || "auto";
  elements.openclawWorkspaceInput.value = config.openclawWorkspace || "";
  elements.openclawCommandInput.value = config.openclawCommand || "";
  elements.openclawDataDirInput.value = config.openclawDataDir || "";
  elements.openclawContainerInput.value = config.openclawContainer || "";
}

function selectedAccount() {
  return state.accounts.find((item) => item.accountId === state.selectedAccountId) || null;
}

function selectedConversation() {
  return state.conversations.find((item) => item.peerId === state.selectedPeerId) || null;
}

function renderStatus() {
  const account = selectedAccount();
  const conversation = selectedConversation();
  if (!account) {
    elements.statusBadge.textContent = "未登录";
    elements.statusText.textContent = "先完成二维码登录";
    return;
  }
  if (state.status?.pauseUntilMs > Date.now()) {
    elements.statusBadge.textContent = "暂停中";
    elements.statusText.textContent = `网关会话已暂停，错误：${state.status.lastError || "未知错误"}`;
    return;
  }
  if (state.status?.lastError) {
    elements.statusBadge.textContent = "异常";
    elements.statusText.textContent = state.status.lastError;
    return;
  }
  if (conversation) {
    elements.statusBadge.textContent = "在线";
    elements.statusText.textContent = `当前会话：${conversation.peerId}`;
    return;
  }
  elements.statusBadge.textContent = "空闲";
  elements.statusText.textContent = "已登录，等待选择或新建会话";
}

function renderDebugPanel() {
  if (!state.debugOpen) {
    elements.debugPanel.classList.add("hidden");
    return;
  }
  elements.debugPanel.classList.remove("hidden");
  elements.debugContent.textContent = JSON.stringify(state.debugData || {}, null, 2);
}

function renderAccounts() {
  if (!state.accounts.length) {
    elements.accountsList.innerHTML = `<div class="muted">还没有已登录账号，先点击“扫码登录”。</div>`;
    renderStatus();
    return;
  }
  elements.accountsList.innerHTML = state.accounts.map((account) => `
    <div class="list-item ${account.accountId === state.selectedAccountId ? "active" : ""}" data-account-id="${account.accountId}">
      <div class="list-item-title">
        <span>${escapeHtml(account.displayName)}</span>
        <span>${account.isSelected ? "当前" : ""}</span>
      </div>
      <div class="list-item-subtitle">${escapeHtml(account.userId)}</div>
    </div>
  `).join("");
  elements.accountsList.querySelectorAll("[data-account-id]").forEach((node) => {
    node.addEventListener("click", async () => {
      const accountId = node.getAttribute("data-account-id");
      await request("/api/accounts/select", {
        method: "POST",
        body: JSON.stringify({ accountId }),
      });
      state.selectedAccountId = accountId;
      state.selectedPeerId = "";
      await loadAccounts();
      await loadConversations();
      await loadStatus();
      renderAccounts();
      renderConversations();
      renderMessages();
    });
  });
}

function renderConversations() {
  if (!state.selectedAccountId) {
    elements.conversationsList.innerHTML = `<div class="muted">先选择一个账号。</div>`;
    renderStatus();
    return;
  }
  if (!state.conversations.length) {
    elements.conversationsList.innerHTML = `<div class="muted">当前账号还没有会话。</div>`;
    renderStatus();
    return;
  }
  elements.conversationsList.innerHTML = state.conversations.map((conversation) => `
    <div class="list-item ${conversation.peerId === state.selectedPeerId ? "active" : ""}" data-peer-id="${conversation.peerId}">
      <div class="list-item-title">
        <span>${escapeHtml(conversation.title || conversation.peerId)}</span>
        <span>${conversation.unreadCount > 0 ? `${conversation.unreadCount} 条未读` : ""}</span>
      </div>
      <div class="list-item-subtitle">${escapeHtml(conversation.lastMessagePreview || "(空)")}</div>
    </div>
  `).join("");
  elements.conversationsList.querySelectorAll("[data-peer-id]").forEach((node) => {
    node.addEventListener("click", async () => {
      state.selectedPeerId = node.getAttribute("data-peer-id");
      await request("/api/conversations/read", {
        method: "POST",
        body: JSON.stringify({
          accountId: state.selectedAccountId,
          peerId: state.selectedPeerId,
        }),
      });
      await loadConversations();
      await loadMessages();
      await loadStatus();
      renderConversations();
      renderMessages();
    });
  });
}

function messageMediaHtml(message) {
  if (!message.mediaPath) return "";
  const url = `/api/media/${message.id}`;
  if (message.messageType === "voice") {
    return `<audio class="message-audio" controls src="${url}"></audio><a class="message-media" href="${url}" target="_blank" rel="noreferrer">下载语音</a>`;
  }
  if (message.messageType === "image") {
    return `<a class="message-media" href="${url}" target="_blank" rel="noreferrer">打开图片</a><img src="${url}" alt="${escapeHtml(message.fileName || "图片")}" />`;
  }
  return `<a class="message-media" href="${url}" target="_blank" rel="noreferrer">打开 ${escapeHtml(message.fileName || "附件")}</a>`;
}

function renderMessages() {
  const conversation = selectedConversation();
  const account = selectedAccount();
  elements.chatTitle.textContent = conversation ? (conversation.title || conversation.peerId) : "请选择一个会话";
  elements.chatMeta.textContent = account
    ? `当前账号：${account.displayName}${conversation ? ` / 会话对象：${conversation.peerId}` : ""}`
    : "当前未连接会话";

  if (!conversation) {
    elements.messagesList.innerHTML = `<div class="muted">左侧选择会话后，这里会显示完整消息时间线。</div>`;
    renderStatus();
    return;
  }
  if (state.searchQuery && state.searchResults.length) {
    elements.messagesList.innerHTML = state.searchResults.map((message) => `
      <article class="message ${message.direction}">
        <div class="message-head">
          <span>搜索命中 / ${escapeHtml(message.peerId)}</span>
          <span>${formatTime(message.createdAt)} / ${escapeHtml(message.status)}</span>
        </div>
        <div class="message-body">${escapeHtml(message.text || message.fileName || "(媒体消息)")}</div>
        ${messageMediaHtml(message)}
      </article>
    `).join("");
    renderStatus();
    return;
  }
  if (state.searchQuery && !state.searchResults.length) {
    elements.messagesList.innerHTML = `<div class="muted">当前搜索词没有命中消息。</div>`;
    renderStatus();
    return;
  }
  if (!state.messages.length) {
    elements.messagesList.innerHTML = `<div class="muted">这个会话暂时没有消息。</div>`;
    renderStatus();
    return;
  }
  elements.messagesList.innerHTML = state.messages.map((message) => `
    <article class="message ${message.direction}">
      <div class="message-head">
        <span>${message.direction === "outbound" ? "我发出的" : "收到的"}</span>
        <span>${formatTime(message.createdAt)} / ${escapeHtml(message.status)}</span>
      </div>
      <div class="message-body">${escapeHtml(message.text || "")}</div>
      ${messageMediaHtml(message)}
    </article>
  `).join("");
  elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
  renderStatus();
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
  });
}

async function loadBootstrap() {
  const payload = await request("/api/bootstrap");
  state.config = payload.config;
  state.accounts = payload.accounts;
  state.selectedAccountId = payload.selectedAccountId || payload.accounts[0]?.accountId || "";
  setConfigForm(state.config);
}

async function loadAccounts() {
  state.accounts = await request("/api/accounts");
  if (!state.selectedAccountId) {
    state.selectedAccountId = state.accounts.find((item) => item.isSelected)?.accountId || state.accounts[0]?.accountId || "";
  }
}

async function loadConversations() {
  if (!state.selectedAccountId) {
    state.conversations = [];
    return;
  }
  state.conversations = await request(`/api/conversations?accountId=${encodeURIComponent(state.selectedAccountId)}`);
  if (!state.selectedPeerId && state.conversations[0]) {
    state.selectedPeerId = state.conversations[0].peerId;
  }
}

async function loadMessages() {
  if (!state.selectedAccountId || !state.selectedPeerId) {
    state.messages = [];
    return;
  }
  state.messages = await request(
    `/api/messages?accountId=${encodeURIComponent(state.selectedAccountId)}&peerId=${encodeURIComponent(state.selectedPeerId)}`,
  );
}

async function loadStatus() {
  if (!state.selectedAccountId) {
    state.status = null;
    renderStatus();
    return;
  }
  state.status = await request(`/api/status?accountId=${encodeURIComponent(state.selectedAccountId)}`);
  renderStatus();
}

async function loadDebug() {
  if (!state.selectedAccountId) {
    state.debugData = null;
    renderDebugPanel();
    return;
  }
  state.debugData = await request(`/api/debug?accountId=${encodeURIComponent(state.selectedAccountId)}`);
  renderDebugPanel();
}

async function saveConfig(event) {
  event.preventDefault();
  state.config = await request("/api/config", {
    method: "POST",
    body: JSON.stringify({
      baseUrl: elements.baseUrlInput.value.trim(),
      cdnBaseUrl: elements.cdnBaseUrlInput.value.trim(),
      botType: elements.botTypeInput.value.trim() || "3",
      defaultWorkspace: elements.defaultWorkspaceInput.value.trim(),
      codexWorkspace: elements.codexWorkspaceInput.value.trim(),
      claudeWorkspace: elements.claudeWorkspaceInput.value.trim(),
      openclawMode: elements.openclawModeInput.value,
      openclawWorkspace: elements.openclawWorkspaceInput.value.trim(),
      openclawCommand: elements.openclawCommandInput.value.trim(),
      openclawDataDir: elements.openclawDataDirInput.value.trim(),
      openclawContainer: elements.openclawContainerInput.value.trim(),
    }),
  });
  setConfigForm(state.config);
  elements.healthBadge.textContent = "设置已保存";
  showToast("网关设置已保存");
}

function openLoginDialog() {
  elements.loginDialog.showModal();
}

function closeLoginDialog() {
  elements.loginDialog.close();
  stopLoginPolling();
}

async function startLoginFlow() {
  setBusy(true);
  try {
    const session = await request("/api/login/start", {
      method: "POST",
    });
    state.currentLoginSessionKey = session.sessionKey;
    elements.loginStatusText.textContent = "二维码已生成，请用手机微信扫码并确认。";
    renderQrContent(session.qrcode, session.qrcodeUrl);
    startLoginPolling();
    showToast("二维码已生成");
  } finally {
    setBusy(false);
  }
}

async function refreshLoginStatus() {
  if (!state.currentLoginSessionKey) return;
  const session = await request(`/api/login/session?sessionKey=${encodeURIComponent(state.currentLoginSessionKey)}`);
  elements.loginStatusText.textContent = `状态：${session.status}${session.error ? ` / ${session.error}` : ""}`;
  if (session.qrcode || session.qrcodeUrl) {
    renderQrContent(session.qrcode, session.qrcodeUrl);
  }
  if (session.status === "confirmed") {
    stopLoginPolling();
    await loadAccounts();
    await loadConversations();
    await loadMessages();
    await loadStatus();
    await loadDebug();
    renderAccounts();
    renderConversations();
    renderMessages();
    showToast("登录成功，已写入本地账号");
  }
  if (session.status === "expired") {
    showToast("二维码已过期，请重新生成", "error");
  }
  if (session.status === "error") {
    showToast(session.error || "登录状态刷新失败", "error");
  }
}

function startLoginPolling() {
  stopLoginPolling();
  state.loginPollTimer = window.setInterval(() => {
    refreshLoginStatus().catch((error) => {
      elements.loginStatusText.textContent = error.message;
    });
  }, 4000);
}

function stopLoginPolling() {
  if (state.loginPollTimer) {
    window.clearInterval(state.loginPollTimer);
    state.loginPollTimer = null;
  }
}

async function sendText() {
  if (!state.selectedAccountId || !state.selectedPeerId) {
    alert("先选择账号和会话");
    return;
  }
  const text = elements.messageInput.value.trim();
  if (!text) {
    alert("请输入要发送的文本");
    return;
  }
  setBusy(true);
  try {
    await request("/api/messages/text", {
      method: "POST",
      body: JSON.stringify({
        accountId: state.selectedAccountId,
        peerId: state.selectedPeerId,
        text,
      }),
    });
    elements.messageInput.value = "";
    await loadConversations();
    await loadMessages();
    await loadStatus();
    await loadDebug();
    renderConversations();
    renderMessages();
    showToast("文本消息已发送");
  } finally {
    setBusy(false);
  }
}

async function fileToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function isVoiceLikeFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const mime = String(file?.type || "").toLowerCase();
  return mime.startsWith("audio/")
    || [".silk", ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus"].some((ext) => name.endsWith(ext));
}

async function sendMedia() {
  if (!state.selectedAccountId || !state.selectedPeerId) {
    alert("先选择账号和会话");
    return;
  }
  const file = elements.fileInput.files?.[0];
  if (!file) {
    alert("先选择要发送的文件");
    return;
  }
  setBusy(true);
  try {
    const bytesBase64 = await fileToBase64(file);
    await request("/api/messages/media", {
      method: "POST",
      body: JSON.stringify({
        accountId: state.selectedAccountId,
        peerId: state.selectedPeerId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        bytesBase64,
        caption: elements.messageInput.value.trim(),
        sendAsVoice: false,
      }),
    });
    elements.messageInput.value = "";
    elements.fileInput.value = "";
    elements.selectedFileName.textContent = "未选择文件";
    await loadConversations();
    await loadMessages();
    await loadStatus();
    await loadDebug();
    renderConversations();
    renderMessages();
    showToast("媒体消息已发送");
  } finally {
    setBusy(false);
  }
}

async function openConversation() {
  if (!state.selectedAccountId) {
    alert("先登录并选择账号");
    return;
  }
  const peerId = elements.newPeerInput.value.trim();
  if (!peerId) {
    alert("请输入对方 user_id");
    return;
  }
  setBusy(true);
  try {
    await request("/api/conversations/open", {
      method: "POST",
      body: JSON.stringify({
        accountId: state.selectedAccountId,
        peerId,
      }),
    });
    elements.newPeerInput.value = "";
    state.selectedPeerId = peerId;
    await loadConversations();
    await loadMessages();
    await loadStatus();
    await loadDebug();
    renderConversations();
    renderMessages();
    showToast("会话已创建，可以直接发消息");
  } finally {
    setBusy(false);
  }
}

async function searchMessages() {
  if (!state.selectedAccountId) {
    alert("先选择账号");
    return;
  }
  const query = elements.searchInput.value.trim();
  state.searchQuery = query;
  if (!query) {
    state.searchResults = [];
    renderMessages();
    return;
  }
  state.searchResults = await request(
    `/api/messages/search?accountId=${encodeURIComponent(state.selectedAccountId)}&peerId=${encodeURIComponent(state.selectedPeerId || "")}&q=${encodeURIComponent(query)}`,
  );
  renderMessages();
  showToast(`搜索完成，共 ${state.searchResults.length} 条命中`);
}

function clearSearch() {
  state.searchQuery = "";
  state.searchResults = [];
  elements.searchInput.value = "";
  renderMessages();
}

async function exportConversation() {
  if (!state.selectedAccountId || !state.selectedPeerId) {
    alert("先选择一个会话");
    return;
  }
  const url = `/api/export/conversation?accountId=${encodeURIComponent(state.selectedAccountId)}&peerId=${encodeURIComponent(state.selectedPeerId)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  showToast("会话导出已开始");
}

async function toggleDebugPanel() {
  state.debugOpen = !state.debugOpen;
  if (state.debugOpen) {
    await loadDebug();
    showToast("调试面板已打开");
  } else {
    renderDebugPanel();
  }
}

function attachEventSource() {
  const source = new EventSource("/api/events");
  source.onmessage = async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "bootstrap") {
      return;
    }
    if (payload.type === "accounts") {
      await loadAccounts();
      await loadStatus();
      await loadDebug();
      renderAccounts();
    }
    if (payload.type === "conversations" && payload.accountId === state.selectedAccountId) {
      await loadConversations();
      renderConversations();
    }
    if (payload.type === "messages" && payload.accountId === state.selectedAccountId && payload.peerId === state.selectedPeerId) {
      await loadMessages();
      renderMessages();
    }
    if (payload.type === "status" && payload.payload?.error) {
      elements.healthBadge.textContent = "连接异常";
      await loadStatus();
      showToast(payload.payload.error, "error");
    }
  };
}

async function initialLoad() {
  await checkHealth();
  await loadBootstrap();
  await loadConversations();
  await loadMessages();
  await loadStatus();
  await loadDebug();
  renderAccounts();
  renderConversations();
  renderMessages();
  renderDebugPanel();
  attachEventSource();
}

elements.configForm.addEventListener("submit", saveConfig);
elements.loginBtn.addEventListener("click", openLoginDialog);
elements.closeLoginDialogBtn.addEventListener("click", closeLoginDialog);
elements.startLoginFlowBtn.addEventListener("click", () => startLoginFlow().catch((error) => {
  elements.loginStatusText.textContent = error.message;
}));
elements.pollLoginBtn.addEventListener("click", () => refreshLoginStatus().catch((error) => {
  elements.loginStatusText.textContent = error.message;
}));
elements.refreshConversationsBtn.addEventListener("click", async () => {
  await loadConversations();
  await loadMessages();
  await loadStatus();
  renderConversations();
  renderMessages();
});
elements.openConversationBtn.addEventListener("click", () => openConversation().catch((error) => showToast(error.message, "error")));
elements.searchBtn.addEventListener("click", () => searchMessages().catch((error) => showToast(error.message, "error")));
elements.clearSearchBtn.addEventListener("click", clearSearch);
elements.exportBtn.addEventListener("click", () => exportConversation().catch((error) => showToast(error.message, "error")));
elements.debugBtn.addEventListener("click", () => toggleDebugPanel().catch((error) => showToast(error.message, "error")));
elements.sendTextBtn.addEventListener("click", () => sendText().catch((error) => alert(error.message)));
elements.sendMediaBtn.addEventListener("click", () => sendMedia().catch((error) => alert(error.message)));
elements.fileInput.addEventListener("change", () => {
  elements.selectedFileName.textContent = elements.fileInput.files?.[0]?.name || "未选择文件";
});
elements.messageInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    sendText().catch((error) => showToast(error.message, "error"));
  }
});

initialLoad().catch((error) => {
  elements.healthBadge.textContent = error.message;
  showToast(error.message, "error");
});
