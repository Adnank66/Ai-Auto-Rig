/**
 * NEON RIG — AI PC ARCHITECT CHAT ASSISTANT
 * Lightweight, fast, natural language hardware advisor & build generator.
 */

(function () {
  // Chat State
  const aiState = {
    isOpen: false,
    isTyping: false,
    messages: [],
    sessionContext: {}
  };

  const SUGGESTED_PROMPTS = [
    '🎮 Gaming PC under ₹70k',
    '💻 Editing PC under ₹1 Lakh',
    '⚡ Best GPU for Ryzen 5 7600',
    '⚡ Compare RTX 4060 and RTX 3060',
    '🚀 Upgrade my current PC',
    '🛠️ Will Ryzen 5 7600 work with B650?'
  ];

  // Initialize Chat UI on DOM load
  document.addEventListener('DOMContentLoaded', () => {
    injectAIChatUI();
    loadSession();
  });

  function injectAIChatUI() {
    // 1. Floating Launch Button (Bottom-Right)
    const fab = document.createElement('button');
    fab.id = 'ai-chat-fab';
    fab.className = 'ai-chat-fab';
    fab.setAttribute('aria-label', 'Open AI PC Builder Assistant');
    fab.onclick = toggleAIChat;
    fab.innerHTML = `
      <span class="ai-fab-icon">🤖</span>
      <span class="ai-fab-label">AI Architect</span>
      <span class="ai-fab-pulse"></span>
    `;
    document.body.appendChild(fab);

    // 2. Chat Drawer / Floating Window
    const chatWindow = document.createElement('div');
    chatWindow.id = 'ai-chat-window';
    chatWindow.className = 'ai-chat-window';
    chatWindow.innerHTML = `
      <!-- Header -->
      <div class="ai-chat-header">
        <div class="ai-header-info">
          <div class="ai-avatar-badge">🤖</div>
          <div>
            <div class="ai-header-title">NEON RIG AI Architect</div>
            <div class="ai-header-status"><span class="ai-status-dot"></span> Online & Database-Tuned</div>
          </div>
        </div>
        <div class="ai-header-actions">
          <button class="ai-btn-icon" onclick="clearAIChat()" title="Clear Conversation">🗑️</button>
          <button class="ai-btn-icon" onclick="toggleAIChat()" title="Close Assistant">✕</button>
        </div>
      </div>

      <!-- Quick Suggested Prompts -->
      <div class="ai-quick-prompts-bar" id="ai-quick-prompts">
        ${SUGGESTED_PROMPTS.map(p => `<button class="ai-prompt-chip" onclick="sendQuickPrompt('${escapeHtml(p)}')">${escapeHtml(p)}</button>`).join('')}
      </div>

      <!-- Messages Thread -->
      <div class="ai-chat-messages" id="ai-chat-messages">
        <!-- Initial Welcome Message -->
        <div class="ai-msg-row ai">
          <div class="ai-msg-avatar">🤖</div>
          <div class="ai-msg-bubble">
            <div class="ai-msg-text">
              Hello! I am your <strong>AI PC Hardware Architect</strong>. I have real-time access to our verified component inventory.<br/><br/>
              Ask me to build a PC for your budget, compare graphics cards, check compatibility, or explain technical specs!
            </div>
            <div class="ai-msg-time">${getCurrentTime()}</div>
          </div>
        </div>
      </div>

      <!-- Typing Indicator -->
      <div class="ai-typing-indicator" id="ai-typing-indicator" style="display:none;">
        <span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>
        <span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px;">Analyzing hardware database...</span>
      </div>

      <!-- Input Bar -->
      <form class="ai-chat-input-bar" onsubmit="handleAIChatSubmit(event)">
        <input 
          type="text" 
          id="ai-user-input" 
          class="ai-chat-input" 
          placeholder="Ask AI: 'Build gaming PC under ₹70k' or 'Best GPU for Ryzen 5 7600'..." 
          autocomplete="off"
        />
        <button type="button" class="ai-chat-voice-btn" id="ai-voice-btn" onclick="handleVoiceInput()" title="Speak your question (Web Speech)">
          🎤
        </button>
        <button type="submit" class="ai-chat-send-btn" id="ai-send-btn" title="Send Message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </form>
    `;
    document.body.appendChild(chatWindow);
  }

  // ==========================================
  // VOICE INPUT / SPEECH RECOGNITION (BROWSER NATIVE)
  // ==========================================
  let recognition = null;
  let isRecording = false;

  window.handleVoiceInput = function () {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (typeof window.showToast === 'function') {
        window.showToast('Voice input is not supported in this browser. Please use text input.', 'info');
      } else {
        alert('Voice input is not supported in this browser. Please use text input.');
      }
      return;
    }

    const micBtn = document.getElementById('ai-voice-btn');
    const input = document.getElementById('ai-user-input');

    if (isRecording && recognition) {
      recognition.stop();
      isRecording = false;
      if (micBtn) micBtn.classList.remove('is-recording');
      return;
    }

    try {
      recognition = new SpeechRecognition();
      recognition.lang = 'en-IN';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = function () {
        isRecording = true;
        if (micBtn) {
          micBtn.classList.add('is-recording');
          micBtn.title = 'Listening... Speak now';
        }
        if (typeof window.showToast === 'function') {
          window.showToast('🎙️ Listening... Speak your PC question now', 'info');
        }
      };

      recognition.onresult = function (event) {
        const transcript = event.results[0][0].transcript;
        if (input && transcript) {
          // Indian currency / number conversions
          let cleaned = transcript
            .replace(/seventy thousand rupees?/gi, '₹70,000')
            .replace(/eighty thousand rupees?/gi, '₹80,000')
            .replace(/fifty thousand rupees?/gi, '₹50,000')
            .replace(/sixty thousand rupees?/gi, '₹60,000')
            .replace(/one lakh rupees?/gi, '₹1,00,000')
            .replace(/one point five lakh rupees?/gi, '₹1,50,000')
            .replace(/two lakh rupees?/gi, '₹2,00,000')
            .replace(/rupees?/gi, '₹');

          input.value = cleaned;
          handleAIChatSubmit();
        }
      };

      recognition.onerror = function (event) {
        isRecording = false;
        if (micBtn) micBtn.classList.remove('is-recording');
        if (event.error !== 'no-speech' && typeof window.showToast === 'function') {
          window.showToast(`Voice input: ${event.error}`, 'error');
        }
      };

      recognition.onend = function () {
        isRecording = false;
        if (micBtn) {
          micBtn.classList.remove('is-recording');
          micBtn.title = 'Speak your question';
        }
      };

      recognition.start();
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Voice input is not supported in this browser. Please use text input.', 'info');
      }
    }
  };

  // ==========================================
  // TOGGLE & VISIBILITY
  // ==========================================
  window.toggleAIChat = function () {
    aiState.isOpen = !aiState.isOpen;
    const win = document.getElementById('ai-chat-window');
    const fab = document.getElementById('ai-chat-fab');
    if (!win) return;

    if (aiState.isOpen) {
      win.classList.add('is-open');
      if (fab) fab.classList.add('is-active');
      const input = document.getElementById('ai-user-input');
      if (input) setTimeout(() => input.focus(), 150);
      scrollChatToBottom();
    } else {
      win.classList.remove('is-open');
      if (fab) fab.classList.remove('is-active');
    }
  };

  window.openAIChat = function () {
    if (!aiState.isOpen) toggleAIChat();
  };

  window.closeAIChat = function () {
    if (aiState.isOpen) toggleAIChat();
  };

  // ==========================================
  // MESSAGE SENDING & HANDLING
  // ==========================================
  window.handleAIChatSubmit = async function (e) {
    if (e) e.preventDefault();
    const input = document.getElementById('ai-user-input');
    if (!input) return;

    const message = input.value.trim();
    if (!message || aiState.isTyping) return;

    input.value = '';
    appendUserMessage(message);
    setTyping(true);

    // Sync active workstation builder state into session context
    const currentSelected = window.state ? window.state.selected : {};
    aiState.sessionContext.currentSelected = currentSelected;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionContext: aiState.sessionContext
        })
      });

      if (!res.ok) throw new Error(await res.text());
      const reply = await res.json();
      setTyping(false);
      appendAIMessage(reply);
    } catch (err) {
      setTyping(false);
      appendErrorMessage('I encountered an error connecting to the hardware engine. Please try again!');
    }
  };

  window.sendQuickPrompt = function (promptText) {
    openAIChat();
    const input = document.getElementById('ai-user-input');
    if (input) {
      input.value = promptText;
      handleAIChatSubmit();
    }
  };

  window.askAIAboutComponent = function (partId) {
    if (!window.state || !window.state.components) return;
    const part = window.state.components.find(c => c.id === Number(partId));
    if (!part) return;

    openAIChat();
    const promptText = `Explain the ${part.name} (${part.category_name}). What are its pros, cons, and compatible companion parts?`;
    const input = document.getElementById('ai-user-input');
    if (input) {
      input.value = promptText;
      handleAIChatSubmit();
    }
  };

  window.clearAIChat = function () {
    const thread = document.getElementById('ai-chat-messages');
    if (!thread) return;
    thread.innerHTML = `
      <div class="ai-msg-row ai">
        <div class="ai-msg-avatar">🤖</div>
        <div class="ai-msg-bubble">
          <div class="ai-msg-text">
            Conversation cleared. How can I help you design or upgrade your PC today?
          </div>
          <div class="ai-msg-time">${getCurrentTime()}</div>
        </div>
      </div>
    `;
    aiState.messages = [];
  };

  // ==========================================
  // DOM RENDERING HELPERS
  // ==========================================
  function appendUserMessage(text) {
    const thread = document.getElementById('ai-chat-messages');
    if (!thread) return;

    const row = document.createElement('div');
    row.className = 'ai-msg-row user';
    row.innerHTML = `
      <div class="ai-msg-bubble user">
        <div class="ai-msg-text">${escapeHtml(text)}</div>
        <div class="ai-msg-time">${getCurrentTime()}</div>
      </div>
      <div class="ai-msg-avatar user">👤</div>
    `;
    thread.appendChild(row);
    scrollChatToBottom();
  }

  function appendAIMessage(reply) {
    const thread = document.getElementById('ai-chat-messages');
    if (!thread) return;

    const row = document.createElement('div');
    row.className = 'ai-msg-row ai';

    let extraHTML = '';

    // 1. Build Recommendation Interactive Card
    if (reply.type === 'BUILD_RECOMMENDATION' && reply.buildData) {
      const b = reply.buildData;
      const partsHTML = (b.components || []).map(c => `
        <div class="ai-build-part-item">
          <div class="ai-part-meta">
            <span class="badge badge-cyan" style="font-size:0.65rem;">${escapeHtml(c.category)}</span>
            <span class="ai-part-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
          </div>
          <span class="ai-part-price">${c.formattedPrice}</span>
        </div>
      `).join('');

      const fpsHTML = (b.fpsEstimates || []).slice(0, 3).map(f => `
        <div class="ai-fps-chip">
          <span style="color:#fff; font-weight:700;">${f.fps} FPS</span>
          <span style="color:var(--text-muted); font-size:0.75rem;">${f.game}</span>
        </div>
      `).join('');

      extraHTML = `
        <div class="ai-interactive-card">
          <div class="ai-card-banner">
            <div>
              <div class="ai-card-title">${escapeHtml(b.buildTitle)}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">Budget Target: ₹${b.budget.toLocaleString('en-IN')}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
              <span class="badge badge-green">${b.compatibility.status}</span>
              <span class="badge badge-purple" style="font-size:0.68rem; font-weight:700;">Score: ${b.smartScore}/100</span>
            </div>
          </div>

          <div class="ai-build-parts-list">
            ${partsHTML}
          </div>

          <div class="ai-build-total-row">
            <span>Estimated Total (18% GST Incl.):</span>
            <strong style="color:var(--cyan); font-family:var(--font-heading); font-size:1.1rem;">${b.formattedTotal}</strong>
          </div>

          ${fpsHTML ? `
            <div style="margin-top:10px;">
              <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">🎮 ESTIMATED GAMING FPS (1080P):</div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">${fpsHTML}</div>
            </div>
          ` : ''}

          <!-- Direct Actions -->
          <div class="ai-card-actions">
            <button class="btn btn-primary btn-sm" onclick="loadAIBuildToWorkstation('${encodeURIComponent(JSON.stringify(b.selectedMap))}', '${escapeHtml(b.buildTitle)}', ${b.smartScore})">
              🛠️ Add to Builder
            </button>
            <button class="btn btn-secondary btn-sm" onclick="saveAIBuildDirectly('${encodeURIComponent(JSON.stringify(b.selectedMap))}', '${escapeHtml(b.buildTitle)}', ${b.totalPrice}, ${b.smartScore})">
              💾 Save Build
            </button>
          </div>
        </div>
      `;
    }

    // 2. Component Comparison Card
    if (reply.type === 'COMPONENT_COMPARISON' && reply.comparisonData) {
      const c = reply.comparisonData;
      const rowsHTML = (c.rows || []).map(r => `
        <tr>
          <td style="color:var(--text-dim); font-size:0.78rem;">${escapeHtml(r.feature)}</td>
          <td><strong>${escapeHtml(r.compA)}</strong></td>
          <td><strong>${escapeHtml(r.compB)}</strong></td>
        </tr>
      `).join('');

      extraHTML = `
        <div class="ai-interactive-card">
          <table class="pro-table" style="font-size:0.8rem;">
            <thead>
              <tr>
                <th>Feature</th>
                <th>${escapeHtml(c.compA.name)}</th>
                <th>${escapeHtml(c.compB.name)}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHTML}
            </tbody>
          </table>
        </div>
      `;
    }

    // 3. Upgrade Recommendations Card
    if (reply.type === 'UPGRADE_ADVICE' && reply.upgradeData) {
      const uData = reply.upgradeData;
      const upgradesHTML = (uData.upgrades || []).map(u => `
        <div class="ai-upgrade-item">
          <div>
            <strong>${escapeHtml(u.category)}:</strong> ${escapeHtml(u.current)} → <span style="color:var(--cyan); font-weight:700;">${escapeHtml(u.upgrade)}</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
            <span style="color:var(--accent-green); font-size:0.8rem; font-weight:700;">+${escapeHtml(u.priceDifference)}</span>
            <button class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.75rem;" onclick="applyAIUpgrade('${u.category}', ${u.upgradeId})">
              Apply
            </button>
          </div>
        </div>
      `).join('');

      extraHTML = `
        <div class="ai-interactive-card">
          <div style="font-weight:700; color:#fff; margin-bottom:8px; font-size:0.85rem;">Step-by-Step Upgrade Path:</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${upgradesHTML}
          </div>
        </div>
      `;
    }

    // Suggested Follow-up chips
    let followupsHTML = '';
    if (reply.suggestions && reply.suggestions.length > 0) {
      followupsHTML = `
        <div class="ai-followup-chips">
          ${reply.suggestions.map(s => `<button class="ai-followup-chip" onclick="sendQuickPrompt('${escapeHtml(s)}')">${escapeHtml(s)}</button>`).join('')}
        </div>
      `;
    }

    row.innerHTML = `
      <div class="ai-msg-avatar">🤖</div>
      <div class="ai-msg-bubble">
        <div class="ai-msg-text">${formatMarkdown(reply.text || '')}</div>
        ${extraHTML}
        ${followupsHTML}
        <div class="ai-msg-time">${getCurrentTime()}</div>
      </div>
    `;

    thread.appendChild(row);
    scrollChatToBottom();
  }

  function appendErrorMessage(errText) {
    const thread = document.getElementById('ai-chat-messages');
    if (!thread) return;

    const row = document.createElement('div');
    row.className = 'ai-msg-row ai';
    row.innerHTML = `
      <div class="ai-msg-avatar">🤖</div>
      <div class="ai-msg-bubble" style="border-color:var(--accent-red);">
        <div class="ai-msg-text" style="color:var(--accent-red);">${escapeHtml(errText)}</div>
        <div class="ai-msg-time">${getCurrentTime()}</div>
      </div>
    `;
    thread.appendChild(row);
    scrollChatToBottom();
  }

  function setTyping(typing) {
    aiState.isTyping = typing;
    const indicator = document.getElementById('ai-typing-indicator');
    const sendBtn = document.getElementById('ai-send-btn');
    if (indicator) indicator.style.display = typing ? 'flex' : 'none';
    if (sendBtn) sendBtn.disabled = typing;
    if (typing) scrollChatToBottom();
  }

  function scrollChatToBottom() {
    const thread = document.getElementById('ai-chat-messages');
    if (thread) {
      setTimeout(() => { thread.scrollTop = thread.scrollHeight; }, 50);
    }
  }

  // ==========================================
  // ACTION HOOKS (LOAD, SAVE, UPGRADE)
  // ==========================================
  window.loadAIBuildToWorkstation = function (encodedMap, title, smartScore) {
    try {
      const selectedMap = JSON.parse(decodeURIComponent(encodedMap));
      if (!window.state) return;

      window.state.selected = { ...selectedMap };
      const nameInput = document.getElementById('current-build-name');
      if (nameInput) nameInput.value = title.replace(/[^\w\s\(\)₹-]/g, '').trim() || 'AI Generated Rig';

      if (typeof window.navigateTo === 'function') {
        window.navigateTo('builder');
      }
      if (typeof window.renderCategoryTabs === 'function') window.renderCategoryTabs();
      if (typeof window.renderCategoryParts === 'function') window.renderCategoryParts(window.state.activeCategory || 'CPU');
      if (typeof window.renderCurrentBuildSummary === 'function') window.renderCurrentBuildSummary();
      if (typeof window.broadcastBuildUpdate === 'function') window.broadcastBuildUpdate();

      if (typeof window.showToast === 'function') {
        window.showToast(`AI Build loaded into workstation (Smart Score: ${smartScore || 92}/100)!`, 'success');
      }
      closeAIChat();
    } catch (e) {
      console.error('Error loading AI build:', e);
    }
  };

  window.saveAIBuildDirectly = async function (encodedMap, title, totalPrice, smartScore) {
    if (!window.state || !window.state.user || !window.state.token) {
      if (typeof window.openAuthModal === 'function') window.openAuthModal('login');
      if (typeof window.showToast === 'function') window.showToast('Please sign in to save your build to database.', 'info');
      return;
    }

    try {
      const selectedMap = JSON.parse(decodeURIComponent(encodedMap));
      const payload = {
        build_name: title.replace(/[^\w\s\(\)₹-]/g, '').trim() || 'AI Custom Rig',
        cpu_id: selectedMap['CPU'] || null,
        gpu_id: selectedMap['GPU'] || null,
        motherboard_id: selectedMap['Motherboard'] || null,
        ram_id: selectedMap['RAM'] || null,
        storage_id: selectedMap['Storage'] || null,
        psu_id: selectedMap['PSU'] || null,
        case_id: selectedMap['Case'] || null,
        total_price: Number(totalPrice) || 0,
        compatibility_status: 'VALID',
        performance_score: Number(smartScore) || 91
      };

      const res = await fetch('/api/builds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${window.state.token}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(await res.text());
      const saved = await res.json();

      if (typeof window.showToast === 'function') {
        window.showToast(`Saved "${saved.build_name}" (Score: ${saved.performance_score}/100) to My Builds!`, 'success');
      }

      // If user builds view is available, refresh it
      if (typeof window.loadUserBuilds === 'function') {
        window.loadUserBuilds();
      }
    } catch (err) {
      if (typeof window.showToast === 'function') {
        window.showToast('Failed to save build: ' + err.message, 'error');
      }
    }
  };

  window.applyAIUpgrade = function (category, compId) {
    if (typeof window.selectComponent === 'function') {
      window.selectComponent(category, Number(compId));
      if (typeof window.showToast === 'function') {
        window.showToast(`Applied ${category} upgrade to your active rig!`, 'success');
      }
    }
  };

  window.clearAIChat = function () {
    if (aiState.messages.length > 0) {
      if (!confirm('Are you sure you want to clear this AI conversation?')) return;
    }
    aiState.messages = [];
    const thread = document.getElementById('ai-chat-messages');
    if (thread) {
      thread.innerHTML = `
        <div class="ai-msg-row ai">
          <div class="ai-msg-avatar">🤖</div>
          <div class="ai-msg-bubble">
            <div class="ai-msg-text">
              Conversation cleared. How can I assist you with your PC build today?
            </div>
            <div class="ai-msg-time">${getCurrentTime()}</div>
          </div>
        </div>
      `;
    }
    if (typeof window.showToast === 'function') {
      window.showToast('AI chat cleared.', 'info');
    }
  };

  // ==========================================
  // FORMATTING & UTILS
  // ==========================================
  function formatMarkdown(text) {
    if (!text) return '';
    let out = escapeHtml(text);
    // Bold: **text**
    out = out.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italics: *text*
    out = out.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Bullet points: • or -
    out = out.replace(/\n•\s*(.*?)(?=\n|$)/g, '<br/>• $1');
    // Newlines
    out = out.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>');
    return out;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getCurrentTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function loadSession() {
    // Session state initialized
  }
})();
