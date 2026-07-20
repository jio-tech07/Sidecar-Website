window.addEventListener('error', (event) => {
    alert(`JS Error: ${event.message} at ${event.filename}:${event.lineno}`);
});

/* ==========================================================================
   FIRESTORE HELPERS
   ========================================================================== */

// Collection name constants for Firestore
const COLLECTIONS = {
    CUSTOMERS: 'customers',
    BUILDS: 'builds',
    REPAIRS: 'repairs',
    WELDING_JOBS: 'weldingJobs',
    WELDERS: 'welders',
    GALLERY: 'gallery',
    INQUIRIES: 'inquiries',
    SETTINGS: 'settings',
    VALES: 'vales',
    PAYROLLS: 'payrolls',
    MATERIALS: 'materials',
    MATERIAL_CATEGORIES: 'material_categories',
    PRODUCT_CATEGORIES: 'product_categories',
    PRODUCT_TEMPLATES: 'product_templates',
    PRODUCT_VARIANTS: 'product_variants',
    PRODUCT_VARIANT_MATERIALS: 'product_variant_materials',
    DAILY_TRAFFIC: 'daily_traffic'
};

// Save a single document to a Firestore collection (uses item.id as doc ID)
async function saveDocToFirestore(collectionName, item) {
    try {
        await db.collection(collectionName).doc(item.id).set(item);
    } catch (e) {
        console.error(`Firestore write error (${collectionName}/${item.id}):`, e);
    }
}

// Delete a single document from a Firestore collection
async function deleteDocFromFirestore(collectionName, docId) {
    try {
        await db.collection(collectionName).doc(docId).delete();
    } catch (e) {
        console.error(`Firestore delete error (${collectionName}/${docId}):`, e);
    }
}

// Save an entire array to a Firestore collection (batch overwrite)
async function saveCollectionToFirestore(collectionName, items) {
    try {
        const batch = db.batch();
        items.forEach(item => {
            const ref = db.collection(collectionName).doc(item.id);
            batch.set(ref, item);
        });
        await batch.commit();
    } catch (e) {
        console.error(`Firestore batch write error (${collectionName}):`, e);
    }
}

// Load all documents from a Firestore collection
async function loadCollectionFromFirestore(collectionName) {
    try {
        const snapshot = await db.collection(collectionName).get();
        return snapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error(`Firestore read error (${collectionName}):`, e);
        return [];
    }
}

// Save settings doc (single document like contactInfo)
async function saveSettingsDoc(docId, data) {
    try {
        await db.collection(COLLECTIONS.SETTINGS).doc(docId).set(data);
    } catch (e) {
        console.error(`Firestore settings write error (${docId}):`, e);
    }
}

// Load settings doc
async function loadSettingsDoc(docId) {
    try {
        const doc = await db.collection(COLLECTIONS.SETTINGS).doc(docId).get();
        return doc.exists ? doc.data() : null;
    } catch (e) {
        console.error(`Firestore settings read error (${docId}):`, e);
        return null;
    }
}

// Compress and convert any uploaded image file to WebP client-side to keep files under 100KB and save instantly
function compressAndConvertToWebP(file, maxDimension = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDimension) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    }
                } else {
                    if (height > maxDimension) {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/webp', quality);
                
                try {
                    const parts = dataUrl.split(',');
                    const byteString = atob(parts[1]);
                    const mimeString = parts[0].split(':')[1].split(';')[0];
                    
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    
                    const blob = new Blob([ab], { type: mimeString });
                    const oldName = file.name || 'image.jpg';
                    const baseName = oldName.substring(0, oldName.lastIndexOf('.')) || oldName;
                    const newFileName = `${baseName}.webp`;
                    const webpFile = new File([blob], newFileName, { type: 'image/webp' });
                    
                    resolve({ file: webpFile, dataUrl: dataUrl });
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = (err) => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

// Utility: returns local date string in YYYY-MM-DD format
function getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Check if a specific date's traffic record exists; if not, create it
async function checkAndBootstrapTrafficForDate(dateStr) {
    let record = state.dailyTraffic.find(t => t.id === dateStr);
    
    if (!record) {
        record = {
            id: dateStr,
            date: dateStr,
            moneyInTransactions: [],
            moneyOutTransactions: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        state.dailyTraffic.push(record);
        await saveDocToFirestore(COLLECTIONS.DAILY_TRAFFIC, record);
    }
    
    // Safety check for legacy data formats
    if (!record.moneyInTransactions) record.moneyInTransactions = [];
    if (!record.moneyOutTransactions) record.moneyOutTransactions = [];
    return record;
}

// Log Money In to today's date (or selected date)
async function logMoneyInForDate(amount, note, dateStr = null) {
    if (!dateStr) dateStr = state.activeTrafficDate || getLocalDateString();
    const record = await checkAndBootstrapTrafficForDate(dateStr);
    
    const tx = {
        id: `tx_in_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        amount: parseFloat(amount) || 0,
        note: note || 'General Revenue',
        created_at: new Date().toISOString()
    };
    
    record.moneyInTransactions.push(tx);
    record.updated_at = new Date().toISOString();
    await saveDocToFirestore(COLLECTIONS.DAILY_TRAFFIC, record);
    
    renderDailyTraffic();
    if (document.getElementById('modal-money-in').classList.contains('active') && state.activeTrafficDate === dateStr) {
        renderMoneyInList();
    }
}

// Log Money Out to today's date (or selected date)
async function logMoneyOutForDate(amount, note, dateStr = null) {
    if (!dateStr) dateStr = state.activeTrafficDate || getLocalDateString();
    const record = await checkAndBootstrapTrafficForDate(dateStr);
    
    const tx = {
        id: `tx_out_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        amount: parseFloat(amount) || 0,
        note: note || 'General Expenditure',
        created_at: new Date().toISOString()
    };
    
    record.moneyOutTransactions.push(tx);
    record.updated_at = new Date().toISOString();
    await saveDocToFirestore(COLLECTIONS.DAILY_TRAFFIC, record);
    
    renderDailyTraffic();
    if (document.getElementById('modal-money-out').classList.contains('active') && state.activeTrafficDate === dateStr) {
        renderMoneyOutList();
    }
}

// Delete cash transaction by id
async function deleteTrafficTransaction(type, txId) {
    if (!confirm("Are you sure you want to delete this cash transaction?")) return;
    const dateStr = state.activeTrafficDate;
    const record = state.dailyTraffic.find(t => t.id === dateStr);
    if (!record) return;
    
    if (type === 'in') {
        record.moneyInTransactions = (record.moneyInTransactions || []).filter(t => t.id !== txId);
    } else if (type === 'out') {
        record.moneyOutTransactions = (record.moneyOutTransactions || []).filter(t => t.id !== txId);
    }
    
    record.updated_at = new Date().toISOString();
    await saveDocToFirestore(COLLECTIONS.DAILY_TRAFFIC, record);
    
    renderDailyTraffic();
    if (type === 'in') renderMoneyInList();
    else renderMoneyOutList();
}

// Calculate cash flow summary for a given date, including net daily earning carryover from previous dates
function getDailyTrafficSummary(targetDateStr) {
    if (!targetDateStr) targetDateStr = getLocalDateString();
    
    // Gather all unique date strings from state.dailyTraffic plus targetDateStr
    const datesSet = new Set((state.dailyTraffic || []).map(t => t.id));
    datesSet.add(targetDateStr);
    
    // Sort dates chronologically in ascending order
    const sortedDates = Array.from(datesSet).sort();
    
    const targetIdx = sortedDates.indexOf(targetDateStr);
    const datesToProcess = sortedDates.slice(0, targetIdx + 1);
    
    let previousNetEarnings = 0;
    let currentSummary = null;
    
    for (let i = 0; i < datesToProcess.length; i++) {
        const d = datesToProcess[i];
        const record = (state.dailyTraffic || []).find(t => t.id === d);
        
        const organicIn = record ? (record.moneyInTransactions || []).reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0) : 0;
        const totalOut = record ? (record.moneyOutTransactions || []).reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0) : 0;
        const carryover = i > 0 ? previousNetEarnings : 0;
        const totalIn = organicIn + carryover;
        const netEarnings = totalIn - totalOut;
        
        currentSummary = {
            dateStr: d,
            previousDateStr: i > 0 ? datesToProcess[i - 1] : null,
            carryover: carryover,
            organicIn: organicIn,
            totalIn: totalIn,
            totalOut: totalOut,
            netEarnings: netEarnings
        };
        
        previousNetEarnings = netEarnings;
    }
    
    return currentSummary || {
        dateStr: targetDateStr,
        previousDateStr: null,
        carryover: 0,
        organicIn: 0,
        totalIn: 0,
        totalOut: 0,
        netEarnings: 0
    };
}

// Render Daily Traffic stats on the Overview Dashboard
function renderDailyTraffic() {
    if (!state.activeTrafficDate) {
        state.activeTrafficDate = getLocalDateString();
    }
    
    const picker = document.getElementById('traffic-date-picker');
    if (picker && picker.value !== state.activeTrafficDate) {
        picker.value = state.activeTrafficDate;
    }
    
    const summary = getDailyTrafficSummary(state.activeTrafficDate);
    
    const inEl = document.getElementById('today-money-in');
    const outEl = document.getElementById('today-money-out');
    const netEl = document.getElementById('today-net-earnings');
    
    if (inEl) inEl.textContent = `₱${summary.totalIn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (outEl) outEl.textContent = `₱${summary.totalOut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    if (netEl) {
        netEl.textContent = `₱${summary.netEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        if (summary.netEarnings > 0) {
            netEl.style.color = 'var(--success)';
        } else if (summary.netEarnings < 0) {
            netEl.style.color = 'var(--danger)';
        } else {
            netEl.style.color = 'var(--text-secondary)';
        }
    }
}

// Apply custom card colors dynamically by injecting a style tag
function applyCardColors() {
    let styleEl = document.getElementById('dynamic-card-styles');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'dynamic-card-styles';
        document.head.appendChild(styleEl);
    }
    
    const colors = state.cardColors || DEFAULT_CARD_COLORS;
    styleEl.innerHTML = `
        .stat-card {
            background-color: ${colors.statCardBg} !important;
            color: ${colors.cardText} !important;
            border-color: ${colors.cardBorder} !important;
        }
        .content-box {
            background-color: ${colors.contentCardBg} !important;
            color: ${colors.cardText} !important;
            border-color: ${colors.cardBorder} !important;
        }
        .stat-card h3, .content-box h3, .content-box h4, .box-header h3 {
            color: ${colors.cardText} !important;
        }
    `;
}

// Open colors customization modal and sync color pickers
function openColorsModal() {
    const colors = state.cardColors || DEFAULT_CARD_COLORS;
    
    const inputs = {
        'color-stat-bg': colors.statCardBg,
        'color-content-bg': colors.contentCardBg,
        'color-card-text': colors.cardText,
        'color-card-border': colors.cardBorder
    };
    
    Object.entries(inputs).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    });
    
    updateColorsHexPreview();
    openFormModal('modal-card-colors');
}

// Update the hex code label preview on pickers
function updateColorsHexPreview() {
    const fields = ['stat-bg', 'content-bg', 'card-text', 'card-border'];
    fields.forEach(f => {
        const input = document.getElementById(`color-${f}`);
        const label = document.getElementById(`val-${f}`);
        if (input && label) {
            label.textContent = input.value;
        }
    });
}

// Apply selected preset theme colors
function applyColorPreset(presetName) {
    let colors = { ...DEFAULT_CARD_COLORS };
    
    if (presetName === 'cyberpunk') {
        colors = {
            statCardBg: '#2d001e',
            contentCardBg: '#1a0012',
            cardText: '#ffc2eb',
            cardBorder: '#ff007f'
        };
    } else if (presetName === 'forest') {
        colors = {
            statCardBg: '#0f2b1d',
            contentCardBg: '#0b1f15',
            cardText: '#d1fae5',
            cardBorder: '#059669'
        };
    } else if (presetName === 'obsidian') {
        colors = {
            statCardBg: '#0f172a',
            contentCardBg: '#020617',
            cardText: '#f8fafc',
            cardBorder: '#1e293b'
        };
    }
    
    // Update pickers UI
    document.getElementById('color-stat-bg').value = colors.statCardBg;
    document.getElementById('color-content-bg').value = colors.contentCardBg;
    document.getElementById('color-card-text').value = colors.cardText;
    document.getElementById('color-card-border').value = colors.cardBorder;
    
    updateColorsHexPreview();
}

// Save colors to Firestore & Apply
async function saveCardColorsSubmit(e) {
    if (e) e.preventDefault();
    
    const colors = {
        statCardBg: document.getElementById('color-stat-bg').value,
        contentCardBg: document.getElementById('color-content-bg').value,
        cardText: document.getElementById('color-card-text').value,
        cardBorder: document.getElementById('color-card-border').value
    };
    
    state.cardColors = colors;
    applyCardColors();
    
    await saveSettingsDoc('card_colors', colors);
    closeFormModal('modal-card-colors');
}

// Reset colors to default
async function resetCardColors() {
    if (!confirm("Reset colors to classic JMR Slate theme?")) return;
    
    state.cardColors = { ...DEFAULT_CARD_COLORS };
    applyCardColors();
    
    // Update inputs UI
    document.getElementById('color-stat-bg').value = DEFAULT_CARD_COLORS.statCardBg;
    document.getElementById('color-content-bg').value = DEFAULT_CARD_COLORS.contentCardBg;
    document.getElementById('color-card-text').value = DEFAULT_CARD_COLORS.cardText;
    document.getElementById('color-card-border').value = DEFAULT_CARD_COLORS.cardBorder;
    updateColorsHexPreview();
    
    await saveSettingsDoc('card_colors', state.cardColors);
    closeFormModal('modal-card-colors');
}

function getFormattedDateLabel(dateStr) {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const parts = dateStr.split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-US', options);
}

function openMoneyInModal() {
    const dateStr = state.activeTrafficDate || getLocalDateString();
    document.getElementById('money-in-modal-date').textContent = `Date: ${getFormattedDateLabel(dateStr)}`;
    
    // Reset form inputs
    document.getElementById('money-in-note-input').value = '';
    document.getElementById('money-in-amount-input').value = '';
    
    renderMoneyInList();
    openFormModal('modal-money-in');
}

function renderMoneyInList() {
    const dateStr = state.activeTrafficDate || getLocalDateString();
    const record = state.dailyTraffic.find(t => t.id === dateStr);
    const summary = getDailyTrafficSummary(dateStr);
    
    const tbody = document.getElementById('money-in-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const list = record ? (record.moneyInTransactions || []) : [];
    const hasCarryover = summary.previousDateStr !== null && summary.carryover !== 0;
    
    if (list.length === 0 && !hasCarryover) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No money in transactions recorded for this day.</td></tr>`;
        return;
    }
    
    // Previous Day Net Earning Carryover Row
    if (hasCarryover) {
        const carryOverDateLabel = getFormattedDateLabel(summary.previousDateStr);
        const carryColor = summary.carryover >= 0 ? 'var(--success)' : 'var(--danger)';
        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(59, 130, 246, 0.08);">
                <td style="padding: 10px; text-align: left; font-weight: 600; color: var(--accent);">
                    <i class="fa-solid fa-clock-rotate-left" style="margin-right: 6px;"></i>Previous Net Earning Carryover (${carryOverDateLabel})
                    <span style="display: block; font-size: 11px; font-weight: 400; color: var(--text-muted); margin-top: 2px;">Automated cash flow carryover from previous day</span>
                </td>
                <td style="padding: 10px; text-align: right; font-family: monospace; font-weight: 700; color: ${carryColor};">₱${summary.carryover.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td style="padding: 10px; text-align: center;">
                    <span style="font-size: 10px; padding: 2px 6px; background: rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">Auto</span>
                </td>
            </tr>
        `;
    }
    
    list.forEach(tx => {
        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                <td style="padding: 10px; text-align: left; font-weight: 500;">${tx.note}</td>
                <td style="padding: 10px; text-align: right; font-family: monospace; font-weight: 600; color: var(--success);">₱${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style="padding: 10px; text-align: center;">
                    <button type="button" class="btn-icon delete" style="padding: 4px 8px;" onclick="deleteTrafficTransaction('in', '${tx.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

function openMoneyOutModal() {
    const dateStr = state.activeTrafficDate || getLocalDateString();
    document.getElementById('money-out-modal-date').textContent = `Date: ${getFormattedDateLabel(dateStr)}`;
    
    // Reset form inputs
    document.getElementById('money-out-note-input').value = '';
    document.getElementById('money-out-amount-input').value = '';
    
    renderMoneyOutList();
    openFormModal('modal-money-out');
}

function renderMoneyOutList() {
    const dateStr = state.activeTrafficDate || getLocalDateString();
    const record = state.dailyTraffic.find(t => t.id === dateStr);
    const tbody = document.getElementById('money-out-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const list = record ? (record.moneyOutTransactions || []) : [];
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">No expenses recorded for this day.</td></tr>`;
        return;
    }
    
    list.forEach(tx => {
        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                <td style="padding: 10px; text-align: left; font-weight: 500;">${tx.note}</td>
                <td style="padding: 10px; text-align: right; font-family: monospace; font-weight: 600; color: var(--danger);">₱${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style="padding: 10px; text-align: center;">
                    <button type="button" class="btn-icon delete" style="padding: 4px 8px;" onclick="deleteTrafficTransaction('out', '${tx.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

/* ==========================================================================
   NOTIFICATION & AUDIO SYNTHESIS HELPERS
   ========================================================================== */

let hasInitializedListener = false;

// Synthesize a chime notification sound using the Web Audio API
function playNotificationSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Note 1 (D5)
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        
        // Note 2 (A5)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.12); // A5
        gain2.gain.setValueAtTime(0.08, audioCtx.currentTime + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.55);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        
        osc1.start();
        osc1.stop(audioCtx.currentTime + 0.45);
        osc2.start(audioCtx.currentTime + 0.12);
        osc2.stop(audioCtx.currentTime + 0.55);
    } catch (e) {
        console.warn('Web Audio Context chime blocked or failed:', e);
    }
}

// Slide in a beautiful receipt-themed toast notification
function showToastNotification(inq) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast receipt-toast';
    toast.innerHTML = `
        <div class="toast-receipt-header">
            <span class="toast-receipt-title"><i class="fa-solid fa-receipt"></i> NEW INQUIRY</span>
            <span class="toast-receipt-id monospace">${escapeHTML(inq.id)}</span>
        </div>
        <div class="toast-receipt-divider-dash"></div>
        <div class="toast-receipt-body">
            <div class="toast-receipt-row">
                <strong>Name:</strong>
                <span>${escapeHTML(inq.name)}</span>
            </div>
            <div class="toast-receipt-row">
                <strong>Email:</strong>
                <span>${escapeHTML(inq.email || 'N/A')}</span>
            </div>
            <div class="toast-receipt-row">
                <strong>Phone:</strong>
                <span>${escapeHTML(inq.phone)}</span>
            </div>
            <div class="toast-receipt-row">
                <strong>Service:</strong>
                <span class="highlight">${escapeHTML(inq.service)}</span>
            </div>
            <div class="toast-receipt-row message">
                <strong>Message Details:</strong>
                <span>${escapeHTML(inq.message.substring(0, 60))}${inq.message.length > 60 ? '...' : ''}</span>
            </div>
        </div>
        <div class="toast-receipt-divider-dash"></div>
        <div class="toast-receipt-footer">
            <button class="toast-close">Dismiss Receipt</button>
        </div>
    `;

    container.appendChild(toast);

    // Close button event
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
        removeToast(toast);
    });

    // Auto remove after 8 seconds
    setTimeout(() => {
        removeToast(toast);
    }, 8000);
}

function removeToast(toast) {
    toast.classList.add('fade-out');
    toast.addEventListener('transitionend', () => {
        toast.remove();
    });
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Update inquiries sidebar badge count in real-time
function updateInquiriesBadge() {
    const badge = document.getElementById('inquiries-badge');
    if (!badge) return;
    const unreadCount = state.inquiries.filter(i => !i.seen).length;
    if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// Mark all unseen inquiries as read in Firebase
async function markAllInquiriesAsSeen() {
    const unseen = state.inquiries.filter(i => !i.seen);
    if (unseen.length === 0) return;

    const batch = db.batch();
    unseen.forEach(i => {
        i.seen = true;
        const ref = db.collection(COLLECTIONS.INQUIRIES).doc(i.id);
        batch.update(ref, { seen: true });
    });

    try {
        await batch.commit();
        updateInquiriesBadge();
    } catch (e) {
        console.error("Failed to mark inquiries as seen in Firestore:", e);
    }
}

// Legacy localStorage helper (kept for admin session only)
function safeGetJSON(key, defaultVal) {
    try {
        const item = localStorage.getItem(key);
        if (!item || item === 'undefined') return defaultVal;
        return JSON.parse(item);
    } catch (e) {
        console.warn(`Error parsing key "${key}" from localStorage:`, e);
        return defaultVal;
    }
}

/* ==========================================================================
   STATE MANAGEMENT & INITIAL DATA
   ========================================================================== */

// localStorage keys (only used for admin session state, not data)
const STORAGE_KEYS = {
    IS_ADMIN: 'jmr_is_admin',
    ACTIVE_TAB: 'jmr_active_tab'
};

// Initial Mock Data (used if LocalStorage is empty)
const DEFAULT_CUSTOMERS = [
    { id: 'CUST-001', name: 'Antonio Cruz', phone: '09171234567', email: 'antonio@gmail.com', status: 'Active', date: '2026-06-15', projectType: 'Sidecar', totalAmount: 38000, downpayment: 15000, buildStatus: 'On Process' },
    { id: 'CUST-002', name: 'Maria Santos', phone: '09229876543', email: 'maria.s@yahoo.com', status: 'Active', date: '2026-06-20', projectType: 'Sidecar', totalAmount: 45000, downpayment: 45000, buildStatus: 'Released' },
    { id: 'CUST-003', name: 'Robert Lim', phone: '09085551234', email: 'robert.lim@outlook.com', status: 'Inactive', date: '2026-05-10', projectType: 'Sidecar', totalAmount: 32000, downpayment: 10000, buildStatus: 'Pending' },
    { id: 'CUST-004', name: 'Juan Dela Cruz', phone: '09457778899', email: 'juan.dc@gmail.com', status: 'Active', date: '2026-07-02', projectType: 'Sidecar', totalAmount: 32000, downpayment: 15000, buildStatus: 'On Process' }
];

const DEFAULT_WELDERS = [
    {
        id: 'WELDER-001',
        name: 'Dante Rivera',
        spec: 'TIG Specialist / Stainless',
        status: 'Unpaid',
        jobs: [
            { id: 'JOB-001', desc: 'Chassis Tube Welding - BLD-001', date: '2026-06-20', amount: 3000, status: 'Unpaid' },
            { id: 'JOB-002', desc: 'Side Carrier Bracket Attachment', date: '2026-06-24', amount: 1200, status: 'Unpaid' }
        ]
    },
    {
        id: 'WELDER-002',
        name: 'Ramon Castro',
        spec: 'MIG Expert / Structural Frames',
        status: 'Unpaid',
        jobs: [
            { id: 'JOB-003', desc: 'Cargo Flatbed Frame Fabrication - BLD-002', date: '2026-07-02', amount: 4500, status: 'Unpaid' }
        ]
    },
    {
        id: 'WELDER-003',
        name: 'Joseph Pineda',
        spec: 'Chassis Alignment & Arc Welder',
        status: 'Paid',
        jobs: [
            { id: 'JOB-004', desc: 'Honda TMX alignment adjustment - REP-001', date: '2026-07-08', amount: 1920, status: 'Paid' }
        ]
    }
];

const DEFAULT_BUILDS = [
    {
        id: 'BLD-001',
        customerId: 'CUST-001',
        customerName: 'Antonio Cruz',
        welderId: 'WELDER-002',
        welderName: 'Ramon Castro',
        specs: 'Semi-Stainless Passenger Sidecar, 14" Mag Wheels, Custom Leatherette Cushions, Orange Trim',
        progress: 75,
        cost: 38000,
        start: '2026-06-18',
        target: '2026-07-15',
        image: '' // Base64 or empty
    },
    {
        id: 'BLD-002',
        customerId: 'CUST-004',
        customerName: 'Juan Dela Cruz',
        welderId: 'WELDER-001',
        welderName: 'Dante Rivera',
        specs: 'Heavy Duty Cargo/Utility Sidecar, Reinforced Double-Frame, Flatbed Base',
        progress: 40,
        cost: 32000,
        start: '2026-07-01',
        target: '2026-07-25',
        image: ''
    },
    {
        id: 'BLD-003',
        customerId: 'CUST-002',
        customerName: 'Maria Santos',
        welderId: 'WELDER-002',
        welderName: 'Ramon Castro',
        specs: 'Classic Rounded Nose Passenger Sidecar, Matte Black, Chrome Bumpers, Soft suspension',
        progress: 100,
        cost: 45000,
        start: '2026-05-12',
        target: '2026-06-10',
        released: '2026-06-10',
        image: ''
    }
];

const DEFAULT_REPAIRS = [
    { id: 'REP-001', customerId: 'CUST-002', customerName: 'Maria Santos', welderId: 'WELDER-003', welderName: 'Joseph Pineda', item: 'Honda TMX Sidecar Alignment', issue: 'Hit a deep pothole, sidecar pulling left, needs stabilizer adjustment and frame straightening.', status: 'In Progress', cost: 3500 },
    { id: 'REP-002', customerId: 'CUST-003', customerName: 'Robert Lim', welderId: 'WELDER-003', welderName: 'Joseph Pineda', item: 'Kawasaki Barako Attachment Brackets', issue: 'Cracked mounting plates at the engine bolt support points. Needs plate reinforcement and re-welding.', status: 'Completed', cost: 2200 }
];

const DEFAULT_WELDING_JOBS = [
    { id: 'WLD-001', customerId: 'CUST-001', customerName: 'Antonio Cruz', welderId: 'WELDER-001', welderName: 'Dante Rivera', desc: 'Custom Stainless Steel Handlebars & Side Rail Welding', material: 'Stainless Steel 316', date: '2026-06-25', cost: 4500 },
    { id: 'WLD-002', customerId: 'CUST-004', customerName: 'Juan Dela Cruz', welderId: 'WELDER-002', welderName: 'Ramon Castro', desc: 'Steel Muffler Bracket Fabrication & Attachment', material: 'Mild Steel', date: '2026-07-05', cost: 1800 }
];

const DEFAULT_GALLERY = [
    {
        id: 'GAL-001',
        title: 'Premium Tricycle Sidecar',
        category: 'Custom Sidecar',
        desc: 'Heavy-duty passenger sidecar featuring glossy paints and comfort cushioning.',
        image: 'sidecar_classic.png'
    },
    {
        id: 'GAL-002',
        title: 'Stainless Steel Rail Alignment',
        category: 'Welding Job',
        desc: 'Precise TIG welding attachments designed for passenger safety and long lifespan.',
        image: 'sidecar_welding.png'
    },
    {
        id: 'GAL-003',
        title: 'Chassis Reinforcement',
        category: 'Repairs & Rebuild',
        desc: 'Structural repairs and bracket re-welding on heavy motorcycle frame hitches.',
        image: 'sidecar_cargo.png'
    }
];

const DEFAULT_INQUIRIES = [
    { id: 'INQ-001', name: 'Kardo Dalisay', phone: '09187654321', service: 'Custom Build', message: 'Inquiring about price for a heavy cargo sidecar with flatbed layout.', date: '2026-07-08', seen: true },
    { id: 'INQ-002', name: 'Nora Aunor', phone: '09071112222', service: 'Repair / Alignment', message: 'My sidecar is pulling to the right, can you align the structural hitches?', date: '2026-07-10', seen: true }
];

const DEFAULT_CONTACT_INFO = {
    phone: '+63 912 345 6789',
    address: 'JMR Side Car Shop, National Highway, Philippines',
    email: 'contact@jmrsidecar.com'
};

// App State
let state = {
    customers: [],
    builds: [],
    repairs: [],
    weldingJobs: [],
    welders: [],
    gallery: [],
    inquiries: [],
    contactInfo: null,
    vales: [],
    payrolls: [],
    materials: [],
    materialCategories: [],
    materialsCurrentPage: 1,
    currentUserRole: null,
    currentUserStatus: null,
    productCategories: [],
    productTemplates: [],
    productVariants: [],
    productVariantMaterials: [],
    templatesCurrentPage: 1,
    activeTemplateId: null,
    dailyTraffic: [],
    activeTrafficDate: null,
    cardColors: {
        statCardBg: '#1f2833',
        contentCardBg: '#1f2833',
        cardText: '#f5f6f7',
        cardBorder: '#334155'
    }
};

const DEFAULT_CARD_COLORS = {
    statCardBg: '#1f2833',
    contentCardBg: '#1f2833',
    cardText: '#f5f6f7',
    cardBorder: '#334155'
};

// Initialize State
// Initialize state from Firestore (async)
// Initialize state from Firestore (async)
async function initStore() {
    try {
        // Load all collections from Firestore in parallel (except inquiries, which uses real-time listener)
        const [
            customers, welders, builds, repairs, weldingJobs, gallery, contactInfo, vales, payrolls, materials, materialCategories,
            productCategories, productTemplates, productVariants, productVariantMaterials, dailyTraffic, cardColors
        ] = await Promise.all([
            loadCollectionFromFirestore(COLLECTIONS.CUSTOMERS),
            loadCollectionFromFirestore(COLLECTIONS.WELDERS),
            loadCollectionFromFirestore(COLLECTIONS.BUILDS),
            loadCollectionFromFirestore(COLLECTIONS.REPAIRS),
            loadCollectionFromFirestore(COLLECTIONS.WELDING_JOBS),
            loadCollectionFromFirestore(COLLECTIONS.GALLERY),
            loadSettingsDoc('contactInfo'),
            loadCollectionFromFirestore(COLLECTIONS.VALES),
            loadCollectionFromFirestore(COLLECTIONS.PAYROLLS),
            loadCollectionFromFirestore(COLLECTIONS.MATERIALS),
            loadCollectionFromFirestore(COLLECTIONS.MATERIAL_CATEGORIES),
            loadCollectionFromFirestore(COLLECTIONS.PRODUCT_CATEGORIES),
            loadCollectionFromFirestore(COLLECTIONS.PRODUCT_TEMPLATES),
            loadCollectionFromFirestore(COLLECTIONS.PRODUCT_VARIANTS),
            loadCollectionFromFirestore(COLLECTIONS.PRODUCT_VARIANT_MATERIALS),
            loadCollectionFromFirestore(COLLECTIONS.DAILY_TRAFFIC),
            loadSettingsDoc('card_colors')
        ]);

        // Use Firestore data
        state.customers = customers;
        state.welders = welders;
        state.builds = builds;
        state.repairs = repairs;
        state.weldingJobs = weldingJobs;
        state.gallery = gallery;
        state.contactInfo = contactInfo || DEFAULT_CONTACT_INFO;
        state.vales = vales || [];
        state.payrolls = payrolls || [];
        state.materials = materials || [];
        state.materialCategories = materialCategories || [];
        state.productCategories = productCategories || [];
        state.productTemplates = productTemplates || [];
        state.productVariants = productVariants || [];
        state.productVariantMaterials = productVariantMaterials || [];
        state.dailyTraffic = dailyTraffic || [];
        state.cardColors = cardColors || { ...DEFAULT_CARD_COLORS };
        
        applyCardColors();

        // Bootstrap materialCategories if empty
        if (state.materialCategories.length === 0) {
            const defaultCategories = [
                { id: 'cat-steel', name: 'Steel', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-stainless', name: 'Stainless Steel', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-accessories', name: 'Accessories', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-electrical', name: 'Electrical', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-paint', name: 'Paint', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-hardware', name: 'Hardware', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-fasteners', name: 'Fasteners', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-tires', name: 'Tires', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'cat-misc', name: 'Miscellaneous', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ];
            state.materialCategories = defaultCategories;
            await saveCollectionToFirestore(COLLECTIONS.MATERIAL_CATEGORIES, defaultCategories);
        }

        // Bootstrap productCategories if empty
        if (state.productCategories.length === 0) {
            const defaultProdCats = [
                { id: 'pcat-sidecar', name: 'Sidecar Templates', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'pcat-trailer', name: 'Trailers', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'pcat-cart', name: 'Utility Carts', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'pcat-parts', name: 'Spare Parts', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ];
            state.productCategories = defaultProdCats;
            await saveCollectionToFirestore(COLLECTIONS.PRODUCT_CATEGORIES, defaultProdCats);
        }

        // Bootstrap materials if empty
        if (state.materials.length === 0) {
            const defaultMaterials = [
                { id: 'mat-steel-15', name: 'Steel Tube 1.5in', categoryId: 'cat-steel', unit: 'pcs', isActive: true, description: 'High grade structural steel pipe', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'mat-steel-flat', name: 'Flat Bar 2in', categoryId: 'cat-steel', unit: 'pcs', isActive: true, description: 'Structural steel support bar', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'mat-stainless-sheet', name: 'Stainless Sheet 1.2mm', categoryId: 'cat-stainless', unit: 'sheet', isActive: true, description: 'Stainless steel sheet grade 304', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'mat-windshield', name: 'Windshield Classic', categoryId: 'cat-accessories', unit: 'pcs', isActive: true, description: 'Clear impact resistant windshield', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'mat-wheel', name: '14-inch Alloy Wheel', categoryId: 'cat-accessories', unit: 'pcs', isActive: true, description: 'Sidecar wheel rim assembly', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'mat-bolts', name: 'Chassis Mounting Bolts', categoryId: 'cat-hardware', unit: 'pcs', isActive: true, description: 'High tensile mounting hex bolts', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'mat-paint', name: 'Polyurethane Paint Clear', categoryId: 'cat-paint', unit: 'liter', isActive: true, description: 'Premium glossy clear coating', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ];
            state.materials = defaultMaterials;
            await saveCollectionToFirestore(COLLECTIONS.MATERIALS, defaultMaterials);
        }

        // Bootstrap productTemplates, variants and BOMs if empty
        if (state.productTemplates.length === 0) {
            const defaultTemplates = [
                { id: 'tmpl-tamiya', name: 'Tamiya Type Sidecar', categoryId: 'pcat-sidecar', description: 'Standard semi-stainless sidecar with windshield and folding carrier.', imageUrl: 'sidecar_classic.png', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'tmpl-flatbed', name: 'Cargo Flatbed Sidecar', categoryId: 'pcat-sidecar', description: 'Heavy-duty cargo flatbed frame sidecar for commercial transport.', imageUrl: 'sidecar_cargo.png', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'tmpl-utility', name: 'Welded Utility Carrier', categoryId: 'pcat-sidecar', description: 'Precision TIG welded utility metal rack carrier for industrial applications.', imageUrl: 'sidecar_welding.png', isActive: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ];
            state.productTemplates = defaultTemplates;
            await saveCollectionToFirestore(COLLECTIONS.PRODUCT_TEMPLATES, defaultTemplates);
            
            const defaultVariants = [
                // Tamiya variants
                { id: 'var-tamiya-ss', templateId: 'tmpl-tamiya', name: 'Semi Stainless', code: 'TAM-SS', materialType: 'Semi Stainless', sellingPrice: 18500, isDefault: true, isActive: true, version: '1.0', revisionNumber: 0, effectiveDate: new Date().toISOString(), changeLog: 'Initial release of Semi Stainless variant.', estimatedLaborHours: 16, length: '120cm', width: '80cm', height: '100cm', weight: '45kg', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'var-tamiya-fs', templateId: 'tmpl-tamiya', name: 'Full Stainless', code: 'TAM-FS', materialType: 'Full Stainless', sellingPrice: 24500, isDefault: false, isActive: true, version: '1.0', revisionNumber: 0, effectiveDate: new Date().toISOString(), changeLog: 'Initial release of Full Stainless variant.', estimatedLaborHours: 18, length: '120cm', width: '80cm', height: '100cm', weight: '48kg', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                // Flatbed variants
                { id: 'var-flatbed-galv', templateId: 'tmpl-flatbed', name: 'Galvanized Cargo', code: 'FLT-GALV', materialType: 'Galvanized Steel', sellingPrice: 15500, isDefault: true, isActive: true, version: '1.0', revisionNumber: 0, effectiveDate: new Date().toISOString(), changeLog: 'Initial release of Galvanized Flatbed variant.', estimatedLaborHours: 14, length: '140cm', width: '90cm', height: '40cm', weight: '55kg', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                // Utility variants
                { id: 'var-utility-steel', templateId: 'tmpl-utility', name: 'Standard Steel', code: 'UTL-ST', materialType: 'Carbon Steel', sellingPrice: 12000, isDefault: true, isActive: true, version: '1.0', revisionNumber: 0, effectiveDate: new Date().toISOString(), changeLog: 'Initial release of Utility steel variant.', estimatedLaborHours: 12, length: '110cm', width: '70cm', height: '80cm', weight: '38kg', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ];
            state.productVariants = defaultVariants;
            await saveCollectionToFirestore(COLLECTIONS.PRODUCT_VARIANTS, defaultVariants);
            
            const defaultBoms = [
                // Tamiya Semi Stainless BOM
                { id: 'bom-1', variantId: 'var-tamiya-ss', materialId: 'mat-steel-15', quantity: 12, remarks: 'Main chassis tube frame', sortOrder: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-2', variantId: 'var-tamiya-ss', materialId: 'mat-steel-flat', quantity: 6, remarks: 'Cross beams support', sortOrder: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-3', variantId: 'var-tamiya-ss', materialId: 'mat-stainless-sheet', quantity: 2, remarks: 'Outer body cladding', sortOrder: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-4', variantId: 'var-tamiya-ss', materialId: 'mat-windshield', quantity: 1, remarks: 'Front wind deflector', sortOrder: 4, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-5', variantId: 'var-tamiya-ss', materialId: 'mat-wheel', quantity: 1, remarks: 'Side wheel and suspension hub', sortOrder: 5, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-6', variantId: 'var-tamiya-ss', materialId: 'mat-bolts', quantity: 20, remarks: 'Mounting assembly hex bolts', sortOrder: 6, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-7', variantId: 'var-tamiya-ss', materialId: 'mat-paint', quantity: 2, remarks: 'Chassis clear gloss coat', sortOrder: 7, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                // Tamiya Full Stainless BOM
                { id: 'bom-8', variantId: 'var-tamiya-fs', materialId: 'mat-steel-15', quantity: 12, remarks: 'Stainless main tube frame', sortOrder: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-9', variantId: 'var-tamiya-fs', materialId: 'mat-stainless-sheet', quantity: 4, remarks: 'Full body panels cladding', sortOrder: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-10', variantId: 'var-tamiya-fs', materialId: 'mat-windshield', quantity: 1, remarks: 'Front wind deflector', sortOrder: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                { id: 'bom-11', variantId: 'var-tamiya-fs', materialId: 'mat-wheel', quantity: 1, remarks: 'Side wheel assembly', sortOrder: 4, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            ];
            state.productVariantMaterials = defaultBoms;
            await saveCollectionToFirestore(COLLECTIONS.PRODUCT_VARIANT_MATERIALS, defaultBoms);
        }



        // Register Real-time Listener for Inquiries
        db.collection(COLLECTIONS.INQUIRIES).onSnapshot(snapshot => {
            const list = [];
            snapshot.forEach(doc => {
                list.push(doc.data());
            });

            // Trigger notification sound and banner for new, unread inquiries
            if (hasInitializedListener) {
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        const inq = change.doc.data();
                        // Only notify if it was not seen and not already loaded in local state
                        const existsLocal = state.inquiries.some(x => x.id === inq.id);
                        if (!inq.seen && !existsLocal) {
                            playNotificationSound();
                            showToastNotification(inq);
                        }
                    }
                });
            }

            state.inquiries = list;
            hasInitializedListener = true;

            // Update badge UI
            updateInquiriesBadge();

            // Re-render table if on inquiries tab
            if (activeTab === 'tab-inquiries') {
                renderInquiriesTable();
            }
        });

        // Seeding database if totally empty
        if (customers.length === 0 && welders.length === 0 && builds.length === 0) {
            console.log('Firestore is empty — seeding with default data...');
            state.customers = DEFAULT_CUSTOMERS;
            state.welders = DEFAULT_WELDERS;
            state.builds = DEFAULT_BUILDS;
            state.repairs = DEFAULT_REPAIRS;
            state.weldingJobs = DEFAULT_WELDING_JOBS;
            state.gallery = DEFAULT_GALLERY;
            state.inquiries = DEFAULT_INQUIRIES;
            state.contactInfo = DEFAULT_CONTACT_INFO;

            await Promise.all([
                saveCollectionToFirestore(COLLECTIONS.CUSTOMERS, state.customers),
                saveCollectionToFirestore(COLLECTIONS.WELDERS, state.welders),
                saveCollectionToFirestore(COLLECTIONS.BUILDS, state.builds),
                saveCollectionToFirestore(COLLECTIONS.REPAIRS, state.repairs),
                saveCollectionToFirestore(COLLECTIONS.WELDING_JOBS, state.weldingJobs),
                saveCollectionToFirestore(COLLECTIONS.GALLERY, state.gallery),
                saveCollectionToFirestore(COLLECTIONS.INQUIRIES, state.inquiries),
                saveSettingsDoc('contactInfo', state.contactInfo)
            ]);
            console.log('Default data seeded to Firestore successfully.');
        }
    } catch (e) {
        console.error('Failed to load from Firestore, falling back to defaults:', e);
        state.customers = DEFAULT_CUSTOMERS;
        state.welders = DEFAULT_WELDERS;
        state.builds = DEFAULT_BUILDS;
        state.repairs = DEFAULT_REPAIRS;
        state.weldingJobs = DEFAULT_WELDING_JOBS;
        state.gallery = DEFAULT_GALLERY;
        state.inquiries = DEFAULT_INQUIRIES;
        state.contactInfo = DEFAULT_CONTACT_INFO;
        state.cardColors = { ...DEFAULT_CARD_COLORS };
        applyCardColors();
    }

    renderShopContactInfo();
}

function renderShopContactInfo() {
    const contact = state.contactInfo;
    if (!contact) return;

    // Visitor view labels
    const displayPhone = document.getElementById('display-contact-phone');
    const displayAddress = document.getElementById('display-contact-address');
    const displayEmail = document.getElementById('display-contact-email');

    if (displayPhone) displayPhone.textContent = contact.phone;
    if (displayAddress) displayAddress.textContent = contact.address;
    if (displayEmail) displayEmail.textContent = contact.email;

    // Admin settings input fields
    const phoneInput = document.getElementById('contact-phone-input');
    const emailInput = document.getElementById('contact-email-input');
    const addressInput = document.getElementById('contact-address-input');

    if (phoneInput) phoneInput.value = contact.phone;
    if (emailInput) emailInput.value = contact.email;
    if (addressInput) addressInput.value = contact.address;
}

function saveAllToStorage() {
    saveCollectionToFirestore(COLLECTIONS.CUSTOMERS, state.customers);
    saveCollectionToFirestore(COLLECTIONS.WELDERS, state.welders);
    saveCollectionToFirestore(COLLECTIONS.BUILDS, state.builds);
    saveCollectionToFirestore(COLLECTIONS.REPAIRS, state.repairs);
    saveCollectionToFirestore(COLLECTIONS.WELDING_JOBS, state.weldingJobs);
    saveCollectionToFirestore(COLLECTIONS.GALLERY, state.gallery);
    saveCollectionToFirestore(COLLECTIONS.INQUIRIES, state.inquiries);
    if (state.contactInfo) {
        saveSettingsDoc('contactInfo', state.contactInfo);
    }
}


/* ==========================================================================
   NAVIGATION & LOGIN LOGIC
   ========================================================================== */

// Variables assigned in DOMContentLoaded
let visitorView, adminDashboardView, adminLoginModal, mainNav;

function enterAdminDashboard() {
    visitorView.classList.add('hidden');
    mainNav.classList.add('hidden');
    adminDashboardView.classList.remove('hidden');
    localStorage.setItem(STORAGE_KEYS.IS_ADMIN, 'true');
    const savedTab = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || 'tab-overview';
    switchDashboardTab(savedTab);
    renderAllDashboardData();
    renderAuthorizedEmails();
}

function exitAdminDashboard() {
    adminDashboardView.classList.add('hidden');
    visitorView.classList.remove('hidden');
    mainNav.classList.remove('hidden');
    localStorage.removeItem(STORAGE_KEYS.IS_ADMIN);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_TAB);
    state.currentUserRole = null;
    state.currentUserStatus = null;
}


/* ==========================================================================
   TAB SWITCHING LOGIC
   ========================================================================== */

let activeTab = 'tab-overview';
let currentTabTitle, currentTabDesc, btnQuickAdd;



function switchDashboardTab(tabId) {
    activeTab = tabId;

    // Save active tab state if admin is logged in
    if (localStorage.getItem(STORAGE_KEYS.IS_ADMIN) === 'true') {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tabId);
    }

    // Update active button state
    document.querySelectorAll('.nav-tab-btn').forEach(b => {
        if (b.getAttribute('data-tab') === tabId) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });

    // Update visibility of panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === tabId) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // Adjust Quick Add button and header text
    if (tabId === 'tab-overview') {
        currentTabTitle.textContent = "Overview Dashboard";
        currentTabDesc.textContent = "Summary of active shop fabrication projects and operations.";
        btnQuickAdd.style.display = 'none';
        setTimeout(renderDailyTraffic, 50);
    } else {
        btnQuickAdd.style.display = 'inline-flex';

        switch (tabId) {
            case 'tab-customers':
                currentTabTitle.textContent = "Customers Directory";
                currentTabDesc.textContent = "Manage client contact details and order histories.";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-user-plus"></i> Add Customer`;
                break;
            case 'tab-builds':
                currentTabTitle.textContent = "On-Process Sidecar Builds";
                currentTabDesc.textContent = "Monitor fabrication specifications and progression charts.";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-hammer"></i> Add Build`;
                break;
            case 'tab-past-builds':
                currentTabTitle.textContent = "Past Builds Archive";
                currentTabDesc.textContent = "View and manage completed and released sidecar fabrication projects.";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-hammer"></i> Add Past Build`;
                break;
            case 'tab-repairs':
                currentTabTitle.textContent = "Repair Jobs Log";
                currentTabDesc.textContent = "Track troubleshooting, welding fixes, and alignment adjustments.";
                btnQuickAdd.style.display = 'none';
                break;
            case 'tab-welding':
                currentTabTitle.textContent = "Welding Projects Log";
                currentTabDesc.textContent = "Registry of dedicated independent welding and fabrication jobs.";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-fire"></i> Add Welding Job`;
                break;
            case 'tab-welders':
                currentTabTitle.textContent = "Weekly Payroll & Cash Advances";
                currentTabDesc.textContent = "Process weekly fabricator payroll, manage cash advances, and review logs.";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-user-plus"></i> Add Employee`;
                // Trigger active subtab rendering
                const activeSubTab = document.querySelector('.sub-tab-btn.active');
                if (activeSubTab) {
                    const target = activeSubTab.getAttribute('data-subtab');
                    if (target === 'subtab-weekly-payroll') renderWeeklyPayroll();
                    else if (target === 'subtab-cash-advances') renderVales();
                    else if (target === 'subtab-payroll-history') renderPayrollHistory();
                    else if (target === 'subtab-employee-ledger') renderEmployeeLedger();
                    else if (target === 'subtab-manage-employees') renderWeldersTable();
                } else {
                    renderWeeklyPayroll();
                }
                break;
            case 'tab-gallery':
                currentTabTitle.textContent = "Manage Shop Gallery";
                currentTabDesc.textContent = "Manage custom projects and builds showcased to public visitors.";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-image"></i> Add Gallery Item`;
                break;
            case 'tab-materials':
                currentTabTitle.textContent = "Materials Registry";
                currentTabDesc.textContent = "Manage materials catalog and settings for sidecar fabrication.";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-box-open"></i> Add Material`;
                renderMaterialsTable();
                break;
            case 'tab-templates':
                currentTabTitle.textContent = "Sidecar Templates & BOMs";
                currentTabDesc.textContent = "Manage sidecar designs, product variants, and Bills of Materials (BOM).";
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-folder-plus"></i> Add Template`;
                populateTemplatesCategoryFilter();
                renderTemplatesGrid();
                break;
            case 'tab-inquiries':
                currentTabTitle.textContent = "Message Inquiries & Shop Settings";
                currentTabDesc.textContent = "Review messages submitted by visitors and manage business contact details.";
                btnQuickAdd.style.display = 'none';
                markAllInquiriesAsSeen();
                break;
        }
    }
}


/* ==========================================================================
   MODAL DIALOG / FORM POPUPS
   ========================================================================== */

// Base64 storage helper
let currentUploadedImageBase64 = '';
let buildImagePreview, galleryImagePreview;

function populateMaterialCategoriesDropdown() {
    const categorySelect = document.getElementById('material-category');
    if (categorySelect) {
        categorySelect.innerHTML = '<option value="" disabled selected>Select Category</option>';
        const activeCategories = state.materialCategories.filter(cat => cat.isActive);
        activeCategories.forEach(cat => {
            categorySelect.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
        });
    }
}

function populateTemplateCategoriesDropdown() {
    const catSelect = document.getElementById('template-category');
    if (catSelect) {
        catSelect.innerHTML = '<option value="" disabled selected>Select Category</option>';
        const activeCats = state.productCategories.filter(cat => cat.isActive);
        activeCats.forEach(cat => {
            catSelect.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
        });
    }
}

// Open Form Modals
function openFormModal(modalId, editId = null) {
    const modal = document.getElementById(modalId);
    modal.classList.add('active');

    // Setup autocompletion datalists
    populateDatalists();

    if (modalId === 'modal-material') {
        populateMaterialCategoriesDropdown();
    }

    if (modalId === 'modal-template') {
        populateTemplateCategoriesDropdown();
    }

    // If editId is provided, pre-populate inputs. Otherwise reset.
    if (editId) {
        setupFormEdit(modalId, editId);
    } else {
        setupFormAdd(modalId);
    }
}

// Close Modals
function closeFormModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.remove('active');
    currentUploadedImageBase64 = '';
}

// Populates autocomplete options for datalists dynamically
function populateDatalists() {
    const custDatalist = document.getElementById('customers-list');
    const welderDatalist = document.getElementById('welders-list');

    if (custDatalist) {
        custDatalist.innerHTML = '';
        state.customers.forEach(cust => {
            custDatalist.innerHTML += `<option value="${cust.name}"></option>`;
        });
    }

    if (welderDatalist) {
        welderDatalist.innerHTML = '';
        state.welders.forEach(w => {
            welderDatalist.innerHTML += `<option value="${w.name}"></option>`;
        });
    }
}

// Helper to match customer by name or register a new one
function resolveCustomer(nameInput) {
    const trimmed = nameInput.trim();
    if (!trimmed) return { id: '', name: 'Unknown' };

    const existing = state.customers.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return { id: existing.id, name: existing.name };

    // Register new customer dynamically
    const newId = generateUID('CUST', state.customers);
    const newCust = {
        id: newId,
        name: trimmed,
        phone: 'N/A',
        email: 'N/A',
        status: 'Active',
        date: new Date().toISOString().split('T')[0]
    };
    state.customers.push(newCust);
    saveDocToFirestore(COLLECTIONS.CUSTOMERS, newCust);
    return { id: newId, name: trimmed };
}

// Helper to match welder by name or register a new one
function resolveWelder(nameInput) {
    const trimmed = nameInput.trim();
    if (!trimmed) return { id: '', name: 'Unassigned' };

    const existing = state.welders.find(w => w.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return { id: existing.id, name: existing.name };

    // Register new welder dynamically
    const newId = generateUID('WELDER', state.welders);
    const newWelder = {
        id: newId,
        name: trimmed,
        spec: 'General Welder',
        rate: 80,
        hours: 0,
        status: 'Unpaid'
    };
    state.welders.push(newWelder);
    saveDocToFirestore(COLLECTIONS.WELDERS, newWelder);
    return { id: newId, name: trimmed };
}

// Helper to update live payment calculation box in customer modal
function updateCustomerPaymentSummary() {
    const totalEl = document.getElementById('cust-total-amount');
    const downEl = document.getElementById('cust-downpayment');
    const partialEl = document.getElementById('cust-partial-payment');
    
    const totalPaidEl = document.getElementById('cust-summary-total-paid');
    const balanceEl = document.getElementById('cust-summary-balance');
    
    if (!totalEl || !downEl || !partialEl || !totalPaidEl || !balanceEl) return;
    
    const total = parseFloat(totalEl.value) || 0;
    const down = parseFloat(downEl.value) || 0;
    const partial = parseFloat(partialEl.value) || 0;
    
    const totalPaid = down + partial;
    const balance = Math.max(0, total - totalPaid);
    
    totalPaidEl.textContent = `₱${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    balanceEl.textContent = `₱${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    if (balance <= 0 && total > 0) {
        balanceEl.style.color = 'var(--success)';
    } else {
        balanceEl.style.color = 'var(--warning)';
    }
}

// Form state resets for addition
function setupFormAdd(modalId) {
    currentUploadedImageBase64 = '';

    if (modalId === 'modal-customer') {
        document.getElementById('modal-customer-title').textContent = 'Add Customer';
        document.getElementById('form-customer').reset();
        document.getElementById('cust-id').value = '';
        document.getElementById('cust-desc').value = '';
        const partialInput = document.getElementById('cust-partial-payment');
        if (partialInput) partialInput.value = '';
        updateCustomerPaymentSummary();
    }
    else if (modalId === 'modal-build') {
        document.getElementById('modal-build-title').textContent = activeTab === 'tab-past-builds' ? 'Add Past Build' : 'Add On-Process Build';
        document.getElementById('form-build').reset();
        document.getElementById('build-id').value = '';
        buildImagePreview.innerHTML = `<i class="fa-regular fa-image"></i><p>No image chosen</p>`;

        // Auto-fill dates with current and + 30 days
        const startInput = document.getElementById('build-start');
        const targetInput = document.getElementById('build-target');
        const today = new Date();
        const nextMonth = new Date();
        nextMonth.setDate(today.getDate() + 30);

        startInput.value = today.toISOString().split('T')[0];
        targetInput.value = nextMonth.toISOString().split('T')[0];

        // Default progress
        const isPastBuild = activeTab === 'tab-past-builds';
        document.getElementById('build-progress').value = isPastBuild ? '100' : '0';

        // Toggle Released Date input field based on activeTab
        const releasedGroup = document.getElementById('build-released-group');
        const releasedInput = document.getElementById('build-released');
        if (isPastBuild) {
            releasedGroup.style.display = 'flex';
            releasedInput.setAttribute('required', 'required');
            releasedInput.value = today.toISOString().split('T')[0];
        } else {
            releasedGroup.style.display = 'none';
            releasedInput.removeAttribute('required');
            releasedInput.value = '';
        }
    }
    else if (modalId === 'modal-repair') {
        document.getElementById('modal-repair-title').textContent = 'Add Repair Job';
        document.getElementById('form-repair').reset();
        document.getElementById('repair-id').value = '';
    }
    else if (modalId === 'modal-welding') {
        document.getElementById('modal-welding-title').textContent = 'Add Welding Job';
        document.getElementById('form-welding').reset();
        document.getElementById('welding-id').value = '';
        document.getElementById('welding-date').value = new Date().toISOString().split('T')[0];
    }
    else if (modalId === 'modal-welder') {
        document.getElementById('modal-welder-title').textContent = 'Add Welder';
        document.getElementById('form-welder').reset();
        document.getElementById('welder-id').value = '';
    }
    else if (modalId === 'modal-gallery') {
        document.getElementById('modal-gallery-title').textContent = 'Add Gallery Item';
        document.getElementById('form-gallery').reset();
        document.getElementById('gallery-id').value = '';
        galleryImagePreview.innerHTML = `<i class="fa-regular fa-image"></i><p>No image chosen</p>`;
    }
    else if (modalId === 'modal-material') {
        document.getElementById('modal-material-title').textContent = 'Add Material';
        document.getElementById('form-material').reset();
        document.getElementById('material-id').value = '';
    }
    else if (modalId === 'modal-template') {
        document.getElementById('modal-template-title').textContent = 'Add Product Template';
        document.getElementById('form-template').reset();
        document.getElementById('template-id').value = '';
        document.getElementById('template-image-url').value = '';
        document.getElementById('template-image-preview').innerHTML = `<i class="fa-regular fa-image" style="font-size: 24px; color: var(--text-muted);"></i><p style="margin-left: 8px; font-size: 13px; color: var(--text-muted);">No image chosen</p>`;
    }
}

// Pre-fill form inputs during edit triggers
function setupFormEdit(modalId, id) {
    if (modalId === 'modal-customer') {
        const item = state.customers.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-customer-title').textContent = 'Edit Customer';
        document.getElementById('cust-id').value = item.id;
        document.getElementById('cust-name').value = item.name;
        document.getElementById('cust-phone').value = item.phone;
        document.getElementById('cust-email').value = item.email;
        document.getElementById('cust-desc').value = item.description || '';
        document.getElementById('cust-status').value = item.status;
        document.getElementById('cust-total-amount').value = item.totalAmount || '';
        document.getElementById('cust-downpayment').value = item.downpayment || '';
        const partialInput = document.getElementById('cust-partial-payment');
        if (partialInput) partialInput.value = item.partialPayment || '';
        updateCustomerPaymentSummary();
    }
    else if (modalId === 'modal-build') {
        const item = state.builds.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-build-title').textContent = item.progress >= 100 ? 'Edit Past Build' : 'Edit On-Process Build';
        document.getElementById('build-id').value = item.id;
        document.getElementById('build-customer').value = item.customerName;
        document.getElementById('build-welder').value = item.welderName;
        document.getElementById('build-specs').value = item.specs;
        document.getElementById('build-progress').value = item.progress;
        document.getElementById('build-cost').value = item.cost;
        document.getElementById('build-start').value = item.start;
        document.getElementById('build-target').value = item.target;

        const releasedGroup = document.getElementById('build-released-group');
        const releasedInput = document.getElementById('build-released');
        releasedInput.value = item.released || '';

        if (item.progress >= 100) {
            releasedGroup.style.display = 'flex';
            releasedInput.setAttribute('required', 'required');
            if (!item.released) {
                releasedInput.value = item.target || new Date().toISOString().split('T')[0];
            }
        } else {
            releasedGroup.style.display = 'none';
            releasedInput.removeAttribute('required');
        }

        if (item.image) {
            currentUploadedImageBase64 = item.image;
            buildImagePreview.innerHTML = `<img src="${item.image}" alt="Build Product">`;
        } else {
            currentUploadedImageBase64 = '';
            buildImagePreview.innerHTML = `<i class="fa-regular fa-image"></i><p>No image chosen</p>`;
        }
    }
    else if (modalId === 'modal-repair') {
        const item = state.repairs.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-repair-title').textContent = 'Edit Repair Job';
        document.getElementById('repair-id').value = item.id;
        document.getElementById('repair-customer').value = item.customerName;
        document.getElementById('repair-welder').value = item.welderName;
        document.getElementById('repair-item').value = item.item;
        document.getElementById('repair-issue').value = item.issue;
        document.getElementById('repair-status').value = item.status;
        document.getElementById('repair-cost').value = item.cost;
    }
    else if (modalId === 'modal-welding') {
        const item = state.weldingJobs.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-welding-title').textContent = 'Edit Welding Job';
        document.getElementById('welding-id').value = item.id;
        document.getElementById('welding-welder').value = item.welderName;
        document.getElementById('welding-desc').value = item.desc;
        document.getElementById('welding-cost').value = item.cost;
        document.getElementById('welding-date').value = item.date;
    }
    else if (modalId === 'modal-welder') {
        const item = state.welders.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-welder-title').textContent = 'Edit Welder Record';
        document.getElementById('welder-id').value = item.id;
        document.getElementById('welder-name').value = item.name;
        document.getElementById('welder-spec').value = item.spec;
        document.getElementById('welder-rate').value = item.rate;
        document.getElementById('welder-hours').value = item.hours;
        document.getElementById('welder-status').value = item.status;
    }
    else if (modalId === 'modal-gallery') {
        const item = state.gallery.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-gallery-title').textContent = 'Edit Gallery Item';
        document.getElementById('gallery-id').value = item.id;
        document.getElementById('gallery-title').value = item.title;
        document.getElementById('gallery-category').value = item.category;
        document.getElementById('gallery-desc').value = item.desc;

        if (item.image) {
            currentUploadedImageBase64 = item.image;
            galleryImagePreview.innerHTML = `<img src="${item.image}" alt="${item.title}">`;
        } else {
            currentUploadedImageBase64 = '';
            galleryImagePreview.innerHTML = `<i class="fa-regular fa-image"></i><p>No image chosen</p>`;
        }
    }
    else if (modalId === 'modal-material') {
        const item = state.materials.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-material-title').textContent = 'Edit Material';
        document.getElementById('material-id').value = item.id;
        document.getElementById('material-name').value = item.name;
        document.getElementById('material-category').value = item.categoryId;
        document.getElementById('material-unit').value = item.unit;
        document.getElementById('material-status').value = item.isActive ? 'active' : 'inactive';
        document.getElementById('material-desc').value = item.description || '';
    }
    else if (modalId === 'modal-template') {
        const item = state.productTemplates.find(x => x.id === id);
        if (!item) return;
        document.getElementById('modal-template-title').textContent = 'Edit Product Template';
        document.getElementById('template-id').value = item.id;
        document.getElementById('template-name').value = item.name;
        document.getElementById('template-category').value = item.categoryId;
        document.getElementById('template-desc').value = item.description || '';
        document.getElementById('template-status').value = item.isActive ? 'active' : 'inactive';
        document.getElementById('template-image-file').value = '';
        document.getElementById('template-image-url').value = item.imageUrl || '';
        if (item.imageUrl) {
            document.getElementById('template-image-preview').innerHTML = `<img src="${item.imageUrl}" style="max-height: 100px; border-radius: var(--radius);">`;
        } else {
            document.getElementById('template-image-preview').innerHTML = `<i class="fa-regular fa-image" style="font-size: 24px; color: var(--text-muted);"></i><p style="margin-left: 8px; font-size: 13px; color: var(--text-muted);">No image chosen</p>`;
        }
    }
}


/* ==========================================================================
   CRUD SUBMISSIONS
   ========================================================================== */

// Helpers for unique IDs
function generateUID(prefix, array) {
    let nextNum = 1;
    if (array.length > 0) {
        // Extract numbers from IDs and find max
        const nums = array.map(x => parseInt(x.id.split('-')[1]) || 0);
        nextNum = Math.max(...nums) + 1;
    }
    return `${prefix}-${String(nextNum).padStart(3, '0')}`;
}

// 1. Customer Form Submit
document.getElementById('form-customer').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('cust-id').value;
    const name = document.getElementById('cust-name').value;
    const phone = document.getElementById('cust-phone').value;
    const email = document.getElementById('cust-email').value.trim();
    const status = document.getElementById('cust-status').value;
    const description = document.getElementById('cust-desc').value;

    let totalAmount = parseFloat(document.getElementById('cust-total-amount').value) || 0;
    let downpayment = parseFloat(document.getElementById('cust-downpayment').value) || 0;
    let partialPayment = parseFloat(document.getElementById('cust-partial-payment').value) || 0;

    let projectType = 'Sidecar';
    if (status === 'Repair') projectType = 'Repair';
    else if (status === 'Welding Job') projectType = 'Welding';

    let customerIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.customers.findIndex(x => x.id === id);
        if (idx !== -1) {
            const oldStatus = state.customers[idx].status || 'On Process';
            const oldDown = state.customers[idx].downpayment || 0;
            const oldPartial = state.customers[idx].partialPayment || 0;
            
            // Safeguard: If the downpayment is equal to total amount, do not automatically change the status to Released.
            // Only change to Released if the user explicitly selected Released.
            let finalStatus = status;
            if (oldStatus !== 'Released' && status === 'Released') {
                downpayment = totalAmount; // Released means fully paid
            }

            state.customers[idx] = {
                ...state.customers[idx], name, phone, email, status: finalStatus,
                description, totalAmount, downpayment, partialPayment, buildStatus: finalStatus
            };

            // Log partial payment / downpayment increases if updated during edit
            if (partialPayment > oldPartial) {
                const addedPartial = partialPayment - oldPartial;
                logMoneyInForDate(addedPartial, `Partial payment from customer: ${name} (ID: ${id})`);
            }
            if (downpayment > oldDown) {
                const addedDown = downpayment - oldDown;
                logMoneyInForDate(addedDown, `Additional downpayment from customer: ${name} (ID: ${id})`);
            }

            // Sync name change across other collections
            let buildExists = false;
            state.builds.forEach(b => {
                if (b.customerId === id) {
                    buildExists = true;
                    b.customerName = name;
                    b.specs = description || b.specs;
                    b.cost = totalAmount;
                    if (status === 'Released') {
                        b.progress = 100;
                        b.released = b.released || new Date().toISOString().split('T')[0];
                    }
                    saveDocToFirestore(COLLECTIONS.BUILDS, b);
                }
            });

            if (!buildExists && (status === 'On Process' || status === 'Welding Job')) {
                const defaultWelder = state.welders[0] || { id: 'WELDER-001', name: 'Dante Rivera' };
                const todayStr = new Date().toISOString().split('T')[0];
                const targetDate = new Date();
                targetDate.setDate(new Date().getDate() + 30);
                const newBuild = {
                    id: id,
                    customerId: id,
                    customerName: name,
                    welderId: defaultWelder.id,
                    welderName: defaultWelder.name,
                    specs: description || `${status} for ${name}`,
                    progress: 0,
                    cost: totalAmount,
                    start: todayStr,
                    target: targetDate.toISOString().split('T')[0],
                    released: '',
                    image: ''
                };
                state.builds.push(newBuild);
                saveDocToFirestore(COLLECTIONS.BUILDS, newBuild);
            }

            let repairExists = false;
            state.repairs.forEach(r => {
                if (r.customerId === id) {
                    repairExists = true;
                    r.customerName = name;
                    r.issue = description || r.issue;
                    r.cost = totalAmount;
                    if (status === 'Released') {
                        r.status = 'Completed';
                        r.released = r.released || new Date().toISOString().split('T')[0];
                    }
                    saveDocToFirestore(COLLECTIONS.REPAIRS, r);
                }
            });

            if (!repairExists && status === 'Repair') {
                const defaultWelder = state.welders[0] || { id: 'WELDER-001', name: 'Dante Rivera' };
                const todayStr = new Date().toISOString().split('T')[0];
                const newRepair = {
                    id: id,
                    customerId: id,
                    customerName: name,
                    welderId: defaultWelder.id,
                    welderName: defaultWelder.name,
                    item: 'Motorcycle Sidecar / Chassis',
                    issue: description || `Repair for ${name}`,
                    status: 'In Progress',
                    cost: totalAmount,
                    released: ''
                };
                state.repairs.push(newRepair);
                saveDocToFirestore(COLLECTIONS.REPAIRS, newRepair);
            }
        }
    } else {
        // Add Mode
        const newId = generateUID('CUST', state.customers);
        customerIdToSave = newId;

        // Safeguard: If the downpayment is equal to total amount, do not automatically change the status to Released.
        // Only change to Released if the user explicitly selected Released.
        let finalStatus = status;
        if (status === 'Released') {
            downpayment = totalAmount;
        }

        const newCust = {
            id: newId, name, phone, email, status: finalStatus,
            date: new Date().toISOString().split('T')[0],
            created_at: new Date().toISOString(),
            projectType, totalAmount, downpayment, partialPayment, buildStatus: finalStatus, description
        };
        state.customers.push(newCust);

        const defaultWelder = state.welders[0] || { id: 'WELDER-001', name: 'Dante Rivera' };
        const todayStr = new Date().toISOString().split('T')[0];
        
        if (finalStatus === 'On Process') {
            const targetDate = new Date();
            targetDate.setDate(new Date().getDate() + 30);
            const newBuild = {
                id: newId,
                customerId: newId,
                customerName: name,
                welderId: defaultWelder.id,
                welderName: defaultWelder.name,
                specs: description || `Standard Sidecar order for ${name}`,
                progress: 0,
                cost: totalAmount,
                start: todayStr,
                target: targetDate.toISOString().split('T')[0],
                released: '',
                image: ''
            };
            state.builds.push(newBuild);
            saveDocToFirestore(COLLECTIONS.BUILDS, newBuild);

            setTimeout(() => {
                showDownpaymentReceipt({
                    name: name,
                    phone: phone,
                    email: email,
                    description: description || `Standard Sidecar order for ${name}`,
                    downpayment: downpayment + partialPayment,
                    balance: Math.max(0, totalAmount - (downpayment + partialPayment)),
                    totalCost: totalAmount,
                    dateAdded: todayStr
                });
            }, 500);
        } else if (finalStatus === 'Repair') {
            const newRepair = {
                id: newId,
                customerId: newId,
                customerName: name,
                welderId: defaultWelder.id,
                welderName: defaultWelder.name,
                item: 'Motorcycle Sidecar / Chassis',
                issue: description || `Repair for ${name}`,
                status: 'In Progress',
                cost: totalAmount,
                released: ''
            };
            state.repairs.push(newRepair);
            saveDocToFirestore(COLLECTIONS.REPAIRS, newRepair);

            setTimeout(() => {
                showDownpaymentReceipt({
                    name: name,
                    phone: phone,
                    email: email,
                    description: description || `Repair for ${name}`,
                    downpayment: downpayment + partialPayment,
                    balance: Math.max(0, totalAmount - (downpayment + partialPayment)),
                    totalCost: totalAmount,
                    dateAdded: todayStr
                });
            }, 500);
        } else if (finalStatus === 'Welding Job') {
            const targetDate = new Date();
            targetDate.setDate(new Date().getDate() + 14); // Default 2 weeks
            const newBuild = {
                id: newId,
                customerId: newId,
                customerName: name,
                welderId: defaultWelder.id,
                welderName: defaultWelder.name,
                specs: description || `Welding Job for ${name}`,
                progress: 0,
                cost: totalAmount,
                start: todayStr,
                target: targetDate.toISOString().split('T')[0],
                released: '',
                image: ''
            };
            state.builds.push(newBuild);
            saveDocToFirestore(COLLECTIONS.BUILDS, newBuild);

            setTimeout(() => {
                showDownpaymentReceipt({
                    name: name,
                    phone: phone,
                    email: email,
                    description: description || `Welding Job for ${name}`,
                    downpayment: downpayment + partialPayment,
                    balance: Math.max(0, totalAmount - (downpayment + partialPayment)),
                    totalCost: totalAmount,
                    dateAdded: todayStr
                });
            }, 500);
        } else if (finalStatus === 'Released') {
            const newBuild = {
                id: newId,
                customerId: newId,
                customerName: name,
                welderId: defaultWelder.id,
                welderName: defaultWelder.name,
                specs: description || `Standard Sidecar order for ${name}`,
                progress: 100,
                cost: totalAmount,
                start: todayStr,
                target: todayStr,
                released: todayStr,
                image: ''
            };
            state.builds.push(newBuild);
            saveDocToFirestore(COLLECTIONS.BUILDS, newBuild);

            setTimeout(() => {
                showReceiptModal({
                    name: name,
                    phone: phone,
                    email: email,
                    description: description || `Standard Sidecar order for ${name}`,
                    downpayment: totalAmount,
                    fullPayment: 0,
                    totalCost: totalAmount,
                    dateReleased: todayStr
                });
            }, 500);
        }
    }

    if (!id) {
        if (downpayment > 0) {
            logMoneyInForDate(downpayment, `Downpayment from customer: ${name} (ID: ${customerIdToSave})`);
        }
        if (partialPayment > 0) {
            logMoneyInForDate(partialPayment, `Partial payment from customer: ${name} (ID: ${customerIdToSave})`);
        }
    }

    const savedCustomer = state.customers.find(c => c.id === customerIdToSave);
    saveDocToFirestore(COLLECTIONS.CUSTOMERS, savedCustomer);

    closeFormModal('modal-customer');
    renderAllDashboardData();
    switchDashboardTab('tab-customers');
});

// 2. Build Form Submit
document.getElementById('form-build').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('build-id').value;
    const customerInput = document.getElementById('build-customer').value;
    const welderInput = document.getElementById('build-welder').value;
    const specs = document.getElementById('build-specs').value;
    const progress = parseInt(document.getElementById('build-progress').value) || 0;
    const cost = parseFloat(document.getElementById('build-cost').value) || 0;
    const start = document.getElementById('build-start').value;
    const target = document.getElementById('build-target').value;
    const released = document.getElementById('build-released').value || '';

    const customerExistsBefore = state.customers.some(c => c.name.toLowerCase() === customerInput.trim().toLowerCase());
    const { id: customerId, name: customerName } = resolveCustomer(customerInput);
    const { id: welderId, name: welderName } = resolveWelder(welderInput);

    let buildReleasedDate = released;

    const customer = state.customers.find(c => c.id === customerId);
    if (customer) {
        customer.totalAmount = cost;
        if (buildReleasedDate) {
            customer.buildStatus = 'Released';
        } else if (progress >= 100) {
            customer.buildStatus = 'Ready to Release';
        } else {
            customer.buildStatus = 'On Process';
        }
        saveDocToFirestore(COLLECTIONS.CUSTOMERS, customer);
    }

    let buildIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.builds.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.builds[idx] = {
                ...state.builds[idx], customerId, customerName, welderId, welderName,
                specs, progress, cost, start, target, released: buildReleasedDate, image: currentUploadedImageBase64 || state.builds[idx].image
            };
        }
    } else {
        // Add Mode
        const newId = customerId;
        buildIdToSave = newId;
        state.builds.push({
            id: newId, customerId, customerName, welderId, welderName,
            specs, progress, cost, start, target, released: buildReleasedDate, image: currentUploadedImageBase64
        });
    }

    const savedBuild = state.builds.find(b => b.id === buildIdToSave);
    saveDocToFirestore(COLLECTIONS.BUILDS, savedBuild);

    closeFormModal('modal-build');
    renderAllDashboardData();
    renderVisitorGallery(); // Update public page as well

    // Automatically transition tab depending on build status
    if (buildReleasedDate) {
        switchDashboardTab('tab-past-builds');
    } else {
        switchDashboardTab('tab-builds');
    }
});

// 3. Repair Form Submit
document.getElementById('form-repair').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('repair-id').value;
    const customerInput = document.getElementById('repair-customer').value;
    const welderInput = document.getElementById('repair-welder').value;
    const item = document.getElementById('repair-item').value;
    const issue = document.getElementById('repair-issue').value;
    const status = document.getElementById('repair-status').value;
    const cost = parseFloat(document.getElementById('repair-cost').value) || 0;

    const { id: customerId, name: customerName } = resolveCustomer(customerInput);
    const { id: welderId, name: welderName } = resolveWelder(welderInput);

    let repairReleased = '';

    if (status === 'Completed') {
        const customer = state.customers.find(c => c.id === customerId);
        if (customer) {
            const currentTotal = cost || customer.totalAmount || 0;
            const currentDownpayment = customer.downpayment || 0;
            let fullPayment = 0;

            if (currentDownpayment >= currentTotal) {
                fullPayment = 0;
                alert(`Downpayment (₱${currentDownpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}) equals or exceeds Repair/Total Cost (₱${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}).\nPermission to release is granted!`);
            } else {
                const remaining = currentTotal - currentDownpayment;
                const promptMsg = `This repair is complete.\nTotal Cost: ₱${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\nDownpayment Paid: ₱${currentDownpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\nRemaining Balance: ₱${remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}.\n\nPlease enter the Full Payment amount:`;
                
                const fullPaymentInput = prompt(promptMsg, remaining);
                if (fullPaymentInput === null) {
                    return; // cancel submit
                }

                fullPayment = parseFloat(fullPaymentInput);
                if (isNaN(fullPayment) || Math.abs((currentDownpayment + fullPayment) - currentTotal) > 0.01) {
                    alert(`Error: The math does not add up!\nDownpayment (₱${currentDownpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}) + Full Payment (₱${(fullPayment || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}) must equal the Total Cost (₱${currentTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}).`);
                    return; // cancel submit
                }
            }

            repairReleased = new Date().toISOString().split('T')[0];
            customer.downpayment = currentTotal; // fully paid
            customer.buildStatus = 'Released';
            saveDocToFirestore(COLLECTIONS.CUSTOMERS, customer);

            if (fullPayment > 0) {
                logMoneyInForDate(fullPayment, `Full payment for repair: ${customer.name} (${item})`);
            }

            setTimeout(() => {
                showReceiptModal({
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email,
                    description: `Repair for ${item}: ${issue}`,
                    downpayment: currentDownpayment,
                    fullPayment: fullPayment,
                    totalCost: currentTotal,
                    dateReleased: repairReleased
                });
            }, 300);
        }
    }

    let repairIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.repairs.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.repairs[idx] = {
                ...state.repairs[idx], customerId, customerName, welderId, welderName,
                item, issue, status, cost, released: repairReleased || state.repairs[idx].released || ''
            };
        }
    } else {
        // Add Mode
        const newId = customerId;
        repairIdToSave = newId;
        state.repairs.push({
            id: newId, customerId, customerName, welderId, welderName,
            item, issue, status, cost, released: repairReleased
        });
    }

    const savedRepair = state.repairs.find(r => r.id === repairIdToSave);
    saveDocToFirestore(COLLECTIONS.REPAIRS, savedRepair);

    closeFormModal('modal-repair');
    renderAllDashboardData();
});

// 4. Welding Job Form Submit
document.getElementById('form-welding').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('welding-id').value;
    const welderInput = document.getElementById('welding-welder').value;
    const desc = document.getElementById('welding-desc').value;
    const cost = parseFloat(document.getElementById('welding-cost').value) || 0;
    const date = document.getElementById('welding-date').value;

    const { id: welderId, name: welderName } = resolveWelder(welderInput);

    let weldingIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.weldingJobs.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.weldingJobs[idx] = {
                ...state.weldingJobs[idx], welderId, welderName, desc, cost, date
            };
        }
    } else {
        // Add Mode
        const newId = generateUID('WELD', state.weldingJobs);
        weldingIdToSave = newId;
        state.weldingJobs.push({
            id: newId, welderId, welderName, desc, cost, date
        });
    }

    const savedWelding = state.weldingJobs.find(w => w.id === weldingIdToSave);
    saveDocToFirestore(COLLECTIONS.WELDING_JOBS, savedWelding);

    closeFormModal('modal-welding');
    renderAllDashboardData();
    switchDashboardTab('tab-welding');
});


// 5. Welder Form Submit
document.getElementById('form-welder').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('welder-id').value;
    const name = document.getElementById('welder-name').value;
    const spec = document.getElementById('welder-spec').value;

    let welderIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.welders.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.welders[idx] = {
                ...state.welders[idx],
                name,
                spec
            };
        }
    } else {
        // Add Mode
        const newId = generateUID('WELDER', state.welders);
        welderIdToSave = newId;
        state.welders.push({
            id: newId,
            name,
            spec,
            status: 'Paid',
            jobs: []
        });
    }

    const savedWelder = state.welders.find(w => w.id === welderIdToSave);
    saveDocToFirestore(COLLECTIONS.WELDERS, savedWelder);

    closeFormModal('modal-welder');
    renderAllDashboardData();
});

// 6. Gallery Form Submit
document.getElementById('form-gallery').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('gallery-id').value;
    const title = document.getElementById('gallery-title').value;
    const category = document.getElementById('gallery-category').value;
    const desc = document.getElementById('gallery-desc').value;

    let galleryIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.gallery.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.gallery[idx] = {
                ...state.gallery[idx],
                title,
                category,
                desc,
                image: currentUploadedImageBase64 || state.gallery[idx].image
            };
        }
    } else {
        // Add Mode
        const newId = generateUID('GAL', state.gallery);
        galleryIdToSave = newId;
        state.gallery.push({
            id: newId,
            title,
            category,
            desc,
            image: currentUploadedImageBase64
        });
    }

    const savedGallery = state.gallery.find(g => g.id === galleryIdToSave);
    saveDocToFirestore(COLLECTIONS.GALLERY, savedGallery);

    closeFormModal('modal-gallery');
    renderAllDashboardData();
    renderVisitorGallery();
});

function checkAdminPermission() {
    if (state.currentUserRole === 'Admin' || state.currentUserRole === 'Owner') {
        return true;
    }
    alert("Authorization error: Only users with the Admin role can perform this action.");
    return false;
}

// 7. Material Form Submit
document.getElementById('form-material').addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Check permissions
    if (!checkAdminPermission()) return;

    const id = document.getElementById('material-id').value;
    const name = document.getElementById('material-name').value.trim();
    const categoryId = document.getElementById('material-category').value;
    const unit = document.getElementById('material-unit').value;
    const statusVal = document.getElementById('material-status').value;
    const description = document.getElementById('material-desc').value.trim();
    
    const isActive = statusVal === 'active';
    const currentUser = firebase.auth().currentUser;
    const userEmail = currentUser ? currentUser.email : 'system';
    
    // Uniqueness validation (check against non-deleted materials)
    const duplicate = state.materials.find(x => 
        x.name.toLowerCase() === name.toLowerCase() && 
        x.id !== id &&
        !x.deleted_at
    );
    if (duplicate) {
        alert("Validation error: A material with this name already exists.");
        return;
    }

    let materialIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.materials.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.materials[idx] = {
                ...state.materials[idx],
                name,
                categoryId,
                unit,
                description,
                isActive,
                updated_at: new Date().toISOString(),
                updated_by: userEmail
            };
        }
    } else {
        // Add Mode
        const newId = generateUID('MAT', state.materials);
        materialIdToSave = newId;
        state.materials.push({
            id: newId,
            name,
            categoryId,
            unit,
            description,
            isActive,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            created_by: userEmail,
            updated_by: userEmail,
            deleted_at: null,
            deleted_by: null
        });
    }

    const savedMaterial = state.materials.find(m => m.id === materialIdToSave);
    saveDocToFirestore(COLLECTIONS.MATERIALS, savedMaterial);

    closeFormModal('modal-material');
    renderMaterialsTable();
});

async function uploadFileToStorage(file, path) {
    try {
        const storageRef = storage.ref().child(path);
        const snapshot = await storageRef.put(file);
        return await snapshot.ref.getDownloadURL();
    } catch (err) {
        console.warn("Firebase Storage upload failed, falling back to Base64:", err);
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
    }
}

// 8. Product Template Form Submit
document.getElementById('form-template').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!checkAdminPermission()) return;

    const id = document.getElementById('template-id').value;
    const name = document.getElementById('template-name').value.trim();
    const categoryId = document.getElementById('template-category').value;
    const statusVal = document.getElementById('template-status').value;
    const description = document.getElementById('template-desc').value.trim();
    const fileInput = document.getElementById('template-image-file');
    
    const isActive = statusVal === 'active';
    const currentUser = firebase.auth().currentUser;
    const userEmail = currentUser ? currentUser.email : 'system';

    // Unique name validation (exclude deleted templates)
    const duplicate = state.productTemplates.find(x => 
        x.name.toLowerCase() === name.toLowerCase() && 
        x.id !== id && 
        !x.deleted_at
    );
    if (duplicate) {
        alert("Validation error: A product template with this name already exists.");
        return;
    }

    let imageUrl = document.getElementById('template-image-url').value;

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        if (currentUploadedImageBase64) {
            imageUrl = currentUploadedImageBase64;
        }

        let templateIdToSave = id;

        if (id) {
            // Edit Mode
            const idx = state.productTemplates.findIndex(x => x.id === id);
            if (idx !== -1) {
                state.productTemplates[idx] = {
                    ...state.productTemplates[idx],
                    name,
                    categoryId,
                    description,
                    imageUrl,
                    isActive,
                    updated_at: new Date().toISOString(),
                    updated_by: userEmail
                };
                saveDocToFirestore(COLLECTIONS.PRODUCT_TEMPLATES, state.productTemplates[idx]);
            }
        } else {
            // Add Mode
            const newDocRef = db.collection(COLLECTIONS.PRODUCT_TEMPLATES).doc();
            const newId = newDocRef.id;
            templateIdToSave = newId;
            const newTmpl = {
                id: newId,
                name,
                categoryId,
                description,
                imageUrl,
                isActive,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                created_by: userEmail,
                updated_by: userEmail,
                deleted_at: null,
                deleted_by: null
            };
            state.productTemplates.push(newTmpl);
            saveDocToFirestore(COLLECTIONS.PRODUCT_TEMPLATES, newTmpl);
        }

        closeFormModal('modal-template');
        renderTemplatesGrid();
        
        if (state.activeTemplateId === templateIdToSave) {
            openTemplateDetailsModal(templateIdToSave);
        }
    } catch (err) {
        console.error("Error saving template:", err);
        alert("Error saving template. Please try again.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
    }
});

// 9. Product Variant Form Submit
document.getElementById('form-variant').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!checkAdminPermission()) return;

    const id = document.getElementById('variant-id').value;
    const templateId = state.activeTemplateId;
    const name = document.getElementById('variant-name').value.trim();
    const code = document.getElementById('variant-code').value.trim();
    const materialType = document.getElementById('variant-material-type').value.trim();
    const sellingPrice = parseFloat(document.getElementById('variant-price').value) || 0;
    const estimatedLaborHours = parseFloat(document.getElementById('variant-labor').value) || 0;
    const version = document.getElementById('variant-version').value.trim();
    const changeLog = document.getElementById('variant-changelog').value.trim();
    const length = document.getElementById('variant-length').value.trim();
    const width = document.getElementById('variant-width').value.trim();
    const height = document.getElementById('variant-height').value.trim();
    const weight = document.getElementById('variant-weight').value.trim();
    
    const isDefault = document.getElementById('variant-is-default').checked;
    const isActive = document.getElementById('variant-is-active').checked;

    if (!templateId) {
        alert("System error: No active template selected.");
        return;
    }

    // Unique variant name or code verification per template
    const duplicate = state.productVariants.find(x => 
        x.templateId === templateId && 
        (x.name.toLowerCase() === name.toLowerCase() || x.code.toLowerCase() === code.toLowerCase()) && 
        x.id !== id && 
        !x.deleted_at
    );
    if (duplicate) {
        alert("Validation error: A variant with this name or code already exists for this template.");
        return;
    }

    // If isDefault is checked, mark all other variants for this template as isDefault = false
    if (isDefault) {
        state.productVariants.forEach(v => {
            if (v.templateId === templateId && v.id !== id && v.isDefault) {
                v.isDefault = false;
                saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANTS, v);
            }
        });
    }

    let variantIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.productVariants.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.productVariants[idx] = {
                ...state.productVariants[idx],
                name,
                code,
                materialType,
                sellingPrice,
                isDefault,
                isActive,
                version,
                changeLog,
                estimatedLaborHours,
                length,
                width,
                height,
                weight,
                updated_at: new Date().toISOString()
            };
            saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANTS, state.productVariants[idx]);
        }
    } else {
        // Add Mode
        const newDocRef = db.collection(COLLECTIONS.PRODUCT_VARIANTS).doc();
        const newId = newDocRef.id;
        variantIdToSave = newId;
        const newVar = {
            id: newId,
            templateId,
            name,
            code,
            materialType,
            sellingPrice,
            isDefault,
            isActive,
            version,
            revisionNumber: 0,
            effectiveDate: new Date().toISOString(),
            changeLog: changeLog || 'Initial release.',
            estimatedLaborHours,
            length,
            width,
            height,
            weight,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
            deleted_by: null
        };
        state.productVariants.push(newVar);
        saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANTS, newVar);
    }

    document.getElementById('form-variant').reset();
    document.getElementById('form-variant').style.display = 'none';
    document.getElementById('variant-info-display').style.display = 'flex';
    document.getElementById('btn-add-variant-toggle').style.display = 'inline-block';
    
    // Refresh Details Modal
    await refreshVariantDropdown(templateId, variantIdToSave);
    openTemplateDetailsModal(templateId, variantIdToSave);
    renderTemplatesGrid();
});

// 10. BOM Material Form Submit
document.getElementById('form-bom-item').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!checkAdminPermission()) return;

    const id = document.getElementById('bom-id').value;
    const variantId = document.getElementById('detail-variant-select').value;
    const materialId = document.getElementById('bom-material').value;
    const quantity = parseFloat(document.getElementById('bom-qty').value) || 0;
    const remarks = document.getElementById('bom-remarks').value.trim();
    const sortOrder = parseInt(document.getElementById('bom-sort-order').value) || 0;

    if (!variantId) {
        alert("Validation error: Please select or create a variant first.");
        return;
    }

    if (quantity <= 0) {
        alert("Validation error: Quantity must be greater than zero.");
        return;
    }

    // Material status validation (inactive materials cannot be added to new BOMs)
    const mat = state.materials.find(x => x.id === materialId);
    if (!mat || !mat.isActive) {
        alert("Validation error: Inactive materials cannot be added to a Bill of Materials.");
        return;
    }

    // Prevent duplicate materials (variantId + materialId uniqueness)
    const duplicate = state.productVariantMaterials.find(x => 
        x.variantId === variantId && 
        x.materialId === materialId && 
        x.id !== id
    );
    if (duplicate) {
        alert("Validation error: This material is already in the Bill of Materials. Adjust its quantity instead.");
        return;
    }

    let bomIdToSave = id;

    if (id) {
        // Edit Mode
        const idx = state.productVariantMaterials.findIndex(x => x.id === id);
        if (idx !== -1) {
            state.productVariantMaterials[idx] = {
                ...state.productVariantMaterials[idx],
                materialId,
                quantity,
                remarks,
                sortOrder,
                updated_at: new Date().toISOString()
            };
            saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANT_MATERIALS, state.productVariantMaterials[idx]);
        }
    } else {
        // Add Mode
        const newDocRef = db.collection(COLLECTIONS.PRODUCT_VARIANT_MATERIALS).doc();
        const newId = newDocRef.id;
        bomIdToSave = newId;
        
        let finalSortOrder = sortOrder;
        if (finalSortOrder === 0) {
            const siblingBoms = state.productVariantMaterials.filter(x => x.variantId === variantId);
            if (siblingBoms.length > 0) {
                finalSortOrder = Math.max(...siblingBoms.map(x => x.sortOrder || 0)) + 1;
            } else {
                finalSortOrder = 1;
            }
        }

        const newBom = {
            id: newId,
            variantId,
            materialId,
            quantity,
            remarks,
            sortOrder: finalSortOrder,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        state.productVariantMaterials.push(newBom);
        saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANT_MATERIALS, newBom);
    }

    document.getElementById('form-bom-item').reset();
    document.getElementById('form-bom-item').style.display = 'none';
    document.getElementById('btn-add-bom-item-toggle').style.display = 'inline-block';
    
    openTemplateDetailsModal(state.activeTemplateId, variantId);
});

async function moveBomItem(bomId, direction) {
    if (!checkAdminPermission()) return;
    
    const bomItem = state.productVariantMaterials.find(x => x.id === bomId);
    if (!bomItem) return;
    
    const variantId = bomItem.variantId;
    const siblingBoms = state.productVariantMaterials
        .filter(x => x.variantId === variantId)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        
    const index = siblingBoms.findIndex(x => x.id === bomId);
    if (index === -1) return;
    
    let targetIndex = -1;
    if (direction === 'up' && index > 0) {
        targetIndex = index - 1;
    } else if (direction === 'down' && index < siblingBoms.length - 1) {
        targetIndex = index + 1;
    }
    
    if (targetIndex !== -1) {
        const targetItem = siblingBoms[targetIndex];
        const tempOrder = bomItem.sortOrder || 0;
        bomItem.sortOrder = targetItem.sortOrder || 0;
        targetItem.sortOrder = tempOrder;
        
        saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANT_MATERIALS, bomItem);
        saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANT_MATERIALS, targetItem);
        
        openTemplateDetailsModal(state.activeTemplateId, variantId);
    }
}


// Delete Operations handlers
function deleteItem(type, id) {
    if (type === 'template') {
        if (!checkAdminPermission()) return;
        if (!confirm("Are you sure you want to delete this product template? This will soft-delete the template and all associated variants.")) return;
        
        const idx = state.productTemplates.findIndex(x => x.id === id);
        if (idx !== -1) {
            const userEmail = firebase.auth().currentUser ? firebase.auth().currentUser.email : 'system';
            state.productTemplates[idx] = {
                ...state.productTemplates[idx],
                isActive: false,
                deleted_at: new Date().toISOString(),
                deleted_by: userEmail
            };
            saveDocToFirestore(COLLECTIONS.PRODUCT_TEMPLATES, state.productTemplates[idx]);
            
            // Soft delete all variants of this template as well
            state.productVariants.forEach(v => {
                if (v.templateId === id && !v.deleted_at) {
                    v.isActive = false;
                    v.deleted_at = new Date().toISOString();
                    v.deleted_by = userEmail;
                    saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANTS, v);
                }
            });
        }
        closeFormModal('modal-template-details');
        renderTemplatesGrid();
        return;
    }

    if (type === 'variant') {
        if (!checkAdminPermission()) return;
        if (!confirm("Are you sure you want to delete this product variant? This will soft-delete the variant and its associated Bill of Materials.")) return;
        
        const idx = state.productVariants.findIndex(x => x.id === id);
        if (idx !== -1) {
            const userEmail = firebase.auth().currentUser ? firebase.auth().currentUser.email : 'system';
            state.productVariants[idx] = {
                ...state.productVariants[idx],
                isActive: false,
                deleted_at: new Date().toISOString(),
                deleted_by: userEmail
            };
            saveDocToFirestore(COLLECTIONS.PRODUCT_VARIANTS, state.productVariants[idx]);
        }
        
        const templateId = state.activeTemplateId;
        const nextVar = state.productVariants.find(v => v.templateId === templateId && !v.deleted_at);
        const nextVarId = nextVar ? nextVar.id : '';
        
        refreshVariantDropdown(templateId, nextVarId);
        openTemplateDetailsModal(templateId, nextVarId);
        renderTemplatesGrid();
        return;
    }

    if (type === 'bom_item') {
        if (!checkAdminPermission()) return;
        if (!confirm("Are you sure you want to remove this material from the Bill of Materials?")) return;
        
        state.productVariantMaterials = state.productVariantMaterials.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.PRODUCT_VARIANT_MATERIALS, id);
        
        const activeVarSelect = document.getElementById('detail-variant-select');
        const variantId = activeVarSelect ? activeVarSelect.value : '';
        openTemplateDetailsModal(state.activeTemplateId, variantId);
        return;
    }

    if (type === 'material') {
        if (!checkAdminPermission()) return;
        if (!confirm("Are you sure you want to delete this material? This action can affect future manufacturing records.")) return;
        const idx = state.materials.findIndex(x => x.id === id);
        if (idx !== -1) {
            const userEmail = firebase.auth().currentUser ? firebase.auth().currentUser.email : 'system';
            state.materials[idx] = {
                ...state.materials[idx],
                isActive: false,
                deleted_at: new Date().toISOString(),
                deleted_by: userEmail
            };
            saveDocToFirestore(COLLECTIONS.MATERIALS, state.materials[idx]);
        }
        renderMaterialsTable();
        return;
    }

    if (!confirm("Are you sure you want to delete this log entry?")) return;

    if (type === 'customer') {
        state.customers = state.customers.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.CUSTOMERS, id);
    } else if (type === 'build') {
        state.builds = state.builds.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.BUILDS, id);
    } else if (type === 'repair') {
        state.repairs = state.repairs.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.REPAIRS, id);
    } else if (type === 'welding') {
        state.weldingJobs = state.weldingJobs.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.WELDING_JOBS, id);
    } else if (type === 'welder') {
        state.welders = state.welders.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.WELDERS, id);
    } else if (type === 'gallery') {
        state.gallery = state.gallery.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.GALLERY, id);
    } else if (type === 'vale') {
        state.vales = state.vales.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.VALES, id);
    } else if (type === 'payroll') {
        state.payrolls = state.payrolls.filter(x => x.id !== id);
        deleteDocFromFirestore(COLLECTIONS.PAYROLLS, id);
    }

    renderAllDashboardData();
    renderVisitorGallery();
}



/* ==========================================================================
   RENDER RENDERING ENGINE (DASHBOARD TABLES & CARDS)
   ========================================================================== */

function renderAllDashboardData() {
    renderStatsOverview();
    renderOverviewPanels();
    renderCustomersTable();
    renderBuildsCards();
    renderPastBuildsCards();
    renderRepairsTable();
    renderWeldingJobsTable();
    renderWeldersTable();
    renderGalleryCardsAdmin();
    renderInquiriesTable();
    renderDailyTraffic();
}

// 1. Stats Counter Cards
function renderStatsOverview() {
    // Active builds (progress < 100)
    const activeBuilds = state.builds.filter(b => b.progress < 100).length;
    document.getElementById('stat-active-builds').textContent = activeBuilds;

    // Active repairs (status != Completed)
    const activeRepairs = state.repairs.filter(r => r.status !== 'Completed').length;
    document.getElementById('stat-active-repairs').textContent = activeRepairs;

    // Total Customers
    document.getElementById('stat-total-customers').textContent = state.customers.length;
}

// 2. Dashboard Overview Lists (Left/Right box body)
function renderOverviewPanels() {
    // Left side: Build progress items
    const progressList = document.getElementById('overview-build-progress-list');
    progressList.innerHTML = '';

    // Sort builds by progress ascending, show top 3 active
    const activeBuilds = state.builds.filter(b => b.progress < 100)
        .sort((a, b) => a.progress - b.progress)
        .slice(0, 3);

    if (activeBuilds.length === 0) {
        progressList.innerHTML = '<div class="gallery-placeholder" style="padding: 20px;"><p>No active builds in progress.</p></div>';
    } else {
        activeBuilds.forEach(b => {
            progressList.innerHTML += `
                <div class="mini-build-card">
                    <div class="mini-build-header">
                        <span class="mini-build-client">${b.customerName}</span>
                        <span>${b.progress}%</span>
                    </div>
                    <div class="mini-build-bar-bg">
                        <div class="mini-build-bar" style="width: ${b.progress}%"></div>
                    </div>
                    <div class="mini-build-footer">
                        <span>Specs: ${b.specs.substring(0, 45)}...</span>
                        <span>Due: ${b.target}</span>
                    </div>
                </div>
            `;
        });
    }

    // Right side: Welder payouts & unpaid totals
    const welderList = document.getElementById('overview-welders-list');
    welderList.innerHTML = '';

    let totalUnpaidLabor = 0;

    state.welders.forEach(w => {
        if (!w.jobs) w.jobs = [];
        const unpaidJobs = w.jobs.filter(j => j.status === 'Unpaid');
        const payout = unpaidJobs.reduce((sum, j) => sum + j.amount, 0);
        totalUnpaidLabor += payout;

        welderList.innerHTML += `
            <div class="welder-payout-row">
                <span>${w.name} (${w.spec.split('/')[0]})</span>
                <span class="welder-payout-amount">₱${payout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
        `;
    });

    document.getElementById('overview-total-labor-cost').textContent = `₱${totalUnpaidLabor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 3. Customers Log Table
function renderCustomersTable() {
    const tbody = document.getElementById('customers-table-body');
    const searchVal = document.getElementById('search-customers').value.toLowerCase();
    tbody.innerHTML = '';

    const filtered = state.customers.filter(c =>
        c.name.toLowerCase().includes(searchVal) ||
        c.phone.includes(searchVal) ||
        c.email.toLowerCase().includes(searchVal)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: var(--text-muted);">No customer records found.</td></tr>`;
        return;
    }

    // Sort newest-first (latest at the top, first created at the bottom)
    const sorted = [...filtered].sort((a, b) => {
        if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
        }
        const numA = parseInt((a.id || '').replace(/\D/g, '')) || 0;
        const numB = parseInt((b.id || '').replace(/\D/g, '')) || 0;
        if (numA !== numB) return numB - numA;
        return (b.date || '').localeCompare(a.date || '');
    });

    sorted.forEach(c => {
        const type = c.projectType || 'Sidecar';
        const total = c.totalAmount || 0;
        const down = c.downpayment || 0;
        const partial = c.partialPayment || 0;
        const totalPaid = down + partial;
        const balance = Math.max(0, total - totalPaid);

        // Status Badge logic
        let badgeClass = 'badge-warning';
        let statusLabel = type === 'Sidecar' ? 'Pending Build' : 'Pending Welding';

        const build = state.builds.find(b => b.customerId === c.id);
        const weld = state.weldingJobs.find(w => w.customerId === c.id);
        const repair = state.repairs.find(r => r.customerId === c.id);

        if (build) {
            if (build.released) {
                badgeClass = 'badge-success';
                statusLabel = 'Released';
                c.buildStatus = 'Released';
            } else if (build.progress >= 100) {
                badgeClass = 'badge-warning';
                statusLabel = 'Ready to Release';
                c.buildStatus = 'Ready to Release';
            } else {
                badgeClass = 'badge-info';
                statusLabel = 'On Process';
                c.buildStatus = 'On Process';
            }
        } else if (weld) {
            if (weld.released) {
                badgeClass = 'badge-success';
                statusLabel = 'Released';
                c.buildStatus = 'Released';
            } else {
                badgeClass = 'badge-info';
                statusLabel = 'On Welding';
                c.buildStatus = 'On Welding';
            }
        } else if (repair) {
            if (repair.released) {
                badgeClass = 'badge-success';
                statusLabel = 'Released';
                c.buildStatus = 'Released';
            } else if (repair.status === 'Completed') {
                badgeClass = 'badge-warning';
                statusLabel = 'Ready to Release';
                c.buildStatus = 'Ready to Release';
            } else {
                badgeClass = 'badge-info';
                statusLabel = `Repair: ${repair.status}`;
                c.buildStatus = `Repair: ${repair.status}`;
            }
        } else {
            if (c.buildStatus === 'Released') {
                badgeClass = 'badge-success';
                statusLabel = 'Released';
            } else if (c.buildStatus === 'On Process') {
                badgeClass = 'badge-info';
                statusLabel = 'On Process';
            } else if (c.buildStatus === 'On Welding') {
                badgeClass = 'badge-info';
                statusLabel = 'On Welding';
            } else if (c.buildStatus === 'Ready to Release') {
                badgeClass = 'badge-warning';
                statusLabel = 'Ready to Release';
            } else {
                badgeClass = 'badge-warning';
                statusLabel = type === 'Sidecar' ? 'Pending Build' : 'Pending Welding';
                c.buildStatus = 'Pending';
            }
        }

        // Put in On-Process button for both Sidecar and Welding projects
        let buildBtn = '';
        if (type === 'Sidecar' || type === 'Welding') {
            const hasActiveProject = (build && !build.released) || (weld && !weld.released) || (repair && !repair.released);
            if (!hasActiveProject) {
                buildBtn = `<button class="btn-icon" onclick="event.stopPropagation(); putInOnProcessBuild('${c.id}')" title="Put in On-Process Build" style="color: var(--accent); border-color: var(--border-glow);"><i class="fa-solid fa-hammer"></i></button>`;
            } else {
                buildBtn = `<button class="btn-icon" disabled title="Already on-process / completed" style="opacity: 0.25; cursor: not-allowed;"><i class="fa-solid fa-ban"></i></button>`;
            }
        }

        // Lock/unlock edit button - Always unlocked for owner convenience
        let editBtn = `<button class="btn-icon" onclick="event.stopPropagation(); openFormModal('modal-customer', '${c.id}')" title="Edit Customer"><i class="fa-solid fa-pen-to-square"></i></button>`;

        tbody.innerHTML += `
            <tr class="clickable-row" onclick="openCustomerDetails('${c.id}')">
                <td><strong class="text-glow" style="color: var(--accent); font-family: monospace;">${c.id}</strong></td>
                <td><span style="font-weight: 600;">${c.name}</span></td>
                <td>${c.phone}</td>
                <td>${c.email || 'N/A'}</td>
                <td style="max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: var(--text-secondary);" title="${c.description || ''}">${c.description || 'N/A'}</td>
                <td><span style="font-weight: 500; font-size: 12px; color: ${type === 'Sidecar' ? 'var(--text-secondary)' : 'var(--info)'}">${type}</span></td>
                <td>₱${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>
                    <span>₱${down.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    ${partial > 0 ? `<div style="font-size: 11px; color: var(--success); font-weight: 600; margin-top: 2px;">+₱${partial.toLocaleString(undefined, { minimumFractionDigits: 2 })} Partial</div>` : ''}
                </td>
                <td style="font-weight: 600; color: ${balance > 0 ? 'var(--warning)' : 'var(--success)'}">₱${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
                <td>${c.date}</td>
                <td>
                    <div class="table-actions-cell" style="text-align: right;">
                        ${buildBtn}
                        ${editBtn}
                        <button class="btn-icon delete" onclick="event.stopPropagation(); deleteItem('customer', '${c.id}')" title="Delete Customer"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

// 4. On-Process Builds Logs Table
function renderBuildsCards() {
    const tbody = document.getElementById('builds-table-body');
    if (!tbody) return;
    const searchVal = document.getElementById('search-builds').value.toLowerCase();
    tbody.innerHTML = '';

    const filtered = state.builds.filter(b =>
        !b.released && (
            b.customerName.toLowerCase().includes(searchVal) ||
            b.specs.toLowerCase().includes(searchVal) ||
            b.id.toLowerCase().includes(searchVal)
        )
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 40px; color: var(--text-secondary);"><i class="fa-regular fa-folder-open" style="font-size: 24px; margin-bottom: 8px; display: block; text-align: center;"></i><p style="text-align: center; margin: 0;">No active builds match your search.</p></td></tr>`;
        return;
    }

    filtered.forEach(b => {
        const isCompleted = b.progress >= 100;
        const progressLabel = isCompleted ? 'Completed' : `${b.progress}% Complete`;
        const progressBarColor = isCompleted ? 'var(--success)' : 'var(--accent)';

        tbody.innerHTML += `
            <tr class="clickable-row" onclick="openBuildDetails('${b.id}')">
                <td><strong class="text-glow" style="color: var(--accent); font-family: monospace;">${b.id}</strong></td>
                <td><span style="font-weight: 600;">${b.customerName}</span></td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: var(--text-secondary);" title="${b.specs}">${b.specs}</td>
                <td><span style="font-size: 13px;">${b.welderName}</span></td>
                <td><span style="font-size: 13px; color: var(--text-secondary);">${b.target}</span></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-start;">
                        <span style="font-weight: bold; font-size: 12px; color: ${progressBarColor}; width: 85px; display: inline-block;">${progressLabel}</span>
                        <div class="mini-build-bar-bg" style="width: 70px; height: 6px; margin: 0; background: rgba(255,255,255,0.05); border-radius: 3px;">
                            <div class="mini-build-bar" style="width: ${b.progress}%; height: 100%; background: ${progressBarColor}; border-radius: 3px;"></div>
                        </div>
                    </div>
                </td>
                <td class="table-actions-cell" style="text-align: right;">
                    <button class="btn-icon release" onclick="event.stopPropagation(); releaseBuildUnit('${b.id}')" title="Release Unit" style="margin-right: 6px;"><i class="fa-solid fa-circle-check"></i></button>
                    <button class="btn-icon" onclick="event.stopPropagation(); openFormModal('modal-build', '${b.id}')" title="Edit Build Specs" style="margin-right: 6px;"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn-icon delete" onclick="event.stopPropagation(); deleteItem('build', '${b.id}')" title="Delete Build"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

// 4b. Past Builds Logs Table
function renderPastBuildsCards() {
    const tbody = document.getElementById('past-builds-table-body');
    if (!tbody) return;
    const searchInput = document.getElementById('search-past-builds');
    const searchVal = searchInput ? searchInput.value.toLowerCase() : '';
    tbody.innerHTML = '';

    const filtered = state.builds.filter(b =>
        b.released && (
            b.customerName.toLowerCase().includes(searchVal) ||
            b.specs.toLowerCase().includes(searchVal) ||
            b.id.toLowerCase().includes(searchVal)
        )
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 40px; color: var(--text-secondary);"><i class="fa-regular fa-folder-open" style="font-size: 24px; margin-bottom: 8px; display: block; text-align: center;"></i><p style="text-align: center; margin: 0;">No past builds match your search.</p></td></tr>`;
        return;
    }

    filtered.forEach(b => {
        tbody.innerHTML += `
            <tr class="clickable-row" onclick="openBuildDetails('${b.id}')">
                <td><strong class="text-glow" style="color: var(--accent); font-family: monospace;">${b.id}</strong></td>
                <td><span style="font-weight: 600;">${b.customerName}</span></td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: var(--text-secondary);" title="${b.specs}">${b.specs}</td>
                <td><span style="font-size: 13px;">${b.welderName}</span></td>
                <td><span style="font-size: 13px; color: var(--success); font-weight: 600;">${b.released || b.target}</span></td>
                <td><span style="font-weight: 600; color: var(--success);">₱${b.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></td>
                <td class="table-actions-cell" style="text-align: right;">
                    <button class="btn-icon" onclick="event.stopPropagation(); openFormModal('modal-build', '${b.id}')" title="Edit Build Specs" style="margin-right: 6px;"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button class="btn-icon delete" onclick="event.stopPropagation(); deleteItem('build', '${b.id}')" title="Delete Build"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });
}

// 5. Repairs Log Table
function renderRepairsTable() {
    const tbody = document.getElementById('repairs-table-body');
    const searchVal = document.getElementById('search-repairs').value.toLowerCase();
    tbody.innerHTML = '';

    const filtered = state.repairs.filter(r =>
        r.customerName.toLowerCase().includes(searchVal) ||
        r.item.toLowerCase().includes(searchVal) ||
        r.issue.toLowerCase().includes(searchVal)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No repairs log records found.</td></tr>`;
        return;
    }

    filtered.forEach(r => {
        let badgeClass = 'badge-info';
        let statusText = r.status;
        if (r.status === 'Received') badgeClass = 'badge-danger';
        else if (r.status === 'Inspecting') badgeClass = 'badge-warning';
        else if (r.status === 'In Progress') badgeClass = 'badge-info';
        else if (r.status === 'Completed') {
            if (r.released) {
                badgeClass = 'badge-success';
                statusText = 'Released';
            } else {
                badgeClass = 'badge-warning';
                statusText = 'Ready to Release';
            }
        }

        let releaseBtn = '';
        if (r.status === 'Completed' && !r.released) {
            releaseBtn = `<button class="btn-icon release" onclick="releaseRepairUnit('${r.id}')" title="Release Unit" style="margin-right: 6px;"><i class="fa-solid fa-circle-check"></i></button>`;
        }

        tbody.innerHTML += `
            <tr>
                <td><strong>${r.id}</strong></td>
                <td>${r.customerName}</td>
                <td>${r.item}</td>
                <td title="${r.issue}">${r.issue.substring(0, 50)}${r.issue.length > 50 ? '...' : ''}</td>
                <td><span class="badge ${badgeClass}">${statusText}</span></td>
                <td>₱${r.cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>${r.welderName}</td>
                <td>
                    <div class="table-actions-cell">
                        ${releaseBtn}
                        <button class="btn-icon" onclick="openFormModal('modal-repair', '${r.id}')" title="Edit Repair Status"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-icon delete" onclick="deleteItem('repair', '${r.id}')" title="Delete Repair Record"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

// 6. Welding Jobs Log Table (Independent)
function renderWeldingJobsTable() {
    const tbody = document.getElementById('welding-table-body');
    if (!tbody) return;
    const searchVal = document.getElementById('search-welding').value.toLowerCase();
    tbody.innerHTML = '';

    const filtered = state.weldingJobs.filter(w =>
        (w.welderName || '').toLowerCase().includes(searchVal) ||
        (w.desc || '').toLowerCase().includes(searchVal) ||
        (w.id || '').toLowerCase().includes(searchVal)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No welding jobs logged.</td></tr>`;
        return;
    }

    filtered.forEach(w => {
        tbody.innerHTML += `
            <tr>
                <td><strong>${w.id}</strong></td>
                <td>${w.date}</td>
                <td>${w.desc}</td>
                <td>${w.welderName}</td>
                <td>₱${(w.cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>
                    <div class="table-actions-cell">
                        <button class="btn-icon" onclick="openFormModal('modal-welding', '${w.id}')" title="Edit Welding Job"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-icon delete" onclick="deleteItem('welding', '${w.id}')" title="Delete Welding Job"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}



function renderWeldersTable() {
    const tbody = document.getElementById('welders-table-body');
    if (!tbody) return;
    const searchInput = document.getElementById('search-welders');
    const searchVal = searchInput ? searchInput.value.toLowerCase() : '';
    tbody.innerHTML = '';

    const filtered = state.welders.filter(w =>
        w.name.toLowerCase().includes(searchVal) ||
        w.spec.toLowerCase().includes(searchVal)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No employee listings found.</td></tr>`;
        return;
    }

    filtered.forEach(w => {
        if (!w.jobs) w.jobs = [];

        // Sum unpaid labor cost
        const unpaidJobs = w.jobs.filter(j => j.status === 'Unpaid');
        const totalUnpaid = unpaidJobs.reduce((sum, j) => sum + j.amount, 0);

        // Payout status
        const unpaidCount = unpaidJobs.length;
        const statusLabel = unpaidCount > 0 ? 'Unpaid' : 'Paid';
        const badgeClass = unpaidCount > 0 ? 'badge-warning' : 'badge-success';

        tbody.innerHTML += `
            <tr class="clickable-row">
                <td onclick="openWelderJobsModal('${w.id}')"><strong>${w.id}</strong></td>
                <td onclick="openWelderJobsModal('${w.id}')"><strong>${w.name}</strong></td>
                <td onclick="openWelderJobsModal('${w.id}')">${w.spec}</td>
                <td onclick="openWelderJobsModal('${w.id}')" style="font-weight: 700; color: ${totalUnpaid > 0 ? 'var(--warning)' : 'var(--success)'}">₱${totalUnpaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td onclick="openWelderJobsModal('${w.id}')"><span class="badge ${badgeClass}">${statusLabel}</span></td>
                <td>
                    <div class="table-actions-cell">
                        <button class="btn-icon" onclick="openWelderJobsModal('${w.id}')" title="Manage Work Log"><i class="fa-solid fa-list-check"></i></button>
                        <button class="btn-icon" onclick="openFormModal('modal-welder', '${w.id}')" title="Edit Specs"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-icon delete" onclick="deleteItem('welder', '${w.id}')" title="Delete Employee"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

// 8. Gallery Cards (Admin)
function renderGalleryCardsAdmin() {
    const container = document.getElementById('gallery-cards-container');
    if (!container) return;
    const searchVal = document.getElementById('search-gallery').value.toLowerCase();
    container.innerHTML = '';

    const filtered = state.gallery.filter(g =>
        g.title.toLowerCase().includes(searchVal) ||
        g.desc.toLowerCase().includes(searchVal) ||
        g.category.toLowerCase().includes(searchVal) ||
        g.id.toLowerCase().includes(searchVal)
    );

    if (filtered.length === 0) {
        container.innerHTML = `<div class="gallery-placeholder" style="grid-column: 1/-1; padding: 40px;"><i class="fa-regular fa-folder-open"></i><p>No gallery items match your search.</p></div>`;
        return;
    }

    filtered.forEach(g => {
        let imgTag = `
            <div class="build-card-img-placeholder">
                <i class="fa-regular fa-image"></i>
                <p>No picture uploaded</p>
            </div>
        `;

        if (g.image) {
            imgTag = `<img src="${g.image}" alt="${g.title}" class="build-card-img">`;
        }

        container.innerHTML += `
            <div class="build-card-admin">
                <div class="build-card-img-wrapper">
                    ${imgTag}
                </div>
                <div class="build-card-body">
                    <div class="build-card-client-info">
                        <span class="gallery-category">${g.category}</span>
                        <h4>${g.title}</h4>
                        <p>Gallery Reference: <strong>${g.id}</strong></p>
                    </div>
                    <div class="build-card-specs" title="${g.desc}">
                        ${g.desc.substring(0, 80)}${g.desc.length > 80 ? '...' : ''}
                    </div>
                    <div class="build-card-footer" style="margin-top: auto;">
                        <div class="table-actions-cell" style="width: 100%; justify-content: flex-end;">
                            <button class="btn-icon" onclick="openFormModal('modal-gallery', '${g.id}')" title="Edit Gallery Item"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="btn-icon delete" onclick="deleteItem('gallery', '${g.id}')" title="Delete Gallery Item"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
}


// 8b. Materials Catalog Table & Helpers
function populateFilterCategoriesDropdown() {
    const filterSelect = document.getElementById('filter-materials-category');
    if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">All Categories</option>';
        const activeCategories = state.materialCategories.filter(cat => cat.isActive);
        activeCategories.forEach(cat => {
            filterSelect.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
        });
    }
}

function renderMaterialsTable() {
    const tbody = document.getElementById('materials-table-body');
    if (!tbody) return;

    const searchVal = document.getElementById('search-materials') ? document.getElementById('search-materials').value.toLowerCase().trim() : '';
    const filterCat = document.getElementById('filter-materials-category') ? document.getElementById('filter-materials-category').value : 'all';
    const filterStatus = document.getElementById('filter-materials-status') ? document.getElementById('filter-materials-status').value : 'active';
    const sortVal = document.getElementById('sort-materials') ? document.getElementById('sort-materials').value : 'date-desc';

    // 1. Filter out completely soft-deleted materials
    let filtered = state.materials.filter(m => !m.deleted_at);

    // 2. Filter by search value (Name, Unit, Description, SKU)
    if (searchVal) {
        filtered = filtered.filter(m => 
            m.name.toLowerCase().includes(searchVal) ||
            m.unit.toLowerCase().includes(searchVal) ||
            (m.description || '').toLowerCase().includes(searchVal) ||
            (m.sku || '').toLowerCase().includes(searchVal)
        );
    }

    // 3. Filter by Category
    if (filterCat !== 'all') {
        filtered = filtered.filter(m => m.categoryId === filterCat);
    }

    // 4. Filter by Status (Active/Inactive/All)
    if (filterStatus === 'active') {
        filtered = filtered.filter(m => m.isActive === true);
    } else if (filterStatus === 'inactive') {
        filtered = filtered.filter(m => m.isActive === false);
    }

    // 5. Sort Materials
    filtered.sort((a, b) => {
        if (sortVal === 'name-asc') {
            return a.name.localeCompare(b.name);
        } else if (sortVal === 'name-desc') {
            return b.name.localeCompare(a.name);
        } else if (sortVal === 'category-asc') {
            const nameA = getCategoryName(a.categoryId);
            const nameB = getCategoryName(b.categoryId);
            return nameA.localeCompare(nameB);
        } else if (sortVal === 'date-asc') {
            return new Date(a.created_at || 0) - new Date(b.created_at || 0);
        } else { // 'date-desc'
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        }
    });

    // 6. Pagination Logic (10 items per page)
    const itemsPerPage = 10;
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    // Clamp current page to valid range
    if (state.materialsCurrentPage > totalPages) {
        state.materialsCurrentPage = totalPages;
    }
    if (state.materialsCurrentPage < 1) {
        state.materialsCurrentPage = 1;
    }

    const startIdx = (state.materialsCurrentPage - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const paginated = filtered.slice(startIdx, endIdx);

    // Update Pagination UI
    const paginationInfo = document.getElementById('materials-pagination-info');
    if (paginationInfo) {
        if (totalItems === 0) {
            paginationInfo.textContent = 'Showing 0-0 of 0 materials';
        } else {
            const showTo = Math.min(endIdx, totalItems);
            paginationInfo.textContent = `Showing ${startIdx + 1}-${showTo} of ${totalItems} materials (Page ${state.materialsCurrentPage} of ${totalPages})`;
        }
    }

    const btnPrev = document.getElementById('btn-materials-prev');
    const btnNext = document.getElementById('btn-materials-next');
    if (btnPrev) btnPrev.disabled = state.materialsCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.materialsCurrentPage >= totalPages;

    // 7. Render Rows
    tbody.innerHTML = '';
    if (paginated.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No materials found.</td></tr>';
        return;
    }

    paginated.forEach(m => {
        const categoryName = getCategoryName(m.categoryId);
        const lastUpdated = m.updated_at ? m.updated_at.split('T')[0] : (m.created_at ? m.created_at.split('T')[0] : 'N/A');
        const statusBadgeClass = m.isActive ? 'badge-success' : 'badge-danger';
        const statusText = m.isActive ? 'Active' : 'Inactive';

        const editBtn = `<button class="btn-icon" onclick="event.stopPropagation(); openFormModal('modal-material', '${m.id}')" title="Edit Material"><i class="fa-solid fa-pen-to-square"></i></button>`;
        const deleteBtn = `<button class="btn-icon delete" onclick="event.stopPropagation(); deleteItem('material', '${m.id}')" title="Delete Material"><i class="fa-solid fa-trash"></i></button>`;

        tbody.innerHTML += `
            <tr>
                <td><strong class="text-glow" style="color: var(--accent); font-family: monospace;">${m.id}</strong></td>
                <td><span style="font-weight: 600;">${m.name}</span></td>
                <td><span style="font-size: 13px; color: var(--text-secondary);">${categoryName}</span></td>
                <td><span style="font-family: monospace; font-size: 13px;">${m.unit}</span></td>
                <td><span class="badge ${statusBadgeClass}">${statusText}</span></td>
                <td><span style="font-size: 13px; color: var(--text-muted);">${lastUpdated}</span></td>
                <td>
                    <div class="table-actions-cell" style="text-align: right;">
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
    });
}

function getCategoryName(catId) {
    const cat = state.materialCategories.find(x => x.id === catId);
    return cat ? cat.name : 'Unknown';
}


// 8c. Product Templates, Variants and BOM Rendering Logics
function populateTemplatesCategoryFilter() {
    const filterSelect = document.getElementById('filter-templates-category');
    if (filterSelect) {
        filterSelect.innerHTML = '<option value="all">All Categories</option>';
        const activeCats = state.productCategories.filter(cat => cat.isActive);
        activeCats.forEach(cat => {
            filterSelect.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
        });
    }
}

function renderTemplatesGrid() {
    const grid = document.getElementById('templates-grid');
    if (!grid) return;

    const searchVal = document.getElementById('search-templates') ? document.getElementById('search-templates').value.toLowerCase().trim() : '';
    const filterCat = document.getElementById('filter-templates-category') ? document.getElementById('filter-templates-category').value : 'all';
    const filterStatus = document.getElementById('filter-templates-status') ? document.getElementById('filter-templates-status').value : 'active';

    // 1. Filter out completely soft-deleted templates
    let filtered = state.productTemplates.filter(t => !t.deleted_at);

    // 2. Filter by search value (Product Name, Description)
    if (searchVal) {
        filtered = filtered.filter(t => 
            t.name.toLowerCase().includes(searchVal) ||
            (t.description || '').toLowerCase().includes(searchVal)
        );
    }

    // 3. Filter by Category
    if (filterCat !== 'all') {
        filtered = filtered.filter(t => t.categoryId === filterCat);
    }

    // 4. Filter by Status (Active/Inactive/All)
    if (filterStatus === 'active') {
        filtered = filtered.filter(t => t.isActive === true);
    } else if (filterStatus === 'inactive') {
        filtered = filtered.filter(t => t.isActive === false);
    }

    // 5. Pagination Logic (6 items per page)
    const itemsPerPage = 6;
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

    if (state.templatesCurrentPage > totalPages) {
        state.templatesCurrentPage = totalPages;
    }
    if (state.templatesCurrentPage < 1) {
        state.templatesCurrentPage = 1;
    }

    const startIdx = (state.templatesCurrentPage - 1) * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const paginated = filtered.slice(startIdx, endIdx);

    // Update Pagination UI
    const paginationInfo = document.getElementById('templates-pagination-info');
    if (paginationInfo) {
        if (totalItems === 0) {
            paginationInfo.textContent = 'Showing 0-0 of 0 templates';
        } else {
            const showTo = Math.min(endIdx, totalItems);
            paginationInfo.textContent = `Showing ${startIdx + 1}-${showTo} of ${totalItems} templates (Page ${state.templatesCurrentPage} of ${totalPages})`;
        }
    }

    const btnPrev = document.getElementById('btn-templates-prev');
    const btnNext = document.getElementById('btn-templates-next');
    if (btnPrev) btnPrev.disabled = state.templatesCurrentPage <= 1;
    if (btnNext) btnNext.disabled = state.templatesCurrentPage >= totalPages;

    // 6. Render Cards
    grid.innerHTML = '';
    if (paginated.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;"><i class="fa-regular fa-folder-open" style="font-size: 32px; display: block; margin-bottom: 12px;"></i> No templates found.</div>';
        return;
    }

    paginated.forEach(t => {
        const cat = state.productCategories.find(c => c.id === t.categoryId);
        const categoryName = cat ? cat.name : 'Unknown Category';
        const variants = state.productVariants.filter(v => v.templateId === t.id && !v.deleted_at);
        const variantsCount = variants.length;
        const variantListText = variantsCount > 0 ? variants.map(v => v.name).join(', ') : 'No variants configured';

        const defVar = variants.find(v => v.isDefault) || variants[0];
        const estLaborText = defVar ? `${defVar.estimatedLaborHours || 0} hrs` : '--';
        const versionText = defVar ? `v${defVar.version || '1.0'}` : 'v1.0';

        const statusBadgeClass = t.isActive ? 'badge-success' : 'badge-danger';
        const statusText = t.isActive ? 'Active' : 'Inactive';

        const fallbackImg = 'sidecar_classic.png';
        const cardImg = t.imageUrl || fallbackImg;

        grid.innerHTML += `
            <div class="build-card-admin" style="display: flex; flex-direction: column; height: 100%;">
                <div class="build-card-img-wrapper" style="height: 150px; background: rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative;">
                    <img src="${cardImg}" alt="${t.name}" style="max-height: 100%; max-width: 100%; object-fit: contain;">
                    <span class="badge ${statusBadgeClass}" style="position: absolute; top: 10px; right: 10px;">${statusText}</span>
                </div>
                <div class="build-card-body" style="padding: 16px; display: flex; flex-direction: column; flex-grow: 1; gap: 8px;">
                    <div style="margin-bottom: 4px;">
                        <span style="font-size: 11px; text-transform: uppercase; color: var(--accent); letter-spacing: 0.5px; font-weight: 700;">${categoryName}</span>
                        <h4 style="margin: 4px 0 0 0; font-size: 16px; font-weight: 700; color: var(--text-primary);">${t.name}</h4>
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; height: 34px;">
                        ${t.description || 'No description provided.'}
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px; margin-top: 4px; font-size: 12px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: var(--text-muted);">Variants (${variantsCount}):</span>
                            <span style="font-weight: 600; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;" title="${variantListText}">${variantListText}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: var(--text-muted);">Version:</span>
                            <span style="font-weight: 600;">${versionText}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: var(--text-muted);">Est. Labor:</span>
                            <span style="font-weight: 600;">${estLaborText}</span>
                        </div>
                    </div>
                    <div style="margin-top: auto; padding-top: 12px; display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-block btn-sm" onclick="openTemplateDetailsModal('${t.id}')" style="justify-content: center;"><i class="fa-solid fa-list-check"></i> View Details & BOM</button>
                    </div>
                </div>
            </div>
        `;
    });
}

async function refreshVariantDropdown(templateId, activeVariantId = '') {
    const select = document.getElementById('detail-variant-select');
    if (!select) return;

    select.innerHTML = '';
    const variants = state.productVariants.filter(v => v.templateId === templateId && !v.deleted_at);
    
    if (variants.length === 0) {
        select.innerHTML = '<option value="">No variants configured</option>';
        return;
    }

    variants.forEach(v => {
        const isDefaultLabel = v.isDefault ? ' (Default)' : '';
        const selectedAttr = (activeVariantId === v.id || (!activeVariantId && v.isDefault)) ? 'selected' : '';
        select.innerHTML += `<option value="${v.id}" ${selectedAttr}>${v.name}${isDefaultLabel}</option>`;
    });
}

function openTemplateDetailsModal(templateId, activeVariantId = '') {
    state.activeTemplateId = templateId;
    const template = state.productTemplates.find(x => x.id === templateId);
    if (!template) return;

    document.getElementById('form-variant').reset();
    document.getElementById('form-variant').style.display = 'none';
    document.getElementById('btn-add-variant-toggle').style.display = 'inline-block';
    document.getElementById('variant-info-display').style.display = 'flex';
    
    document.getElementById('form-bom-item').reset();
    document.getElementById('form-bom-item').style.display = 'none';
    document.getElementById('btn-add-bom-item-toggle').style.display = 'inline-block';

    const cat = state.productCategories.find(c => c.id === template.categoryId);
    document.getElementById('detail-template-img').src = template.imageUrl || 'sidecar_classic.png';
    document.getElementById('detail-template-name').textContent = template.name;
    document.getElementById('detail-template-category').textContent = cat ? cat.name : 'Unknown';
    document.getElementById('detail-template-desc').textContent = template.description || 'No description.';

    const btnEditMeta = document.getElementById('btn-edit-template-meta');
    const btnDelete = document.getElementById('btn-delete-template');
    if (btnEditMeta) {
        btnEditMeta.onclick = () => openFormModal('modal-template', templateId);
    }
    if (btnDelete) {
        btnDelete.onclick = () => deleteItem('template', templateId);
    }

    const variants = state.productVariants.filter(v => v.templateId === templateId && !v.deleted_at);
    
    let finalVarId = activeVariantId;
    if (!finalVarId && variants.length > 0) {
        const defVar = variants.find(v => v.isDefault) || variants[0];
        finalVarId = defVar.id;
    }
    
    refreshVariantDropdown(templateId, finalVarId);
    loadVariantDetailsAndBom(finalVarId);

    const modal = document.getElementById('modal-template-details');
    modal.classList.add('active');
}

function loadVariantDetailsAndBom(variantId) {
    const varInfoDisplay = document.getElementById('variant-info-display');
    const bomTableBody = document.getElementById('bom-table-body');
    if (!varInfoDisplay || !bomTableBody) return;

    if (!variantId) {
        varInfoDisplay.innerHTML = '<p style="font-size: 13px; color: var(--text-muted); font-style: italic; padding: 12px 0;">No variants configured for this product yet. Click "+ Add Variant" to create one.</p>';
        bomTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Please add a product variant first.</td></tr>';
        
        document.getElementById('summary-unique-materials').textContent = '0';
        document.getElementById('summary-total-qty').textContent = '0 Items';
        document.getElementById('summary-labor-hours').textContent = '0 hrs';
        document.getElementById('summary-selling-price').textContent = '₱0.00';
        document.getElementById('summary-bom-status').textContent = 'Inactive';
        document.getElementById('summary-bom-status').className = 'badge badge-danger';
        return;
    }

    const variant = state.productVariants.find(v => v.id === variantId);
    if (!variant) return;

    document.getElementById('var-display-version').textContent = variant.version || '1.0';
    document.getElementById('var-display-code').textContent = variant.code || '-';
    document.getElementById('var-display-material').textContent = variant.materialType || '-';
    
    const dims = [variant.length, variant.width, variant.height].filter(Boolean).join(' x ');
    document.getElementById('var-display-dims').textContent = dims || '-';
    document.getElementById('var-display-weight').textContent = variant.weight || '-';
    document.getElementById('var-display-changelog').textContent = variant.changeLog || 'Initial release.';

    document.getElementById('btn-edit-variant').onclick = () => {
        document.getElementById('variant-form-title').textContent = 'Edit Variant';
        document.getElementById('variant-id').value = variant.id;
        document.getElementById('variant-name').value = variant.name;
        document.getElementById('variant-code').value = variant.code;
        document.getElementById('variant-material-type').value = variant.materialType;
        document.getElementById('variant-price').value = variant.sellingPrice;
        document.getElementById('variant-labor').value = variant.estimatedLaborHours;
        document.getElementById('variant-version').value = variant.version;
        document.getElementById('variant-changelog').value = variant.changeLog || '';
        document.getElementById('variant-length').value = variant.length || '';
        document.getElementById('variant-width').value = variant.width || '';
        document.getElementById('variant-height').value = variant.height || '';
        document.getElementById('variant-weight').value = variant.weight || '';
        document.getElementById('variant-is-default').checked = variant.isDefault;
        document.getElementById('variant-is-active').checked = variant.isActive;

        document.getElementById('form-variant').style.display = 'block';
        document.getElementById('variant-info-display').style.display = 'none';
        document.getElementById('btn-add-variant-toggle').style.display = 'none';
    };

    document.getElementById('btn-delete-variant').onclick = () => {
        deleteItem('variant', variant.id);
    };

    renderBomTable(variantId);
}

function renderBomTable(variantId) {
    const tbody = document.getElementById('bom-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const boms = state.productVariantMaterials
        .filter(b => b.variantId === variantId)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    const uniqueMaterialsCount = boms.length;
    const totalQty = boms.reduce((sum, b) => sum + (b.quantity || 0), 0);
    
    const variant = state.productVariants.find(v => v.id === variantId);
    
    document.getElementById('summary-unique-materials').textContent = uniqueMaterialsCount;
    document.getElementById('summary-total-qty').textContent = `${totalQty} Items`;
    document.getElementById('summary-labor-hours').textContent = `${variant ? variant.estimatedLaborHours : 0} hrs`;
    document.getElementById('summary-selling-price').textContent = variant ? `₱${variant.sellingPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '₱0.00';
    
    const bomStatusBadge = document.getElementById('summary-bom-status');
    const isBomActive = uniqueMaterialsCount > 0 && (variant && variant.isActive);
    if (isBomActive) {
        bomStatusBadge.textContent = 'Active';
        bomStatusBadge.className = 'badge badge-success';
    } else {
        bomStatusBadge.textContent = uniqueMaterialsCount === 0 ? 'No BOM items' : 'Inactive';
        bomStatusBadge.className = 'badge badge-danger';
    }

    if (boms.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 12px;">No materials added to this Bill of Materials. Click "+ Add Material" to begin.</td></tr>';
        return;
    }

    boms.forEach((b, idx) => {
        const material = state.materials.find(m => m.id === b.materialId);
        if (!material) return;
        const categoryName = getCategoryName(material.categoryId);
        const lastUpdated = b.updated_at ? b.updated_at.split('T')[0] : (b.created_at ? b.created_at.split('T')[0] : 'N/A');

        const isFirst = idx === 0;
        const isLast = idx === boms.length - 1;

        const upBtn = `<button type="button" class="btn-icon" onclick="event.stopPropagation(); moveBomItem('${b.id}', 'up')" ${isFirst ? 'disabled style="opacity: 0.3; cursor: default;"' : ''} title="Move Up"><i class="fa-solid fa-chevron-up"></i></button>`;
        const downBtn = `<button type="button" class="btn-icon" onclick="event.stopPropagation(); moveBomItem('${b.id}', 'down')" ${isLast ? 'disabled style="opacity: 0.3; cursor: default;"' : ''} title="Move Down"><i class="fa-solid fa-chevron-down"></i></button>`;
        
        const editBtn = `<button type="button" class="btn-icon" onclick="event.stopPropagation(); openEditBomItemForm('${b.id}')" title="Edit BOM Material"><i class="fa-solid fa-pen-to-square"></i></button>`;
        const deleteBtn = `<button type="button" class="btn-icon delete" onclick="event.stopPropagation(); deleteItem('bom_item', '${b.id}')" title="Remove BOM Material"><i class="fa-solid fa-trash"></i></button>`;

        tbody.innerHTML += `
            <tr>
                <td><span style="font-family: monospace; font-size: 12px; color: var(--text-muted);">${idx + 1}</span></td>
                <td><span style="font-weight: 600; color: var(--text-primary);">${material.name}</span></td>
                <td><span style="font-size: 12px; color: var(--text-secondary);">${categoryName}</span></td>
                <td><span style="font-family: monospace; font-size: 12px;">${material.unit}</span></td>
                <td><strong style="color: var(--accent);">${b.quantity}</strong></td>
                <td><span style="font-size: 12px; color: var(--text-secondary);">${b.remarks || '-'}</span></td>
                <td>
                    <div class="table-actions-cell" style="justify-content: flex-end; gap: 4px;">
                        ${upBtn}
                        ${downBtn}
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                </td>
            </tr>
        `;
    });
}

function openEditBomItemForm(bomId) {
    const bom = state.productVariantMaterials.find(x => x.id === bomId);
    if (!bom) return;

    populateActiveMaterialsDropdown();

    document.getElementById('bom-form-title').textContent = 'Edit BOM Material';
    document.getElementById('bom-id').value = bom.id;
    document.getElementById('bom-material').value = bom.materialId;
    document.getElementById('bom-qty').value = bom.quantity;
    document.getElementById('bom-remarks').value = bom.remarks || '';
    document.getElementById('bom-sort-order').value = bom.sortOrder || 0;

    document.getElementById('form-bom-item').style.display = 'block';
    document.getElementById('btn-add-bom-item-toggle').style.display = 'none';
}

function populateActiveMaterialsDropdown() {
    const select = document.getElementById('bom-material');
    if (!select) return;

    select.innerHTML = '<option value="" disabled selected>Select Material</option>';
    const activeMaterials = state.materials.filter(m => m.isActive && !m.deleted_at);
    activeMaterials.forEach(m => {
        select.innerHTML += `<option value="${m.id}">${m.name} (${m.unit})</option>`;
    });
}

function renderAnalyticsChart() {
    const canvas = document.getElementById('analytics-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High-DPI canvas scaling
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = 200 * dpr; // Force stable height
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = 200;

    const paddingLeft = 55;
    const paddingRight = 20;
    const paddingTop = 25;
    const paddingBottom = 30;
    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    // Monthly baseline data simulation (Feb to Jul 2026)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const BASELINES = {
        0: 25000,  // Jan
        1: 32000,  // Feb
        2: 44000,  // Mar
        3: 38000,  // Apr
        4: 51000,  // May
        5: 58000,  // Jun
        6: 62000,  // Jul
        7: 64000,  // Aug
        8: 60000,  // Sep
        9: 68000,  // Oct
        10: 75000, // Nov
        11: 90000  // Dec
    };

    const today = new Date();
    const months = [];

    // Construct months list starting from July 2026 (creation date) up to the current month
    const startYear = 2026;
    const startMonth = 6; // July
    const curYear = today.getFullYear();
    const curMonthIndex = today.getMonth();

    // Total months since website launch (July 2026)
    const totalMonths = Math.max(1, (curYear - startYear) * 12 + (curMonthIndex - startMonth) + 1);

    for (let i = 0; i < totalMonths; i++) {
        const d = new Date(startYear, startMonth + i, 1);
        const mIdx = d.getMonth();
        const yearSuffix = String(d.getFullYear()).slice(-2);
        months.push({
            name: `${monthNames[mIdx]} '${yearSuffix}`,
            year: d.getFullYear(),
            monthIndex: mIdx,
            revenue: 0 // Reset to 0 to only accumulate actual shop income
        });
    }

    // Add dynamic revenue from active state
    // 1. Builds starting in that month
    state.builds.forEach(b => {
        if (b.start) {
            const d = new Date(b.start);
            if (!isNaN(d.getTime())) {
                months.forEach(m => {
                    if (d.getMonth() === m.monthIndex && d.getFullYear() === m.year) {
                        m.revenue += b.cost;
                    }
                });
            }
        }
    });

    // 2. Repairs (accrue active to July 2026, completed to their released month)
    state.repairs.forEach(r => {
        if (r.status === 'Completed' || r.released) {
            const dateStr = r.released;
            if (dateStr) {
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) {
                    months.forEach(m => {
                        if (d.getMonth() === m.monthIndex && d.getFullYear() === m.year) {
                            m.revenue += r.cost;
                        }
                    });
                }
            }
        } else {
            // Active/In Progress repairs accrue to current month (July 2026, index 6)
            months.forEach(m => {
                if (m.monthIndex === 6 && m.year === 2026) { // July 2026
                    m.revenue += r.cost;
                }
            });
        }
    });

    // 3. Welding Jobs completed in that month
    state.weldingJobs.forEach(w => {
        if (w.date) {
            const d = new Date(w.date);
            if (!isNaN(d.getTime())) {
                months.forEach(m => {
                    if (d.getMonth() === m.monthIndex && d.getFullYear() === m.year) {
                        m.revenue += w.cost;
                    }
                });
            }
        }
    });

    // Calculate maximum revenue for dynamic Y-scaling
    const maxVal = Math.max(...months.map(m => m.revenue)) * 1.15 || 10000;

    // Draw horizontal grid lines and Y-axis labels
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#8b9bb4'; // text muted
    ctx.font = '500 10px var(--font-body)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
        const val = (maxVal / gridCount) * i;
        const y = paddingTop + chartHeight - (val / maxVal) * chartHeight;

        // Gridline
        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(width - paddingRight, y);
        ctx.stroke();

        // Label
        ctx.fillText(`₱${Math.round(val / 1000)}k`, paddingLeft - 10, y);
    }

    // Draw X-axis month labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xCoords = [];
    months.forEach((m, idx) => {
        const x = months.length === 1 
            ? paddingLeft + chartWidth / 2 
            : paddingLeft + (idx / (months.length - 1)) * chartWidth;
        xCoords.push(x);
        if (width > 600 || idx % 2 === 0) {
            ctx.fillText(m.name, x, height - paddingBottom + 8);
        }
    });

    // Map month data points to grid coordinates
    const points = months.map((m, idx) => {
        const x = xCoords[idx];
        const y = paddingTop + chartHeight - (m.revenue / maxVal) * chartHeight;
        return { x, y };
    });

    // Render smooth gradient fill area under the line
    const areaGrad = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + chartHeight);
    areaGrad.addColorStop(0, 'rgba(255, 107, 0, 0.22)');
    areaGrad.addColorStop(1, 'rgba(255, 107, 0, 0.00)');

    ctx.beginPath();
    ctx.moveTo(points[0].x, paddingTop + chartHeight);
    ctx.lineTo(points[0].x, points[0].y);
    if (points.length > 1) {
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const cpX1 = p0.x + (p1.x - p0.x) / 2;
            const cpY1 = p0.y;
            const cpX2 = p0.x + (p1.x - p0.x) / 2;
            const cpY2 = p1.y;
            ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, p1.x, p1.y);
        }
    }
    ctx.lineTo(points[points.length - 1].x, paddingTop + chartHeight);
    ctx.closePath();
    ctx.fillStyle = areaGrad;
    ctx.fill();

    // Render smooth glowing path line
    if (points.length > 1) {
        ctx.strokeStyle = '#ff6b00'; // Welding orange accent
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const cpX1 = p0.x + (p1.x - p0.x) / 2;
            const cpY1 = p0.y;
            const cpX2 = p0.x + (p1.x - p0.x) / 2;
            const cpY2 = p1.y;
            ctx.bezierCurveTo(cpX1, cpY1, cpX2, cpY2, p1.x, p1.y);
        }
        ctx.stroke();
    }

    // Render coordinate circle marks
    points.forEach((p, idx) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ff8533';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#f5f6f7';
        ctx.stroke();
    });

    // Compute trend badge metrics (current vs previous month)
    const trendBadge = document.getElementById('analytics-trend-badge');
    if (trendBadge) {
        if (months.length > 1) {
            const curMonth = months[months.length - 1];
            const prevMonth = months[months.length - 2];
            const diff = curMonth.revenue - prevMonth.revenue;
            const pct = prevMonth.revenue > 0 ? (diff / prevMonth.revenue * 100) : 0;
            
            if (diff >= 0) {
                trendBadge.className = 'trend-badge up';
                trendBadge.innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i> +${pct.toFixed(1)}% Upward Trend`;
            } else {
                trendBadge.className = 'trend-badge down';
                trendBadge.innerHTML = `<i class="fa-solid fa-arrow-trend-down"></i> ${pct.toFixed(1)}% Downward Trend`;
            }
        } else {
            // Inception month
            trendBadge.className = 'trend-badge up';
            trendBadge.innerHTML = `<i class="fa-solid fa-rocket"></i> Initial Month`;
        }
    }
}


/* ==========================================================================
   SEARCH DISPATCH LISTENERS
   ========================================================================== */

const searchCust = document.getElementById('search-customers');
if (searchCust) searchCust.addEventListener('input', renderCustomersTable);

const searchBuilds = document.getElementById('search-builds');
if (searchBuilds) searchBuilds.addEventListener('input', renderBuildsCards);

const searchPastBuilds = document.getElementById('search-past-builds');
if (searchPastBuilds) searchPastBuilds.addEventListener('input', renderPastBuildsCards);

const searchRepairs = document.getElementById('search-repairs');
if (searchRepairs) searchRepairs.addEventListener('input', renderRepairsTable);
const searchWelding = document.getElementById('search-welding');
if (searchWelding) searchWelding.addEventListener('input', renderWeldingJobsTable);
const searchWelders = document.getElementById('search-welders');
if (searchWelders) searchWelders.addEventListener('input', renderWeldersTable);

const searchVales = document.getElementById('search-vales');
if (searchVales) searchVales.addEventListener('input', renderVales);

const searchHistory = document.getElementById('search-payroll-history');
if (searchHistory) searchHistory.addEventListener('input', renderPayrollHistory);

const searchGallery = document.getElementById('search-gallery');
if (searchGallery) searchGallery.addEventListener('input', renderGalleryCardsAdmin);

// Shortcut View-All actions from Overview widgets
const btnAllBuilds = document.getElementById('btn-view-all-builds');
if (btnAllBuilds) btnAllBuilds.addEventListener('click', () => switchDashboardTab('tab-builds'));

const btnAllLabor = document.getElementById('btn-view-all-labor');
if (btnAllLabor) btnAllLabor.addEventListener('click', () => switchDashboardTab('tab-welders'));


/* ==========================================================================
   PUBLIC VISITOR GALLERY RENDER
   ========================================================================== */

function renderVisitorGallery() {
    const galleryGrid = document.getElementById('visitor-gallery-grid');
    if (!galleryGrid) return;
    galleryGrid.innerHTML = '';

    if (state.gallery.length === 0) {
        galleryGrid.innerHTML = `
            <div class="gallery-placeholder" style="grid-column: 1/-1; padding: 40px; text-align: center;">
                <i class="fa-regular fa-images" style="font-size: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
                <p>No gallery projects uploaded yet.</p>
            </div>
        `;
        return;
    }

    state.gallery.forEach(p => {
        let imgTag = `
            <div class="gallery-placeholder">
                <i class="fa-solid fa-motorcycle"></i>
                <span>JMR Custom Project</span>
            </div>
        `;
        if (p.image) {
            imgTag = `<img src="${p.image}" alt="${p.title}" class="gallery-img">`;
        }

        galleryGrid.innerHTML += `
            <div class="gallery-item">
                <div class="gallery-img-wrapper">
                    ${imgTag}
                </div>
                <div class="gallery-details">
                    <span class="gallery-category">${p.category}</span>
                    <h3>${p.title}</h3>
                    <p>${p.desc}</p>
                </div>
            </div>
        `;
    });
}


/* ==========================================================================
   CUSTOMER AUTOMATION & WELDER WORK LOG MANAGEMENT
   ========================================================================== */

function putInOnProcessBuild(custId) {
    const cust = state.customers.find(c => c.id === custId);
    if (!cust) return;

    if (cust.buildStatus === 'On Process') {
        alert("This customer order is already on-process.");
        return;
    }

    const defaultWelder = state.welders[0] || { id: 'WELDER-001', name: 'Dante Rivera' };

    const newId = custId;
    const today = new Date();
    const targetDate = new Date();
    targetDate.setDate(today.getDate() + 30);

    state.builds.push({
        id: newId,
        customerId: custId,
        customerName: cust.name,
        welderId: defaultWelder.id,
        welderName: defaultWelder.name,
        specs: `Standard Sidecar order for ${cust.name}`,
        progress: 0,
        cost: cust.totalAmount,
        start: today.toISOString().split('T')[0],
        target: targetDate.toISOString().split('T')[0],
        image: ''
    });

    cust.buildStatus = 'On Process';
    cust.status = 'Active';

    saveDocToFirestore(COLLECTIONS.BUILDS, state.builds.find(b => b.id === newId));
    saveDocToFirestore(COLLECTIONS.CUSTOMERS, cust);

    renderAllDashboardData();
    switchDashboardTab('tab-builds');
}

let activeWeldingJobCustomerId = '';

function openPutWeldingJobModal(custId) {
    const cust = state.customers.find(c => c.id === custId);
    if (!cust) return;

    activeWeldingJobCustomerId = custId;

    // Open the standard welding jobs form modal
    openFormModal('modal-welding');

    // Pre-populate fields
    document.getElementById('welding-customer').value = cust.name;
    document.getElementById('welding-cost').value = cust.totalAmount;
}

let activeWelderId = '';

function openWelderJobsModal(welderId) {
    const welder = state.welders.find(w => w.id === welderId);
    if (!welder) return;

    activeWelderId = welderId;
    if (!welder.jobs) welder.jobs = [];

    document.getElementById('modal-welder-jobs-title').textContent = `Welder Work Log: ${welder.name}`;
    document.getElementById('welder-job-welder-id').value = welderId;

    resetWelderJobForm();
    renderWelderJobs();

    document.getElementById('modal-welder-jobs').classList.add('active');
}

function resetWelderJobForm() {
    document.getElementById('form-welder-job').reset();
    document.getElementById('welder-job-id').value = '';
    document.getElementById('welder-job-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('form-welder-job-title').textContent = "Add Work Entry";
    document.getElementById('btn-save-welder-job').textContent = "Add Work";
    document.getElementById('btn-cancel-welder-job').style.display = 'none';
}

function renderWelderJobs() {
    const welder = state.welders.find(w => w.id === activeWelderId);
    const tbody = document.getElementById('welder-jobs-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!welder || !welder.jobs || welder.jobs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No work entries logged yet.</td></tr>`;
        return;
    }

    const sortedJobs = [...welder.jobs].sort((a, b) => new Date(b.date) - new Date(a.date));

    sortedJobs.forEach(job => {
        const badgeClass = job.status === 'Paid' ? 'badge-success' : 'badge-warning';

        tbody.innerHTML += `
            <tr>
                <td>${job.date}</td>
                <td style="font-weight: 500; text-align: left;">${job.desc}</td>
                <td>₱${job.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td><span class="badge ${badgeClass}">${job.status}</span></td>
                <td>
                    <div class="table-actions-cell" style="justify-content: flex-end;">
                        <button class="btn-icon btn-sm" onclick="editWelderJob('${job.id}')" title="Edit Entry"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button class="btn-icon btn-sm delete" onclick="deleteWelderJob('${job.id}')" title="Delete Entry"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

// Welder Job Form Submit Listener
const formWelderJob = document.getElementById('form-welder-job');
if (formWelderJob) {
    formWelderJob.addEventListener('submit', (e) => {
        e.preventDefault();
        const welderId = document.getElementById('welder-job-welder-id').value;
        const jobId = document.getElementById('welder-job-id').value;
        const desc = document.getElementById('welder-job-desc').value;
        const amount = parseFloat(document.getElementById('welder-job-amount').value) || 0;
        const date = document.getElementById('welder-job-date').value;
        const status = document.getElementById('welder-job-status').value;

        const welder = state.welders.find(w => w.id === welderId);
        if (!welder) return;

        if (!welder.jobs) welder.jobs = [];

        if (jobId) {
            const jobIdx = welder.jobs.findIndex(j => j.id === jobId);
            if (jobIdx !== -1) {
                welder.jobs[jobIdx] = { ...welder.jobs[jobIdx], desc, amount, date, status };
            }
        } else {
            const newJobId = generateUID('JOB', welder.jobs);
            welder.jobs.push({ id: newJobId, desc, amount, date, status });
        }

        saveDocToFirestore(COLLECTIONS.WELDERS, welder);
        renderWelderJobs();
        resetWelderJobForm();
        renderAllDashboardData();
    });
}

// Edit Welder Job
function editWelderJob(jobId) {
    const welder = state.welders.find(w => w.id === activeWelderId);
    if (!welder || !welder.jobs) return;

    const job = welder.jobs.find(j => j.id === jobId);
    if (!job) return;

    document.getElementById('welder-job-id').value = job.id;
    document.getElementById('welder-job-desc').value = job.desc;
    document.getElementById('welder-job-amount').value = job.amount;
    document.getElementById('welder-job-date').value = job.date;
    document.getElementById('welder-job-status').value = job.status;

    document.getElementById('form-welder-job-title').textContent = "Edit Work Entry";
    document.getElementById('btn-save-welder-job').textContent = "Save Changes";
    document.getElementById('btn-cancel-welder-job').style.display = 'inline-flex';
}

// Cancel Edit Welder Job — registered safely in DOMContentLoaded

// Delete Welder Job
function deleteWelderJob(jobId) {
    if (!confirm("Are you sure you want to delete this work entry?")) return;

    const welder = state.welders.find(w => w.id === activeWelderId);
    if (!welder || !welder.jobs) return;

    welder.jobs = welder.jobs.filter(j => j.id !== jobId);

    saveDocToFirestore(COLLECTIONS.WELDERS, welder);
    renderWelderJobs();
    resetWelderJobForm();
    renderAllDashboardData();
}

/* ==========================================================================
   INQUIRIES MESSAGE LOGS & CONTACT INFO SETTINGS
   ========================================================================== */

function renderInquiriesTable() {
    const tbody = document.getElementById('inquiries-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Filter out any corrupted null entries
    const valid = state.inquiries.filter(i => i.name && i.name !== 'null' && i.phone && i.phone !== 'null');

    if (valid.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">No messages received yet.</td></tr>`;
        return;
    }

    const sorted = [...valid].sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(inq => {
        const name = inq.name || 'N/A';
        const email = inq.email || 'N/A';
        const phone = inq.phone || 'N/A';
        const service = inq.service || 'N/A';
        const message = inq.message || 'N/A';
        tbody.innerHTML += `
            <tr>
                <td class="monospace" style="color: var(--accent); font-weight: 700; font-size: 12.5px;">${inq.id}</td>
                <td>${inq.date}</td>
                <td><strong>${name}</strong></td>
                <td>${email}</td>
                <td>${phone}</td>
                <td><span class="badge badge-info">${service}</span></td>
                <td style="max-width: 250px; text-align: left; white-space: normal; line-height: 1.4;" title="${message}">
                    ${message}
                </td>
                <td>
                    <div class="table-actions-cell">
                        <button class="btn-icon" onclick="promoteInquiryToCustomer('${inq.id}')" title="Promote to Customer" style="color: var(--success); border-color: var(--border-glow);"><i class="fa-solid fa-user-plus"></i></button>
                        <button class="btn-icon delete" onclick="deleteInquiry('${inq.id}')" title="Delete Message"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

function promoteInquiryToCustomer(inqId) {
    const inq = state.inquiries.find(i => i.id === inqId);
    if (!inq) return;

    openFormModal('modal-customer');

    document.getElementById('cust-name').value = inq.name;
    document.getElementById('cust-phone').value = inq.phone;
    document.getElementById('cust-email').value = inq.email || '';

    const typeSelect = document.getElementById('cust-type');
    if (typeSelect) {
        if (inq.service === 'Welding Job') {
            typeSelect.value = 'Welding';
        } else {
            typeSelect.value = 'Sidecar';
        }
    }
}

function deleteInquiry(inqId) {
    if (!confirm("Are you sure you want to delete this inquiry message?")) return;
    state.inquiries = state.inquiries.filter(i => i.id !== inqId);
    deleteDocFromFirestore(COLLECTIONS.INQUIRIES, inqId);
    renderInquiriesTable();
}

// Visitor Inquiry Form and Contact Settings — safe refs via DOMContentLoaded below


/* ==========================================================================
   FIREBASE AUTHENTICATION & ACCESS CONTROL
   ========================================================================== */

async function handleEmailPasswordLogin(emailOrUsername, password) {
    let email = emailOrUsername.trim().toLowerCase();
    
    // Load custom username from settings/auth_config
    let customUsername = 'admin';
    try {
        const configSnap = await db.collection('settings').doc('auth_config').get();
        if (configSnap.exists) {
            customUsername = (configSnap.data().username || 'admin').trim().toLowerCase();
        }
    } catch (err) {
        console.error("Failed to load auth_config settings, falling back to 'admin':", err);
    }
    
    if (email === customUsername || email === 'admin') {
        email = 'admin@jmrsidecar.com';
    }
    
    try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
        return true;
    } catch (err) {
        // Auto-create/bootstrap the admin email if credentials are correct but user does not exist in Auth yet
        if ((err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') && email === 'admin@jmrsidecar.com' && password === 'jmr-admin-2026') {
            try {
                await firebase.auth().createUserWithEmailAndPassword(email, password);
                return true;
            } catch (createErr) {
                // If the email is already in use, it means the user exists but the password entered was wrong. Throw the original sign-in error.
                if (createErr.code === 'auth/email-already-in-use') {
                    throw err;
                }
                console.error("Auto-registration of admin failed:", createErr);
                throw createErr;
            }
        }
        throw err;
    }
}

async function handleGoogleLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
}

async function migrateAuthorizedUsersIfNeeded() {
    try {
        const adminsSnap = await db.collection('admins').limit(1).get();
        if (!adminsSnap.empty) {
            return; // Already migrated or exists
        }
        
        console.log("No admins collection found. Bootstrapping/Migrating...");
        const systemAdminEmail = 'admin@jmrsidecar.com';
        await db.collection('admins').doc(systemAdminEmail).set({
            email: systemAdminEmail,
            displayName: 'JMR Owner',
            role: 'Owner',
            status: 'Active',
            provider: 'email',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        const oldDoc = await db.collection('settings').doc('authorized_users').get();
        if (oldDoc.exists) {
            const oldData = oldDoc.data();
            const emails = oldData.emails || [];
            for (const email of emails) {
                const cleanEmail = email.trim().toLowerCase();
                if (cleanEmail === systemAdminEmail) continue;
                
                await db.collection('admins').doc(cleanEmail).set({
                    email: cleanEmail,
                    displayName: cleanEmail.split('@')[0],
                    role: 'Admin',
                    status: 'Active',
                    provider: 'google',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            console.log(`Migrated ${emails.length} users to admins collection.`);
        }
    } catch (err) {
        console.error("Migration failed:", err);
    }
}

async function checkAdminAuthorization(user) {
    if (!user) return { authorized: false, reason: 'no_user' };
    
    const email = user.email.toLowerCase().trim();
    
    // Always permit the default admin email
    if (email === 'admin@jmrsidecar.com') {
        try {
            await migrateAuthorizedUsersIfNeeded();
            // Seed default admin in database if not present
            const adminDoc = await db.collection('admins').doc(email).get();
            if (!adminDoc.exists) {
                await db.collection('admins').doc(email).set({
                    email: email,
                    displayName: 'JMR Owner',
                    role: 'Owner',
                    status: 'Active',
                    provider: 'email',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (err) {
            console.error("Failed to seed default admin:", err);
        }
        return { authorized: true };
    }
    
    try {
        await migrateAuthorizedUsersIfNeeded();
        
        const adminDoc = await db.collection('admins').doc(email).get();
        if (adminDoc.exists) {
            const data = adminDoc.data();
            if (data.status === 'Active') {
                return { authorized: true };
            } else if (data.status === 'Inactive') {
                return { authorized: false, reason: 'inactive' };
            } else {
                return { authorized: false, reason: 'pending' };
            }
        } else {
            // Check if admins collection is empty (besides system owner)
            const snapshot = await db.collection('admins').get();
            // If only system owner or empty, auto-approve this first Google user
            const isFirstGoogle = snapshot.size <= 1; 
            const initialStatus = isFirstGoogle ? 'Active' : 'Pending';
            const initialRole = isFirstGoogle ? 'Owner' : 'Admin';
            
            const provider = (user.providerData && user.providerData[0]) ? user.providerData[0].providerId : 'google';
            
            await db.collection('admins').doc(email).set({
                email: email,
                displayName: user.displayName || email.split('@')[0],
                role: initialRole,
                status: initialStatus,
                provider: provider,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            if (initialStatus === 'Active') {
                return { authorized: true };
            }
            return { authorized: false, reason: 'new_request' };
        }
    } catch (err) {
        console.error("Error reading admin authorization list:", err);
        return { authorized: false, reason: 'error' };
    }
}

async function updateAdminSidebarInfo() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    
    let displayName = user.displayName || user.email;
    let role = 'Administrator';
    
    try {
        const adminDoc = await db.collection('admins').doc(user.email.toLowerCase()).get();
        if (adminDoc.exists) {
            const data = adminDoc.data();
            if (data.displayName) {
                displayName = data.displayName;
            }
            if (data.role) {
                role = data.role;
            }
            state.currentUserRole = role;
            state.currentUserStatus = data.status || 'Active';
        }
    } catch (err) {
        console.error("Failed to load admin profile info:", err);
    }
    
    const nameEl = document.getElementById('admin-display-name');
    const roleEl = document.getElementById('admin-display-role');
    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = role;
}

function openAdminsModal() {
    const modal = document.getElementById('modal-admin-mgmt');
    if (!modal) return;
    modal.classList.add('active');
    switchAdminModalTab('manage');
}

function switchAdminModalTab(tab) {
    const btnManage = document.getElementById('btn-tab-manage-admins');
    const btnProfile = document.getElementById('btn-tab-my-profile');
    const paneManage = document.getElementById('modal-tab-manage-admins');
    const paneProfile = document.getElementById('modal-tab-my-profile');
    
    if (!btnManage || !btnProfile || !paneManage || !paneProfile) return;
    
    // Clear messages
    const errEl = document.getElementById('profile-error-msg');
    const succEl = document.getElementById('profile-success-msg');
    if (errEl) errEl.style.display = 'none';
    if (succEl) succEl.style.display = 'none';
    
    if (tab === 'manage') {
        btnManage.classList.add('active');
        btnProfile.classList.remove('active');
        paneManage.style.display = 'block';
        paneProfile.style.display = 'none';
        renderAdminsList();
    } else if (tab === 'profile') {
        btnProfile.classList.add('active');
        btnManage.classList.remove('active');
        paneProfile.style.display = 'block';
        paneManage.style.display = 'none';
        populateProfileFields();
    }
}

async function populateProfileFields() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    
    const displayNameInput = document.getElementById('profile-display-name');
    const usernameInput = document.getElementById('profile-username');
    const passwordInput = document.getElementById('profile-password');
    const emailPassFields = document.getElementById('profile-email-pass-fields');
    
    if (passwordInput) passwordInput.value = '';
    
    try {
        const adminDoc = await db.collection('admins').doc(user.email.toLowerCase()).get();
        if (adminDoc.exists && displayNameInput) {
            displayNameInput.value = adminDoc.data().displayName || '';
        } else if (displayNameInput) {
            displayNameInput.value = user.displayName || '';
        }
    } catch (err) {
        console.error("Error fetching admin profile:", err);
        if (displayNameInput) displayNameInput.value = user.displayName || '';
    }
    
    const providerId = (user.providerData && user.providerData[0]) ? user.providerData[0].providerId : 'google';
    if (user.email === 'admin@jmrsidecar.com' || providerId === 'password') {
        if (emailPassFields) emailPassFields.style.display = 'block';
        try {
            const configSnap = await db.collection('settings').doc('auth_config').get();
            if (configSnap.exists && usernameInput) {
                usernameInput.value = configSnap.data().username || 'admin';
            } else if (usernameInput) {
                usernameInput.value = 'admin';
            }
        } catch (err) {
            console.error("Error loading auth_config:", err);
            if (usernameInput) usernameInput.value = 'admin';
        }
    } else {
        if (emailPassFields) emailPassFields.style.display = 'none';
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    
    const user = firebase.auth().currentUser;
    if (!user) return;
    
    const errorMsg = document.getElementById('profile-error-msg');
    const successMsg = document.getElementById('profile-success-msg');
    
    if (errorMsg) errorMsg.style.display = 'none';
    if (successMsg) successMsg.style.display = 'none';
    
    const displayName = document.getElementById('profile-display-name').value.trim();
    const newUsername = document.getElementById('profile-username').value.trim();
    const newPassword = document.getElementById('profile-password').value;
    
    const providerId = (user.providerData && user.providerData[0]) ? user.providerData[0].providerId : 'google';
    const isEmailUser = (user.email === 'admin@jmrsidecar.com' || providerId === 'password');
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const origText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    
    try {
        // 1. Update Display Name in Firebase User Profile if possible
        if (user.updateProfile) {
            await user.updateProfile({ displayName: displayName });
        }
        
        // 2. Update Firestore admins collection
        await db.collection('admins').doc(user.email.toLowerCase()).update({
            displayName: displayName,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // 3. For Email/Password users, check for username and password updates
        if (isEmailUser) {
            // Update username in settings/auth_config
            if (newUsername) {
                await db.collection('settings').doc('auth_config').set({
                    username: newUsername
                }, { merge: true });
            }
            
            // Update password
            if (newPassword) {
                if (newPassword.length < 6) {
                    throw new Error("Password must be at least 6 characters long.");
                }
                await user.updatePassword(newPassword);
            }
        }
        
        if (successMsg) {
            successMsg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Credentials updated successfully!';
            successMsg.style.display = 'flex';
        }
        
        // Update sidebar
        await updateAdminSidebarInfo();
        
    } catch (err) {
        console.error("Failed to update profile:", err);
        let msg = err.message;
        if (err.code === 'auth/requires-recent-login') {
            msg = "For security reasons, changing your password requires a recent login. Please log out, log back in, and try again.";
        }
        if (errorMsg) {
            errorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${msg}`;
            errorMsg.style.display = 'flex';
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origText;
    }
}

async function renderAdminsList() {
    const tbody = document.getElementById('admins-list-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading admin list...</td></tr>';
    
    try {
        const currentUser = firebase.auth().currentUser;
        const snapshot = await db.collection('admins').orderBy('createdAt', 'asc').get();
        tbody.innerHTML = '';
        
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No admin accounts found.</td></tr>';
            return;
        }
        
        snapshot.forEach(doc => {
            const admin = doc.data();
            const email = admin.email;
            const displayName = admin.displayName || email.split('@')[0];
            const provider = admin.provider || 'google';
            const status = admin.status || 'Pending';
            const createdAt = admin.createdAt ? new Date(admin.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
            
            let statusClass = 'status-pending';
            if (status === 'Active') statusClass = 'status-active';
            if (status === 'Inactive') statusClass = 'status-inactive';
            
            let providerIcon = 'fa-solid fa-envelope';
            let providerLabel = 'Email/Pass';
            let providerClass = 'method-email';
            if (provider === 'google.com' || provider === 'google') {
                providerIcon = 'fa-brands fa-google';
                providerLabel = 'Google';
                providerClass = 'method-google';
            }
            
            let actionHtml = '';
            if (email !== 'admin@jmrsidecar.com') {
                const isSelf = currentUser && currentUser.email.toLowerCase() === email.toLowerCase();
                
                if (status === 'Active') {
                    actionHtml += `
                        <button class="btn-action btn-action-deactivate" onclick="toggleAdminStatus('${email}', 'Inactive')" ${isSelf ? 'disabled title="You cannot deactivate yourself"' : ''}>
                            <i class="fa-solid fa-ban"></i> Deactivate
                        </button>
                    `;
                } else {
                    actionHtml += `
                        <button class="btn-action btn-action-activate" onclick="toggleAdminStatus('${email}', 'Active')">
                            <i class="fa-solid fa-check"></i> Activate
                        </button>
                    `;
                }
                
                actionHtml += `
                    <button class="btn-action btn-action-delete" onclick="deleteAdmin('${email}')" ${isSelf ? 'disabled title="You cannot delete yourself"' : ''}>
                        <i class="fa-solid fa-trash-can"></i> Delete
                    </button>
                `;
            } else {
                actionHtml = '<span style="color: var(--text-muted); font-size: 11px;">System Owner (Protected)</span>';
            }
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div style="font-weight: 600;">${displayName}</div>
                    <div style="color: var(--text-secondary); font-size: 11px;">${email}</div>
                </td>
                <td>
                    <span class="method-badge ${providerClass}">
                        <i class="${providerIcon}"></i> ${providerLabel}
                    </span>
                </td>
                <td>
                    <span class="status-badge ${statusClass}">${status}</span>
                </td>
                <td>${createdAt}</td>
                <td style="text-align: right; white-space: nowrap;">
                    ${actionHtml}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Failed to render admin list:", err);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger);">Failed to load admin list.</td></tr>';
    }
}

async function toggleAdminStatus(email, newStatus) {
    if (email === 'admin@jmrsidecar.com') return;
    
    const confirmMsg = `Are you sure you want to set status of ${email} to ${newStatus}?`;
    if (!confirm(confirmMsg)) return;
    
    try {
        await db.collection('admins').doc(email.toLowerCase()).update({
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        const currentUser = firebase.auth().currentUser;
        if (currentUser && currentUser.email.toLowerCase() === email.toLowerCase() && newStatus !== 'Active') {
            await firebase.auth().signOut();
            return;
        }
        
        await renderAdminsList();
        await renderAuthorizedEmails();
    } catch (err) {
        console.error("Failed to toggle admin status:", err);
        alert("Failed to update status: " + err.message);
    }
}

async function deleteAdmin(email) {
    if (email === 'admin@jmrsidecar.com') return;
    
    const confirmMsg = `Are you sure you want to delete admin account ${email}? This action cannot be undone.`;
    if (!confirm(confirmMsg)) return;
    
    try {
        await db.collection('admins').doc(email.toLowerCase()).delete();
        
        const currentUser = firebase.auth().currentUser;
        if (currentUser && currentUser.email.toLowerCase() === email.toLowerCase()) {
            await firebase.auth().signOut();
            return;
        }
        
        await renderAdminsList();
        await renderAuthorizedEmails();
    } catch (err) {
        console.error("Failed to delete admin:", err);
        alert("Failed to delete admin: " + err.message);
    }
}

async function renderAuthorizedEmails() {
    const listEl = document.getElementById('authorized-emails-list');
    if (!listEl) return;
    
    listEl.innerHTML = '<li style="justify-content: center;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</li>';
    
    try {
        const snapshot = await db.collection('admins').orderBy('createdAt', 'asc').get();
        listEl.innerHTML = '';
        
        snapshot.forEach(doc => {
            const admin = doc.data();
            const email = admin.email;
            const status = admin.status || 'Pending';
            
            const li = document.createElement('li');
            li.style.display = 'flex';
            li.style.justifyContent = 'space-between';
            li.style.alignItems = 'center';
            li.style.padding = '8px 12px';
            li.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
            
            let statusBadge = '';
            if (status === 'Pending') {
                statusBadge = '<span style="color:#f59e0b; font-size:11px; margin-right:8px; font-weight:600;">(Pending)</span>';
            } else if (status === 'Inactive') {
                statusBadge = '<span style="color:#ef4444; font-size:11px; margin-right:8px; font-weight:600;">(Inactive)</span>';
            }
            
            if (email === 'admin@jmrsidecar.com') {
                li.innerHTML = `
                    <span class="email-text">admin@jmrsidecar.com</span>
                    <span class="badge-owner">System Admin</span>
                `;
            } else {
                li.innerHTML = `
                    <span class="email-text">${email} ${statusBadge}</span>
                    <button class="btn-remove-email" onclick="removeAdminEmail('${email}')" title="Delete Admin">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
            }
            listEl.appendChild(li);
        });
    } catch (err) {
        console.error("Failed to load authorized emails:", err);
        listEl.innerHTML = '<li style="justify-content: center; color: var(--danger);">Failed to load emails.</li>';
    }
}

async function addAdminEmail(email) {
    if (!email) return;
    const cleanEmail = email.trim().toLowerCase();
    
    try {
        const adminDoc = await db.collection('admins').doc(cleanEmail).get();
        if (adminDoc.exists) {
            alert("This email is already in the admin list.");
            return;
        }
        
        await db.collection('admins').doc(cleanEmail).set({
            email: cleanEmail,
            displayName: cleanEmail.split('@')[0],
            role: 'Admin',
            status: 'Active',
            provider: 'google',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        await renderAuthorizedEmails();
        const modal = document.getElementById('modal-admin-mgmt');
        if (modal && modal.classList.contains('active')) {
            await renderAdminsList();
        }
    } catch (err) {
        console.error("Failed to add admin email:", err);
        alert("Failed to authorize email: " + err.message);
    }
}

async function removeAdminEmail(email) {
    if (email === 'admin@jmrsidecar.com') return;
    if (!confirm(`Are you sure you want to revoke admin access and delete ${email}?`)) return;
    
    try {
        await db.collection('admins').doc(email.toLowerCase()).delete();
        await renderAuthorizedEmails();
        
        const modal = document.getElementById('modal-admin-mgmt');
        if (modal && modal.classList.contains('active')) {
            await renderAdminsList();
        }
        
        const currentUser = firebase.auth().currentUser;
        if (currentUser && currentUser.email.toLowerCase() === email.toLowerCase()) {
            await firebase.auth().signOut();
        }
    } catch (err) {
        console.error("Failed to remove admin email:", err);
        alert("Failed to remove email: " + err.message);
    }
}

window.removeAdminEmail = removeAdminEmail;
window.openAdminsModal = openAdminsModal;
window.switchAdminModalTab = switchAdminModalTab;
window.toggleAdminStatus = toggleAdminStatus;
window.deleteAdmin = deleteAdmin;

/* ==========================================================================
   RELEASE UNIT AND PAYMENT MATHEMATICS HELPERS
   ========================================================================== */

async function releaseCustomerUnit(customerId, workDescription, type, recordId) {
    const customer = state.customers.find(c => c.id === customerId);
    if (!customer) {
        alert("Customer record not found.");
        return false;
    }

    const totalCost = customer.totalAmount || 0;
    const downpayment = customer.downpayment || 0;
    const partialPayment = customer.partialPayment || 0;
    const totalPaidSoFar = downpayment + partialPayment;
    let fullPayment = 0;

    if (totalPaidSoFar >= totalCost) {
        fullPayment = 0;
        alert(`Total Paid (Downpayment: ₱${downpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })} + Partial: ₱${partialPayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}) equals or exceeds Total Cost (₱${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}).\nPermission to release is granted!`);
    } else {
        const remaining = Math.max(0, totalCost - totalPaidSoFar);
        const promptMsg = `Releasing Unit for ${customer.name}\nTotal Cost: ₱${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}\nDownpayment Paid: ₱${downpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}\nPartial Payment Paid: ₱${partialPayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}\nTotal Paid So Far: ₱${totalPaidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\nRemaining Balance to Pay: ₱${remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\nPlease enter the Full Payment amount:`;
        
        const fullPaymentInput = prompt(promptMsg, remaining);
        if (fullPaymentInput === null) {
            return false;
        }

        fullPayment = parseFloat(fullPaymentInput);
        if (isNaN(fullPayment) || Math.abs((totalPaidSoFar + fullPayment) - totalCost) > 0.01) {
            alert(`Error: The math does not add up!\nTotal Paid So Far (₱${totalPaidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2 })}) + Full Payment (₱${(fullPayment || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}) must equal the Total Cost (₱${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}).`);
            return false;
        }
    }

    const releaseDate = new Date().toISOString().split('T')[0];

    // Update specific record status/released state
    if (type === 'build') {
        const build = state.builds.find(b => b.id === recordId);
        if (build) {
            build.progress = 100;
            build.released = releaseDate;
            await saveDocToFirestore(COLLECTIONS.BUILDS, build);
        }
    } else if (type === 'repair') {
        const repair = state.repairs.find(r => r.id === recordId);
        if (repair) {
            repair.status = 'Completed';
            repair.released = releaseDate;
            await saveDocToFirestore(COLLECTIONS.REPAIRS, repair);
        }
    } else if (type === 'welding') {
        const weld = state.weldingJobs.find(w => w.id === recordId);
        if (weld) {
            weld.released = releaseDate;
            await saveDocToFirestore(COLLECTIONS.WELDING_JOBS, weld);
        }
    }

    // Update customer payments & status
    customer.downpayment = totalCost; // fully paid
    customer.buildStatus = 'Released';
    await saveDocToFirestore(COLLECTIONS.CUSTOMERS, customer);

    if (fullPayment > 0) {
        logMoneyInForDate(fullPayment, `Full payment on release: ${customer.name} (${workDescription})`);
    }

    // Show the receipt
    showReceiptModal({
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        description: workDescription,
        downpayment: downpayment,
        fullPayment: fullPayment,
        totalCost: totalCost,
        dateReleased: releaseDate
    });

    renderAllDashboardData();
    return true;
}

async function releaseBuildUnit(buildId) {
    const build = state.builds.find(b => b.id === buildId);
    if (!build) return;
    await releaseCustomerUnit(build.customerId, build.specs, 'build', buildId);
}

async function releaseRepairUnit(repairId) {
    const repair = state.repairs.find(r => r.id === repairId);
    if (!repair) return;
    await releaseCustomerUnit(repair.customerId, `Repair for ${repair.item}: ${repair.issue}`, 'repair', repairId);
}

async function releaseWeldingUnit(weldingId) {
    const weld = state.weldingJobs.find(w => w.id === weldingId);
    if (!weld) return;
    await releaseCustomerUnit(weld.customerId, `Welding Job: ${weld.desc} (${weld.material})`, 'welding', weldingId);
}

function showReceiptModal(data) {
    const rawText = `Name: ${data.name}
Phone: ${data.phone}
Gmail: ${data.email}
Description: ${data.description}


Downpayment: ₱${data.downpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}
Full Payment: ₱${data.fullPayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}
TOTAL COST: ₱${data.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
(PAID)
*DATE RELEASED: ${data.dateReleased}`;

    // Store raw text for copying
    const receiptTextEl = document.getElementById('release-receipt-text');
    receiptTextEl.setAttribute('data-raw', rawText);

    // Render beautiful HTML version inside the pre tag
    const htmlText = `<span style="color: #555555;">Name:</span>        <strong style="color: #000000; font-size: 15px;">${data.name}</strong>
<span style="color: #555555;">Phone:</span>       <span style="color: #000000;">${data.phone}</span>
<span style="color: #555555;">Gmail:</span>       <span style="color: #000000;">${data.email}</span>
<span style="color: #555555;">Description:</span> <span style="color: #d97706; font-weight: 500;">${data.description}</span>


<span style="color: #555555;">Downpayment:</span>  <span style="color: #000000;">₱${data.downpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
<span style="color: #555555;">Full Payment:</span> <strong style="color: #047857;">₱${data.fullPayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
<span style="color: #555555;">TOTAL COST:</span>   <strong style="color: #d97706; font-size: 16px;">₱${data.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>

<strong style="color: #047857; font-size: 15px; letter-spacing: 2px; display: inline-block; margin: 8px 0; border: 1px dashed #047857; padding: 2px 12px; border-radius: 4px;">(PAID)</strong>

<span style="color: #047857; font-weight: bold;">*DATE RELEASED: ${data.dateReleased}</span>`;

    receiptTextEl.innerHTML = htmlText;
    openFormModal('modal-release-receipt');
}

function copyReleaseReceiptText() {
    const textEl = document.getElementById('release-receipt-text');
    if (textEl) {
        const rawText = textEl.getAttribute('data-raw') || textEl.textContent;
        navigator.clipboard.writeText(rawText).then(() => {
            alert("Receipt text copied to clipboard!");
        }).catch(err => {
            console.error("Failed to copy text: ", err);
        });
    }
}

window.releaseBuildUnit = releaseBuildUnit;
window.releaseRepairUnit = releaseRepairUnit;
window.releaseWeldingUnit = releaseWeldingUnit;
window.copyReleaseReceiptText = copyReleaseReceiptText;

function openBuildDetails(buildId) {
    const build = state.builds.find(b => b.id === buildId);
    if (!build) return;

    document.getElementById('build-detail-customer').textContent = build.customerName;
    document.getElementById('build-detail-id').textContent = build.id;
    document.getElementById('build-detail-specs').textContent = build.specs || 'No specification description provided.';
    document.getElementById('build-detail-welder').textContent = build.welderName;
    if (build.released) {
        document.getElementById('build-detail-target-label').textContent = 'Released Date';
        document.getElementById('build-detail-target').textContent = build.released;
        document.getElementById('build-detail-target').style.color = 'var(--success)';
    } else {
        document.getElementById('build-detail-target-label').textContent = 'Target Completion';
        document.getElementById('build-detail-target').textContent = build.target;
        document.getElementById('build-detail-target').style.color = 'var(--warning)';
    }

    const isCompleted = build.progress >= 100;
    const progressLabel = isCompleted ? 'Completed' : `${build.progress}% Complete`;
    document.getElementById('build-detail-progress-label').textContent = progressLabel;
    
    const progressBar = document.getElementById('build-detail-progress-bar');
    progressBar.style.width = `${build.progress}%`;
    progressBar.style.backgroundColor = isCompleted ? 'var(--success)' : 'var(--accent)';

    const imageContainer = document.getElementById('build-detail-image-container');
    if (build.image) {
        imageContainer.innerHTML = `<img src="${build.image}" alt="Sidecar build image" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
        imageContainer.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); opacity: 0.6;">
                <i class="fa-solid fa-motorcycle" style="font-size: 54px; margin-bottom: 12px; display: block;"></i>
                <span style="font-size: 13px; font-weight: 600; letter-spacing: 0.5px;">No image uploaded for this build</span>
            </div>
        `;
    }

    openFormModal('modal-build-details');
}

window.openBuildDetails = openBuildDetails;

function openCustomerDetails(customerId) {
    const customer = state.customers.find(c => c.id === customerId);
    if (!customer) return;

    document.getElementById('cust-detail-name').textContent = customer.name;
    document.getElementById('cust-detail-id-label').textContent = `CUSTOMER ID: ${customer.id}`;
    document.getElementById('cust-detail-desc').textContent = customer.description || 'No description or specifications provided for this customer.';

    openFormModal('modal-customer-details');
}

window.openCustomerDetails = openCustomerDetails;

function showDownpaymentReceipt(data) {
    const rawText = `Name: ${data.name}
Phone: ${data.phone}
Gmail: ${data.email}
Description: ${data.description}


Downpayment: ₱${data.downpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}
Remaining Balance: ₱${data.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
TOTAL COST: ₱${data.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
(DOWNPAYMENT PAID)
*DATE ADDED: ${data.dateAdded}`;

    // Store raw text for copying
    const receiptTextEl = document.getElementById('downpayment-receipt-text');
    receiptTextEl.setAttribute('data-raw', rawText);

    // Render beautiful HTML version inside the pre tag
    const htmlText = `<span style="color: #555555;">Name:</span>              <strong style="color: #000000; font-size: 15px;">${data.name}</strong>
<span style="color: #555555;">Phone:</span>             <span style="color: #000000;">${data.phone}</span>
<span style="color: #555555;">Gmail:</span>             <span style="color: #000000;">${data.email}</span>
<span style="color: #555555;">Description:</span>       <span style="color: #d97706; font-weight: 500;">${data.description}</span>


<span style="color: #555555;">Downpayment:</span>       <strong style="color: #047857;">₱${data.downpayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
<span style="color: #555555;">Remaining Balance:</span> <span style="color: #b45309;">₱${data.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
<span style="color: #555555;">TOTAL COST:</span>        <strong style="color: #d97706; font-size: 16px;">₱${data.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>

<strong style="color: #047857; font-size: 14px; letter-spacing: 2px; display: inline-block; margin: 8px 0; border: 1px dashed #047857; padding: 2px 12px; border-radius: 4px;">(DOWNPAYMENT PAID)</strong>

<span style="color: #047857; font-weight: bold;">*DATE ADDED: ${data.dateAdded}</span>`;

    receiptTextEl.innerHTML = htmlText;
    openFormModal('modal-downpayment-receipt');
}

function copyDownpaymentReceiptText() {
    const textEl = document.getElementById('downpayment-receipt-text');
    if (textEl) {
        const rawText = textEl.getAttribute('data-raw') || textEl.textContent;
        navigator.clipboard.writeText(rawText).then(() => {
            alert("Downpayment receipt text copied to clipboard!");
        }).catch(err => {
            console.error("Failed to copy text: ", err);
        });
    }
}

window.copyDownpaymentReceiptText = copyDownpaymentReceiptText;



/* ==========================================================================
   INITIALIZATION
   ========================================================================== */

window.addEventListener('DOMContentLoaded', async () => {
    // --- CACHE DOM REFERENCES ---
    visitorView = document.getElementById('visitor-view');
    adminDashboardView = document.getElementById('admin-dashboard-view');
    adminLoginModal = document.getElementById('admin-login-modal');
    mainNav = document.getElementById('main-nav');
    currentTabTitle = document.getElementById('current-tab-title');
    currentTabDesc = document.getElementById('current-tab-desc');
    btnQuickAdd = document.getElementById('btn-quick-add');
    buildImagePreview = document.getElementById('build-image-preview');
    galleryImagePreview = document.getElementById('gallery-image-preview');

    // --- NAVIGATION LISTENERS ---
    const btnAdminNavTrigger = document.getElementById('btn-admin-nav-trigger');
    const btnCloseLogin = document.getElementById('btn-close-login');
    const adminLoginForm = document.getElementById('admin-login-form');
    const btnAdminLogout = document.getElementById('btn-admin-logout');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const navLinks = document.getElementById('nav-links');
    const menuToggle = document.getElementById('menu-toggle');

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => navLinks.classList.toggle('active'));
    }

    document.querySelectorAll('.nav-link-item').forEach(link => {
        link.addEventListener('click', () => {
            if (navLinks) navLinks.classList.remove('active');
            document.querySelectorAll('.nav-link-item').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
        });
    });

    if (btnAdminNavTrigger && adminLoginModal && loginErrorMsg && adminLoginForm) {
        btnAdminNavTrigger.addEventListener('click', () => {
            adminLoginModal.classList.add('active');
            loginErrorMsg.style.display = 'none';
            adminLoginForm.reset();
        });
    }

    if (btnCloseLogin && adminLoginModal) {
        btnCloseLogin.addEventListener('click', () => adminLoginModal.classList.remove('active'));
    }

    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const u = document.getElementById('login-username').value;
            const p = document.getElementById('login-password').value;
            
            const submitBtn = adminLoginForm.querySelector('button[type="submit"]');
            const origText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';
            
            if (loginErrorMsg) loginErrorMsg.style.display = 'none';

            try {
                await handleEmailPasswordLogin(u, p);
                adminLoginModal.classList.remove('active');
            } catch (err) {
                console.error("Login failed:", err);
                if (loginErrorMsg) {
                    let errMsg = "Invalid credentials. Please try again.";
                    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                        errMsg = "Incorrect username or password. Please try again.";
                    } else if (err.code === 'auth/invalid-email' || err.code === 'auth/user-not-found') {
                        errMsg = "Admin user not found or invalid username.";
                    } else if (err.message) {
                        errMsg = err.message;
                    }
                    loginErrorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${errMsg}`;
                    loginErrorMsg.style.display = 'flex';
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = origText;
            }
        });
    }

    const btnGoogleLogin = document.getElementById('btn-google-login');
    if (btnGoogleLogin) {
        btnGoogleLogin.addEventListener('click', async () => {
            if (loginErrorMsg) loginErrorMsg.style.display = 'none';
            try {
                await handleGoogleLogin();
                adminLoginModal.classList.remove('active');
            } catch (err) {
                console.error("Google sign-in failed:", err);
                if (loginErrorMsg) {
                    let errMsg = err.message;
                    if (err.code === 'auth/popup-closed-by-user') {
                        errMsg = "Sign-in was cancelled (the login window was closed). Please try again.";
                    } else if (err.code === 'auth/cancelled-popup-request') {
                        errMsg = "Another sign-in request is already in progress. Please complete that one.";
                    } else if (err.code === 'auth/popup-blocked') {
                        errMsg = "The login popup was blocked by your browser. Please allow popups for this website.";
                    }
                    loginErrorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${errMsg}`;
                    loginErrorMsg.style.display = 'flex';
                }
            }
        });
    }

    if (btnAdminLogout) {
        btnAdminLogout.addEventListener('click', async () => {
            try {
                await firebase.auth().signOut();
            } catch (err) {
                console.error("Sign out failed:", err);
                exitAdminDashboard();
            }
        });
    }

    const addAdminEmailForm = document.getElementById('add-admin-email-form');
    if (addAdminEmailForm) {
        addAdminEmailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('new-admin-email');
            const email = input.value.trim().toLowerCase();
            if (email) {
                await addAdminEmail(email);
                addAdminEmailForm.reset();
            }
        });
    }

    // --- PROFILE UPDATE FORM LISTENER ---
    const formUpdateProfile = document.getElementById('form-update-profile');
    if (formUpdateProfile) {
        formUpdateProfile.addEventListener('submit', handleProfileUpdate);
    }

    // --- FIREBASE AUTH STATE LISTENER ---
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            const authResult = await checkAdminAuthorization(user);
            if (authResult.authorized) {
                enterAdminDashboard();
                updateAdminSidebarInfo();
            } else {
                const loginErrorMsg = document.getElementById('login-error-msg');
                if (loginErrorMsg) {
                    let msg = 'Access denied: You are not authorized.';
                    if (authResult.reason === 'inactive') {
                        msg = 'Access denied: This admin account has been deactivated.';
                    } else if (authResult.reason === 'pending') {
                        msg = 'Access denied: Your admin registration request is pending approval.';
                    } else if (authResult.reason === 'new_request') {
                        msg = 'Registration request sent. Please wait for an existing admin to approve you.';
                    }
                    loginErrorMsg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${msg}`;
                    loginErrorMsg.style.display = 'flex';
                }
                await firebase.auth().signOut();
            }
        } else {
            exitAdminDashboard();
        }
    });

    // --- TAB SWITCHER LISTENERS ---
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchDashboardTab(btn.getAttribute('data-tab')));
    });

    if (btnQuickAdd) {
        btnQuickAdd.addEventListener('click', () => {
            switch (activeTab) {
                case 'tab-customers': openFormModal('modal-customer'); break;
                case 'tab-builds':
                case 'tab-past-builds': openFormModal('modal-build'); break;
                case 'tab-welding': openFormModal('modal-welding'); break;
                case 'tab-welders': {
                    const activeSub = document.querySelector('.sub-tab-btn.active');
                    if (activeSub && activeSub.getAttribute('data-subtab') === 'subtab-cash-advances') {
                        openAddValeModal();
                    } else {
                        openFormModal('modal-welder');
                    }
                    break;
                }
                case 'tab-gallery': openFormModal('modal-gallery'); break;
                case 'tab-materials': openFormModal('modal-material'); break;
                case 'tab-templates': openFormModal('modal-template'); break;
                case 'tab-analytics': openFormModal('modal-visit'); break;
            }
        });
    }

    // --- IMAGE UPLOAD LISTENERS ---
    const buildImageInput = document.getElementById('build-image');
    if (buildImageInput && buildImagePreview) {
        buildImageInput.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (file) {
                try {
                    buildImagePreview.innerHTML = `<div style="text-align:center; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> Converting to WebP...</div>`;
                    const result = await compressAndConvertToWebP(file);
                    currentUploadedImageBase64 = result.dataUrl;
                    buildImagePreview.innerHTML = `<img src="${currentUploadedImageBase64}" alt="Upload Preview">`;
                    
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(result.file);
                    buildImageInput.files = dataTransfer.files;
                } catch (err) {
                    console.error("Image compression failed:", err);
                    alert("Failed to compress image. Please choose another file.");
                    buildImageInput.value = '';
                    buildImagePreview.innerHTML = `<i class="fa-regular fa-image"></i><p>No image chosen</p>`;
                }
            }
        });
    }

    const galleryImageInput = document.getElementById('gallery-image');
    if (galleryImageInput && galleryImagePreview) {
        galleryImageInput.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (file) {
                try {
                    galleryImagePreview.innerHTML = `<div style="text-align:center; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> Converting to WebP...</div>`;
                    const result = await compressAndConvertToWebP(file);
                    currentUploadedImageBase64 = result.dataUrl;
                    galleryImagePreview.innerHTML = `<img src="${currentUploadedImageBase64}" alt="Upload Preview">`;
                    
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(result.file);
                    galleryImageInput.files = dataTransfer.files;
                } catch (err) {
                    console.error("Image compression failed:", err);
                    alert("Failed to compress image. Please choose another file.");
                    galleryImageInput.value = '';
                    galleryImagePreview.innerHTML = `<i class="fa-regular fa-image"></i><p>No image chosen</p>`;
                }
            }
        });
    }

    // --- TEMPLATE IMAGE UPLOAD PREVIEW ---
    const templateImageInput = document.getElementById('template-image-file');
    const templateImagePreview = document.getElementById('template-image-preview');
    if (templateImageInput && templateImagePreview) {
        templateImageInput.addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (file) {
                try {
                    templateImagePreview.innerHTML = `<div style="text-align:center; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> Converting to WebP...</div>`;
                    const result = await compressAndConvertToWebP(file);
                    currentUploadedImageBase64 = result.dataUrl;
                    templateImagePreview.innerHTML = `<img src="${currentUploadedImageBase64}" style="max-height: 100px; border-radius: var(--radius);">`;
                    
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(result.file);
                    templateImageInput.files = dataTransfer.files;
                } catch (err) {
                    console.error("Image compression failed:", err);
                    alert("Failed to compress image. Please choose another file.");
                    templateImageInput.value = '';
                    templateImagePreview.innerHTML = `<i class="fa-regular fa-image" style="font-size: 24px; color: var(--text-muted);"></i><p style="margin-left: 8px; font-size: 13px; color: var(--text-muted);">No image chosen</p>`;
                }
            }
        });
    }

    // --- TEMPLATES FILTERS AND PAGINATION ---
    const searchTemplates = document.getElementById('search-templates');
    if (searchTemplates) {
        searchTemplates.addEventListener('input', () => {
            state.templatesCurrentPage = 1;
            renderTemplatesGrid();
        });
    }

    const filterTemplatesCat = document.getElementById('filter-templates-category');
    if (filterTemplatesCat) {
        filterTemplatesCat.addEventListener('change', () => {
            state.templatesCurrentPage = 1;
            renderTemplatesGrid();
        });
    }

    const filterTemplatesStatus = document.getElementById('filter-templates-status');
    if (filterTemplatesStatus) {
        filterTemplatesStatus.addEventListener('change', () => {
            state.templatesCurrentPage = 1;
            renderTemplatesGrid();
        });
    }

    const btnTemplatesPrev = document.getElementById('btn-templates-prev');
    if (btnTemplatesPrev) {
        btnTemplatesPrev.addEventListener('click', () => {
            if (state.templatesCurrentPage > 1) {
                state.templatesCurrentPage--;
                renderTemplatesGrid();
            }
        });
    }

    const btnTemplatesNext = document.getElementById('btn-templates-next');
    if (btnTemplatesNext) {
        btnTemplatesNext.addEventListener('click', () => {
            state.templatesCurrentPage++;
            renderTemplatesGrid();
        });
    }

    // --- TEMPLATE DETAILS MODAL INTERACTIVE LISTENERS ---
    const detailVariantSelect = document.getElementById('detail-variant-select');
    if (detailVariantSelect) {
        detailVariantSelect.addEventListener('change', (e) => {
            loadVariantDetailsAndBom(e.target.value);
            document.getElementById('form-variant').style.display = 'none';
            document.getElementById('variant-info-display').style.display = 'flex';
            document.getElementById('btn-add-variant-toggle').style.display = 'inline-block';
            document.getElementById('form-bom-item').style.display = 'none';
            document.getElementById('btn-add-bom-item-toggle').style.display = 'inline-block';
        });
    }

    const btnAddVariantToggle = document.getElementById('btn-add-variant-toggle');
    if (btnAddVariantToggle) {
        btnAddVariantToggle.addEventListener('click', () => {
            document.getElementById('variant-form-title').textContent = 'Add Variant';
            document.getElementById('variant-id').value = '';
            document.getElementById('variant-name').value = '';
            document.getElementById('variant-code').value = '';
            document.getElementById('variant-material-type').value = '';
            document.getElementById('variant-price').value = '';
            document.getElementById('variant-labor').value = '';
            document.getElementById('variant-version').value = '1.0';
            document.getElementById('variant-changelog').value = 'Initial release.';
            document.getElementById('variant-length').value = '';
            document.getElementById('variant-width').value = '';
            document.getElementById('variant-height').value = '';
            document.getElementById('variant-weight').value = '';
            document.getElementById('variant-is-default').checked = false;
            document.getElementById('variant-is-active').checked = true;

            document.getElementById('form-variant').style.display = 'block';
            document.getElementById('variant-info-display').style.display = 'none';
            document.getElementById('btn-add-variant-toggle').style.display = 'none';
        });
    }

    const btnCancelVariant = document.getElementById('btn-cancel-variant');
    if (btnCancelVariant) {
        btnCancelVariant.addEventListener('click', () => {
            document.getElementById('form-variant').style.display = 'none';
            document.getElementById('variant-info-display').style.display = 'flex';
            document.getElementById('btn-add-variant-toggle').style.display = 'inline-block';
        });
    }

    const btnAddBomItemToggle = document.getElementById('btn-add-bom-item-toggle');
    if (btnAddBomItemToggle) {
        btnAddBomItemToggle.addEventListener('click', () => {
            populateActiveMaterialsDropdown();
            document.getElementById('bom-form-title').textContent = 'Add BOM Material';
            document.getElementById('bom-id').value = '';
            document.getElementById('bom-material').value = '';
            document.getElementById('bom-qty').value = '';
            document.getElementById('bom-remarks').value = '';
            document.getElementById('bom-sort-order').value = '0';

            document.getElementById('form-bom-item').style.display = 'block';
            document.getElementById('btn-add-bom-item-toggle').style.display = 'none';
        });
    }

    const btnCancelBomItem = document.getElementById('btn-cancel-bom-item');
    if (btnCancelBomItem) {
        btnCancelBomItem.addEventListener('click', () => {
            document.getElementById('form-bom-item').style.display = 'none';
            document.getElementById('btn-add-bom-item-toggle').style.display = 'inline-block';
        });
    }

    // Build progress → released date toggle
    const buildProgressInput = document.getElementById('build-progress');
    const buildReleasedGroup = document.getElementById('build-released-group');
    const buildReleasedInput = document.getElementById('build-released');
    if (buildProgressInput && buildReleasedGroup && buildReleasedInput) {
        buildProgressInput.addEventListener('input', () => {
            const val = parseInt(buildProgressInput.value) || 0;
            if (val >= 100) {
                buildReleasedGroup.style.display = 'flex';
                buildReleasedInput.setAttribute('required', 'required');
                if (!buildReleasedInput.value) {
                    const targetInput = document.getElementById('build-target');
                    buildReleasedInput.value = targetInput ? targetInput.value : new Date().toISOString().split('T')[0];
                }
            } else {
                buildReleasedGroup.style.display = 'none';
                buildReleasedInput.removeAttribute('required');
            }
        });
    }

    // --- SEARCH LISTENERS ---
    const safeInput = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('input', fn); };
    safeInput('search-customers', renderCustomersTable);
    safeInput('search-builds', renderBuildsCards);
    safeInput('search-past-builds', renderPastBuildsCards);
    safeInput('search-repairs', renderRepairsTable);
    safeInput('search-welding', renderWeldingJobsTable);
    safeInput('search-welders', renderWeldersTable);
    safeInput('search-gallery', renderGalleryCardsAdmin);

    const safeClick = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    safeClick('btn-view-all-builds', () => switchDashboardTab('tab-builds'));
    safeClick('btn-view-all-labor', () => switchDashboardTab('tab-welders'));
    safeClick('btn-cancel-welder-job', () => resetWelderJobForm());

    // --- MATERIALS CATALOG LISTENERS ---
    safeInput('search-materials', () => { state.materialsCurrentPage = 1; renderMaterialsTable(); });

    const filterMaterialsCat = document.getElementById('filter-materials-category');
    if (filterMaterialsCat) {
        filterMaterialsCat.addEventListener('change', () => {
            state.materialsCurrentPage = 1;
            renderMaterialsTable();
        });
    }

    const filterMaterialsStatus = document.getElementById('filter-materials-status');
    if (filterMaterialsStatus) {
        filterMaterialsStatus.addEventListener('change', () => {
            state.materialsCurrentPage = 1;
            renderMaterialsTable();
        });
    }

    const sortMaterialsSelect = document.getElementById('sort-materials');
    if (sortMaterialsSelect) {
        sortMaterialsSelect.addEventListener('change', () => {
            state.materialsCurrentPage = 1;
            renderMaterialsTable();
        });
    }

    safeClick('btn-materials-prev', () => {
        if (state.materialsCurrentPage > 1) {
            state.materialsCurrentPage--;
            renderMaterialsTable();
        }
    });

    safeClick('btn-materials-next', () => {
        state.materialsCurrentPage++;
        renderMaterialsTable();
    });

    // --- VISITOR INQUIRY FORM ---
    const visitorInquiryForm = document.getElementById('visitor-inquiry-form');
    const visitorPhoneInput = document.getElementById('visitor-phone');
    if (visitorPhoneInput) {
        visitorPhoneInput.addEventListener('input', (e) => {
            // Strip out non-digits from input
            e.target.value = e.target.value.replace(/\D/g, '');
        });
    }

    if (visitorInquiryForm) {
        visitorInquiryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopImmediatePropagation(); // prevent any other listeners from firing
            const name = document.getElementById('visitor-name').value.trim();
            const email = document.getElementById('visitor-email').value.trim();
            const phone = document.getElementById('visitor-phone').value.trim();
            const service = document.getElementById('visitor-service').value.trim();
            const message = document.getElementById('visitor-message').value.trim();
            const date = new Date().toISOString().split('T')[0];
            const newId = generateUID('INQ', state.inquiries);
            const newInq = { id: newId, name, email, phone, service, message, date, seen: false };
            state.inquiries.push(newInq);
            await saveDocToFirestore(COLLECTIONS.INQUIRIES, newInq);

            // Populate the receipt modal fields
            document.getElementById('receipt-id').textContent = newId;
            document.getElementById('receipt-date').textContent = date;
            document.getElementById('receipt-name').textContent = name;
            document.getElementById('receipt-email').textContent = email;
            document.getElementById('receipt-phone').textContent = phone;
            document.getElementById('receipt-service').textContent = service;
            document.getElementById('receipt-message').textContent = message;

            // Open the custom receipt modal
            openFormModal('modal-inquiry-receipt');
            visitorInquiryForm.reset();
        });
    }

    // --- ADMIN CONTACT SETTINGS FORM ---
    const formShopContact = document.getElementById('form-shop-contact');
    if (formShopContact) {
        formShopContact.addEventListener('submit', async (e) => {
            e.preventDefault();
            state.contactInfo = {
                phone: document.getElementById('contact-phone-input').value,
                email: document.getElementById('contact-email-input').value,
                address: document.getElementById('contact-address-input').value
            };
            await saveSettingsDoc('contactInfo', state.contactInfo);
            renderShopContactInfo();
            alert("Shop contact information has been updated successfully.");
        });
    }

    // --- DATE DISPLAY ---
    const dateText = document.getElementById('current-date');
    if (dateText) {
        dateText.textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // --- SCROLL NAV HIGHLIGHT ---
    const sections = document.querySelectorAll('section');
    const navItems = document.querySelectorAll('.nav-link-item');
    
    if ('IntersectionObserver' in window) {
        const observerOptions = {
            root: null,
            rootMargin: '-120px 0px -60% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const current = entry.target.getAttribute('id');
                    navItems.forEach(item => {
                        item.classList.remove('active');
                        if (item.getAttribute('href') && item.getAttribute('href').slice(1) === current) {
                            item.classList.add('active');
                        }
                    });
                }
            });
        }, observerOptions);

        sections.forEach(section => observer.observe(section));
    } else {
        // Fallback for older browsers
        window.addEventListener('scroll', () => {
            let current = '';
            const scrollY = window.pageYOffset || window.scrollY || 0;
            sections.forEach(section => {
                if (scrollY >= (section.offsetTop - 150)) {
                    current = section.getAttribute('id');
                }
            });
            navItems.forEach(item => {
                item.classList.remove('active');
                if (item.getAttribute('href') && item.getAttribute('href').slice(1) === current) {
                    item.classList.add('active');
                }
            });
        });
    }

    // --- RESIZE HANDLER ---
    window.addEventListener('resize', () => {
        if (activeTab === 'tab-overview') renderDailyTraffic();
    });

    // --- PAYROLL & VALE SUB-TABS SWITCHING ---
    const subTabButtons = document.querySelectorAll('.sub-tab-btn');
    const subTabPanes = document.querySelectorAll('.sub-tab-pane');
    
    subTabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-subtab');
            subTabButtons.forEach(b => {
                b.classList.remove('active');
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            btn.style.color = 'var(--text-secondary)';
            
            subTabPanes.forEach(pane => {
                pane.style.display = 'none';
            });
            document.getElementById(target).style.display = 'block';
            
            // Adjust Quick Add button visibility and label
            if (target === 'subtab-weekly-payroll') {
                btnQuickAdd.style.display = 'inline-flex';
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-user-plus"></i> Add Employee`;
                renderWeeklyPayroll();
            } else if (target === 'subtab-cash-advances') {
                btnQuickAdd.style.display = 'inline-flex';
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-plus"></i> Request Vale`;
                renderVales();
            } else if (target === 'subtab-manage-employees') {
                btnQuickAdd.style.display = 'inline-flex';
                btnQuickAdd.innerHTML = `<i class="fa-solid fa-user-plus"></i> Add Employee`;
                renderWeldersTable();
            } else {
                btnQuickAdd.style.display = 'none';
                if (target === 'subtab-payroll-history') renderPayrollHistory();
                else if (target === 'subtab-employee-ledger') renderEmployeeLedger();
            }
        });
    });

    // --- DATE PICKER CHANGED ---
    const weekPicker = document.getElementById('payroll-week-picker');
    if (weekPicker) {
        weekPicker.value = new Date().toISOString().split('T')[0];
        weekPicker.addEventListener('change', () => {
            renderWeeklyPayroll();
        });
    }

    // --- SELECT ALL CHECKBOX ---
    const selectAllCheckbox = document.getElementById('payroll-select-all');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('.payroll-row-checkbox');
            checkboxes.forEach(cb => {
                if (!cb.disabled) cb.checked = this.checked;
            });
            updateBulkSelectionSummary();
        });
    }

    // --- BULK PROCESS BUTTON ---
    const btnMarkPaidBulk = document.getElementById('btn-mark-paid-bulk');
    if (btnMarkPaidBulk) {
        btnMarkPaidBulk.addEventListener('click', () => {
            openFormModal('modal-confirm-payroll');
        });
    }

    // --- CONFIRM PAYROLL SUBMIT ---
    const btnConfirmPayrollSubmit = document.getElementById('btn-confirm-payroll-submit');
    if (btnConfirmPayrollSubmit) {
        btnConfirmPayrollSubmit.addEventListener('click', async () => {
            closeFormModal('modal-confirm-payroll');
            await processBulkPayroll();
        });
    }

    // --- VALE REQUEST FORM ---
    const formVale = document.getElementById('form-vale');
    if (formVale) {
        formVale.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveValeSubmit();
        });
    }

    // --- LEDGER EMPLOYEE SELECT ---
    const ledgerEmployeeSelect = document.getElementById('ledger-employee-select');
    if (ledgerEmployeeSelect) {
        ledgerEmployeeSelect.addEventListener('change', () => {
            renderEmployeeLedger();
        });
    }

    // --- WEEKLY WORK LOG FORM SUBMIT ---
    const formWeeklyWorkLog = document.getElementById('form-weekly-work-log');
    if (formWeeklyWorkLog) {
        formWeeklyWorkLog.addEventListener('submit', async (e) => {
            e.preventDefault();
            const welderId = document.getElementById('work-log-employee').value;
            
            if (welderId === 'all') {
                alert("Please select a specific employee (welder) to log work.");
                return;
            }
            
            const amount = parseFloat(document.getElementById('work-log-amount').value) || 0;
            const date = document.getElementById('work-log-date').value;
            const desc = document.getElementById('work-log-desc').value;
            
            const welder = state.welders.find(w => w.id === welderId);
            if (!welder) return;
            
            if (!welder.jobs) welder.jobs = [];
            const newJobId = `JOB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            welder.jobs.push({
                id: newJobId,
                desc: desc,
                amount: amount,
                date: date,
                status: 'Unpaid'
            });
            
            await saveDocToFirestore(COLLECTIONS.WELDERS, welder);
            
            // Reset input values
            document.getElementById('work-log-amount').value = '';
            document.getElementById('work-log-desc').value = '';
            
            // Re-render
            renderWeeklyPayroll();
            if (typeof renderWeldersTable === 'function') renderWeldersTable();
            alert(`Logged work entry successfully for ${welder.name}!`);
        });
    }

    // --- WORK LOG EMPLOYEE SELECT CHANGE ---
    const workLogEmployee = document.getElementById('work-log-employee');
    if (workLogEmployee) {
        workLogEmployee.addEventListener('change', () => {
            if (typeof renderWeeklyWorkEntries === 'function') renderWeeklyWorkEntries();
        });
    }

    // --- DAILY CASH FLOW LISTENERS ---
    const btnOpenMoneyIn = document.getElementById('btn-open-money-in');
    if (btnOpenMoneyIn) {
        btnOpenMoneyIn.addEventListener('click', openMoneyInModal);
    }

    const btnOpenMoneyOut = document.getElementById('btn-open-money-out');
    if (btnOpenMoneyOut) {
        btnOpenMoneyOut.addEventListener('click', openMoneyOutModal);
    }

    const trafficDatePicker = document.getElementById('traffic-date-picker');
    if (trafficDatePicker) {
        const todayStr = getLocalDateString();
        state.activeTrafficDate = todayStr;
        trafficDatePicker.value = todayStr;
        
        trafficDatePicker.addEventListener('change', (e) => {
            state.activeTrafficDate = e.target.value;
            checkAndBootstrapTrafficForDate(state.activeTrafficDate).then(() => {
                renderDailyTraffic();
            });
        });
    }

    const formMoneyIn = document.getElementById('form-money-in');
    if (formMoneyIn) {
        formMoneyIn.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = parseFloat(document.getElementById('money-in-amount-input').value) || 0;
            const note = document.getElementById('money-in-note-input').value.trim();
            
            if (amount <= 0) {
                alert("Please enter an amount greater than zero.");
                return;
            }
            
            await logMoneyInForDate(amount, note);
            document.getElementById('money-in-amount-input').value = '';
            document.getElementById('money-in-note-input').value = '';
        });
    }

    const formMoneyOut = document.getElementById('form-money-out');
    if (formMoneyOut) {
        formMoneyOut.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = parseFloat(document.getElementById('money-out-amount-input').value) || 0;
            const note = document.getElementById('money-out-note-input').value.trim();
            
            if (amount <= 0) {
                alert("Please enter an amount greater than zero.");
                return;
            }
            
            await logMoneyOutForDate(amount, note);
            document.getElementById('money-out-amount-input').value = '';
            document.getElementById('money-out-note-input').value = '';
        });
    }

    // --- CARD COLOR CUSTOMIZER LISTENERS ---
    const formCardColors = document.getElementById('form-card-colors');
    if (formCardColors) {
        formCardColors.addEventListener('submit', saveCardColorsSubmit);
    }
    
    const colorPickers = ['color-stat-bg', 'color-content-bg', 'color-card-text', 'color-card-border'];
    colorPickers.forEach(id => {
        const picker = document.getElementById(id);
        if (picker) {
            picker.addEventListener('input', updateColorsHexPreview);
        }
    });

    // --- INIT DATA ---
    await initStore();
    renderDailyTraffic();
    renderVisitorGallery();



});

// ==========================================================================
// WEEKLY PAYROLL & CASH ADVANCES (VALE) LOGIC
// ==========================================================================

function getMondayOfDate(d) {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function getWeekKeyAndLabel(dateStr) {
    // Parse selected date and extract week boundary dates
    const d = new Date(dateStr);
    const monday = getMondayOfDate(new Date(d));
    const mondayStr = monday.toISOString().split('T')[0];
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const sundayStr = sunday.toISOString().split('T')[0];
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weekLabel = `${monthNames[monday.getMonth()]} ${monday.getDate()} - ${monthNames[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;
    
    return {
        weekKey: mondayStr,
        weekLabel,
        mondayStr,
        sundayStr
    };
}

function renderWeeklyPayroll() {
    const picker = document.getElementById('payroll-week-picker');
    if (!picker) return;
    const selectedDate = picker.value;
    if (!selectedDate) return;
    
    const { weekKey, weekLabel, mondayStr, sundayStr } = getWeekKeyAndLabel(selectedDate);
    document.getElementById('payroll-week-label').textContent = weekLabel;
    
    const tbody = document.getElementById('weekly-payroll-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let totalLaborThisWeek = 0;
    let totalValeThisWeek = 0;
    let totalPayrollDue = 0;
    let waitingCount = 0;
    let paidCount = 0;
    
    // Reset select all checkbox
    const selectAllCb = document.getElementById('payroll-select-all');
    if (selectAllCb) selectAllCb.checked = false;
    
    state.welders.forEach(w => {
        if (!w.jobs) w.jobs = [];
        
        // Find if a payroll record has already been processed and saved for this employee
        const payroll = state.payrolls.find(p => p.employeeId === w.id && p.week === weekKey);
        
        let labor = 0;
        let vale = 0;
        let netPay = 0;
        let status = 'Unpaid';
        let badgeClass = 'badge-warning';
        
        if (payroll) {
            labor = payroll.totalLabor;
            vale = payroll.totalVale;
            netPay = payroll.netPay;
            status = payroll.status || (netPay < 0 ? 'Paid (Over Vale)' : 'Paid');
            badgeClass = status.includes('Over Vale') ? 'badge-info' : 'badge-success';
            paidCount++;
        } else {
            // Calculate unpaid labor cost during this week
            const unpaidJobs = w.jobs.filter(j => j.status !== 'Paid' && j.date >= mondayStr && j.date <= sundayStr);
            labor = unpaidJobs.reduce((sum, j) => sum + j.amount, 0);
            
            // Calculate unpaid cash advances (vales) during this week
            const unpaidVales = state.vales.filter(v => v.employeeId === w.id && v.status !== 'Settled' && v.date >= mondayStr && v.date <= sundayStr);
            vale = unpaidVales.reduce((sum, v) => sum + v.amount, 0);
            
            netPay = labor - vale;
            if (netPay < 0) {
                status = 'Paid (Over Vale)';
                badgeClass = 'badge-info';
            } else {
                status = 'Unpaid';
                badgeClass = 'badge-warning';
            }
            
            if (labor > 0 || vale > 0) {
                waitingCount++;
                totalLaborThisWeek += labor;
                totalValeThisWeek += vale;
                totalPayrollDue += netPay;
            }
        }
        
        if (payroll || labor > 0 || vale > 0) {
            const isDisabled = !!payroll;
            tbody.innerHTML += `
                <tr>
                    <td><input type="checkbox" class="payroll-row-checkbox" value="${w.id}" data-labor="${labor}" data-vale="${vale}" data-net="${netPay}" ${isDisabled ? 'disabled' : ''}></td>
                    <td><strong>${w.id}</strong></td>
                    <td><span style="font-weight: 600; cursor: pointer; color: var(--accent);" onclick="openPayrollDetails('${w.id}', '${weekKey}', '${status}')">${w.name}</span></td>
                    <td>₱${labor.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td>₱${vale.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td style="font-weight: 700; color: ${netPay >= 0 ? 'var(--success)' : 'var(--danger)'}">₱${netPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td><span class="badge ${badgeClass}">${status}</span></td>
                    <td>
                        <div class="table-actions-cell">
                            <button class="btn-icon" onclick="openPayrollDetails('${w.id}', '${weekKey}', '${status}')" title="View Weekly Breakdown"><i class="fa-solid fa-eye"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }
    });
    
    if (tbody.innerHTML === '') {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No payroll activities this week.</td></tr>`;
    }
    
    // Update metrics UI elements
    document.getElementById('payroll-metric-total-labor').textContent = `₱${totalLaborThisWeek.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('payroll-metric-total-vale').textContent = `₱${totalValeThisWeek.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('payroll-metric-total-due').textContent = `₱${totalPayrollDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('payroll-metric-waiting-count').textContent = `${waitingCount} Waiting`;
    document.getElementById('payroll-metric-paid-count').textContent = `${paidCount} Paid`;
    
    // Bind listeners to table row checkboxes
    const checkboxes = document.querySelectorAll('.payroll-row-checkbox');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            updateBulkSelectionSummary();
        });
    });
    
    updateBulkSelectionSummary();

    // Populate work logger employee options
    const workLogSelect = document.getElementById('work-log-employee');
    if (workLogSelect) {
        const currentSelected = workLogSelect.value || 'all';
        workLogSelect.innerHTML = '<option value="all">All Employees</option>';
        state.welders.forEach(w => {
            workLogSelect.innerHTML += `<option value="${w.id}">${w.name}</option>`;
        });
        workLogSelect.value = currentSelected;
    }

    // Set work logger date value
    const workLogDate = document.getElementById('work-log-date');
    if (workLogDate && !workLogDate.value) {
        workLogDate.value = selectedDate;
    }

    // Render weekly work entries
    renderWeeklyWorkEntries();
}

function renderWeeklyWorkEntries() {
    const picker = document.getElementById('payroll-week-picker');
    if (!picker) return;
    const selectedDate = picker.value;
    if (!selectedDate) return;
    
    const { mondayStr, sundayStr } = getWeekKeyAndLabel(selectedDate);
    const tbody = document.getElementById('weekly-work-entries-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const filterEmployeeId = document.getElementById('work-log-employee') ? document.getElementById('work-log-employee').value : 'all';
    
    const weeklyJobs = [];
    state.welders.forEach(w => {
        // Filter by selected employee if not 'all'
        if (filterEmployeeId !== 'all' && w.id !== filterEmployeeId) return;
        
        (w.jobs || []).forEach(j => {
            if (j.date >= mondayStr && j.date <= sundayStr) {
                weeklyJobs.push({
                    welderId: w.id,
                    welderName: w.name,
                    job: j
                });
            }
        });
    });
    
    // Sort descending by date
    weeklyJobs.sort((a, b) => b.job.date.localeCompare(a.job.date));
    
    if (weeklyJobs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 15px;">No work entries logged for this week.</td></tr>`;
    } else {
        weeklyJobs.forEach(wj => {
            const j = wj.job;
            const badgeClass = j.status === 'Paid' ? 'badge-success' : 'badge-warning';
            tbody.innerHTML += `
                <tr>
                    <td>${j.date}</td>
                    <td><strong>${wj.welderName}</strong></td>
                    <td style="text-align: left;">${j.desc}</td>
                    <td style="font-weight: 600;">₱${j.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td><span class="badge ${badgeClass}">${j.status}</span></td>
                    <td>
                        <div class="table-actions-cell" style="justify-content: flex-end;">
                            ${j.status === 'Paid' ? '' : `<button class="btn-icon delete" onclick="deleteWeeklyWorkEntry('${wj.welderId}', '${j.id}')" title="Delete Work Entry"><i class="fa-solid fa-trash"></i></button>`}
                        </div>
                    </td>
                </tr>
            `;
        });
    }
}

function updateBulkSelectionSummary() {
    const checkboxes = document.querySelectorAll('.payroll-row-checkbox:checked');
    const count = checkboxes.length;
    let totalNet = 0;
    
    checkboxes.forEach(cb => {
        totalNet += parseFloat(cb.getAttribute('data-net')) || 0;
    });
    
    document.getElementById('selected-employees-count').textContent = count;
    document.getElementById('selected-payroll-total').textContent = `₱${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    
    const btn = document.getElementById('btn-mark-paid-bulk');
    if (btn) {
        btn.disabled = count === 0;
    }
}

async function processBulkPayroll() {
    const picker = document.getElementById('payroll-week-picker');
    if (!picker) return;
    const selectedDate = picker.value;
    if (!selectedDate) return;
    
    const { weekKey, weekLabel, mondayStr, sundayStr } = getWeekKeyAndLabel(selectedDate);
    const checkboxes = document.querySelectorAll('.payroll-row-checkbox:checked');
    if (checkboxes.length === 0) return;
    
    const todayStr = new Date().toISOString().split('T')[0];
    const promises = [];
    
    for (const cb of checkboxes) {
        const welderId = cb.value;
        const labor = parseFloat(cb.getAttribute('data-labor')) || 0;
        const vale = parseFloat(cb.getAttribute('data-vale')) || 0;
        const net = parseFloat(cb.getAttribute('data-net')) || 0;
        
        const welder = state.welders.find(w => w.id === welderId);
        if (!welder) continue;
        
        // 1. Mark included work entries as Paid in local state and Firestore
        const workEntryIds = [];
        if (welder.jobs) {
            welder.jobs.forEach(j => {
                if (j.status !== 'Paid' && j.date >= mondayStr && j.date <= sundayStr) {
                    j.status = 'Paid';
                    workEntryIds.push(j.id);
                }
            });
        }
        promises.push(saveDocToFirestore(COLLECTIONS.WELDERS, welder));
        
        // 2. Mark related vale records as Settled in local state and Firestore
        const valeIds = [];
        const relatedVales = state.vales.filter(v => v.employeeId === welderId && v.status !== 'Settled' && v.date >= mondayStr && v.date <= sundayStr);
        relatedVales.forEach(v => {
            v.status = 'Settled';
            valeIds.push(v.id);
            promises.push(saveDocToFirestore(COLLECTIONS.VALES, v));
        });
        
        // 3. Create payroll record
        const payrollId = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const payrollDoc = {
            id: payrollId,
            employeeId: welderId,
            employeeName: welder.name,
            week: weekKey,
            weekLabel: weekLabel,
            totalLabor: labor,
            totalVale: vale,
            netPay: net,
            status: net < 0 ? 'Paid (Over Vale)' : 'Paid',
            datePaid: todayStr,
            workEntryIds: workEntryIds,
            valeIds: valeIds
        };
        state.payrolls.push(payrollDoc);
        promises.push(saveDocToFirestore(COLLECTIONS.PAYROLLS, payrollDoc));
    }
    
    try {
        await Promise.all(promises);
        alert(`Successfully processed payroll for ${checkboxes.length} employees!`);
        renderWeeklyPayroll();
        renderVales();
    } catch (e) {
        console.error("Error processing bulk payroll:", e);
        alert("Failed to process payroll. Please try again.");
    }
}

function renderVales() {
    const tbody = document.getElementById('vales-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchVal = document.getElementById('search-vales').value.toLowerCase();
    
    const filtered = state.vales.filter(v =>
        v.employeeName.toLowerCase().includes(searchVal) ||
        (v.reason && v.reason.toLowerCase().includes(searchVal)) ||
        (v.notes && v.notes.toLowerCase().includes(searchVal))
    );
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No cash advances found.</td></tr>`;
        return;
    }
    
    // Sort descending by date
    filtered.sort((a, b) => b.date.localeCompare(a.date));
    
    filtered.forEach(v => {
        const badgeClass = v.status === 'Settled' ? 'badge-success' : 'badge-warning';
        const isSettled = v.status === 'Settled';
        tbody.innerHTML += `
            <tr>
                <td><strong class="text-glow" style="color: var(--accent); font-family: monospace;">${v.id}</strong></td>
                <td><span style="font-weight: 600;">${v.employeeName}</span></td>
                <td style="font-weight: 700; color: var(--warning);">₱${v.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>${v.date}</td>
                <td>${v.reason || 'N/A'}</td>
                <td style="max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px;" title="${v.notes || ''}">${v.notes || 'N/A'}</td>
                <td><span class="badge ${badgeClass}">${v.status || 'Unpaid'}</span></td>
                <td>
                    <div class="table-actions-cell">
                        ${isSettled ? '' : `<button class="btn-icon delete" onclick="deleteItem('vale', '${v.id}')" title="Delete Vale"><i class="fa-solid fa-trash"></i></button>`}
                    </div>
                </td>
            </tr>
        `;
    });
}

function openAddValeModal() {
    const select = document.getElementById('vale-welder');
    if (!select) return;
    select.innerHTML = '';
    
    state.welders.forEach(w => {
        select.innerHTML += `<option value="${w.id}">${w.name}</option>`;
    });
    
    document.getElementById('vale-id').value = '';
    document.getElementById('vale-amount').value = '';
    document.getElementById('vale-reason').value = '';
    document.getElementById('vale-notes').value = '';
    document.getElementById('vale-date').value = new Date().toISOString().split('T')[0];
    
    openFormModal('modal-vale');
}

async function saveValeSubmit() {
    const welderId = document.getElementById('vale-welder').value;
    const welder = state.welders.find(w => w.id === welderId);
    if (!welder) return;
    
    const amount = parseFloat(document.getElementById('vale-amount').value) || 0;
    const date = document.getElementById('vale-date').value;
    const reason = document.getElementById('vale-reason').value;
    const notes = document.getElementById('vale-notes').value;
    
    if (amount <= 0) {
        alert("Amount must be greater than 0.");
        return;
    }
    
    const newId = `VALE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newVale = {
        id: newId,
        employeeId: welderId,
        employeeName: welder.name,
        amount,
        date,
        reason,
        notes,
        status: 'Unpaid'
    };
    
    state.vales.push(newVale);
    await saveDocToFirestore(COLLECTIONS.VALES, newVale);
    closeFormModal('modal-vale');
    renderVales();
    renderWeeklyPayroll();
}

function renderPayrollHistory() {
    const tbody = document.getElementById('payroll-history-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const searchVal = document.getElementById('search-payroll-history').value.toLowerCase();
    
    const filtered = state.payrolls.filter(p =>
        p.employeeName.toLowerCase().includes(searchVal) ||
        p.weekLabel.toLowerCase().includes(searchVal) ||
        p.id.toLowerCase().includes(searchVal)
    );
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No payroll history found.</td></tr>`;
        return;
    }
    
    // Sort by datePaid descending
    filtered.sort((a, b) => b.datePaid.localeCompare(a.datePaid));
    
    filtered.forEach(p => {
        tbody.innerHTML += `
            <tr>
                <td><strong class="text-glow" style="color: var(--accent); font-family: monospace;">${p.id}</strong></td>
                <td><span style="font-weight: 600;">${p.employeeName}</span></td>
                <td>${p.weekLabel}</td>
                <td>₱${p.totalLabor.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style="color: var(--warning);">₱${p.totalVale.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td style="font-weight: 700; color: ${p.netPay >= 0 ? 'var(--success)' : 'var(--danger)'}">₱${p.netPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td>${p.datePaid}</td>
                <td>
                    <div class="table-actions-cell">
                        <button class="btn-icon" onclick="openPayrollDetails('${p.employeeId}', '${p.week}', '${p.status || 'Paid'}')" title="View Receipt"><i class="fa-solid fa-file-invoice-dollar"></i></button>
                        <button class="btn-icon delete" onclick="deleteItem('payroll', '${p.id}')" title="Delete Record"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

function renderEmployeeLedger() {
    const select = document.getElementById('ledger-employee-select');
    if (!select) return;
    
    // Populate select element if employee count changed
    const currentCount = select.options.length - 1; 
    if (currentCount !== state.welders.length) {
        const currentSelected = select.value;
        select.innerHTML = '<option value="" disabled selected>Choose an employee...</option>';
        state.welders.forEach(w => {
            select.innerHTML += `<option value="${w.id}">${w.name}</option>`;
        });
        if (currentSelected) select.value = currentSelected;
    }
    
    const welderId = select.value;
    const ledgerContent = document.getElementById('ledger-content');
    if (!welderId) {
        if (ledgerContent) ledgerContent.style.display = 'none';
        return;
    }
    
    if (ledgerContent) ledgerContent.style.display = 'block';
    
    const welder = state.welders.find(w => w.id === welderId);
    if (!welder) return;
    
    let totalEarnings = 0;
    let totalVale = 0;
    let totalDue = 0;
    const transactions = [];
    
    // 1. Work Entries (Labor)
    if (welder.jobs) {
        welder.jobs.forEach(j => {
            totalEarnings += j.amount;
            if (j.status !== 'Paid') {
                totalDue += j.amount;
            }
            transactions.push({
                date: j.date,
                type: 'Earning',
                desc: `Labor Earned: ${j.desc}`,
                amount: j.amount,
                status: j.status
            });
        });
    }
    
    // 2. Cash Advances (Vales)
    const employeeVales = state.vales.filter(v => v.employeeId === welderId);
    employeeVales.forEach(v => {
        totalVale += v.amount;
        if (v.status !== 'Settled') {
            totalDue -= v.amount;
        }
        transactions.push({
            date: v.date,
            type: 'Vale',
            desc: `Cash Advance: ${v.reason || 'Personal'}`,
            amount: -v.amount,
            status: v.status
        });
    });
    
    // 3. Payouts (Payrolls)
    const employeePayrolls = state.payrolls.filter(p => p.employeeId === welderId);
    employeePayrolls.forEach(p => {
        transactions.push({
            date: p.datePaid,
            type: 'Payout',
            desc: `Payroll Payout: ${p.weekLabel}`,
            amount: -p.netPay,
            status: 'Paid'
        });
    });
    
    // Sort transactions by date descending
    transactions.sort((a, b) => b.date.localeCompare(a.date));
    
    // Render metrics elements
    document.getElementById('ledger-total-earnings').textContent = `₱${totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('ledger-total-vale').textContent = `₱${totalVale.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('ledger-total-due').textContent = `₱${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    
    // Render transactions table
    const tbody = document.getElementById('ledger-table-body');
    if (tbody) {
        tbody.innerHTML = '';
        if (transactions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No ledger entries found.</td></tr>`;
            return;
        }
        
        transactions.forEach(t => {
            let amountClass = 'text-glow';
            let displayAmount = `₱${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
            if (t.amount < 0) {
                amountClass = 'text-glow-danger';
                displayAmount = `-₱${Math.abs(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
            } else {
                amountClass = 'text-glow-success';
            }
            
            let badgeClass = 'badge-warning';
            let statusLabel = t.status;
            if (t.status === 'Paid' || t.status === 'Settled') {
                badgeClass = 'badge-success';
                statusLabel = t.status === 'Settled' ? 'Settled' : 'Paid';
            }
            
            tbody.innerHTML += `
                <tr>
                    <td>${t.date}</td>
                    <td><span style="font-weight: 600;">${t.type}</span></td>
                    <td>${t.desc}</td>
                    <td class="${amountClass}" style="font-weight: 700;">${displayAmount}</td>
                    <td><span class="badge ${badgeClass}">${statusLabel}</span></td>
                </tr>
            `;
        });
    }
}

let activePayrollDetails = null;

function openPayrollDetails(employeeId, weekKey, status) {
    const welder = state.welders.find(w => w.id === employeeId);
    if (!welder) return;
    
    const { weekLabel, mondayStr, sundayStr } = getWeekKeyAndLabel(weekKey);
    
    document.getElementById('detail-employee-name').textContent = welder.name;
    document.getElementById('detail-payroll-week').textContent = `Payroll Week: ${weekLabel}`;
    
    const workEntriesContainer = document.getElementById('detail-work-entries-list');
    const valesContainer = document.getElementById('detail-vales-list');
    
    workEntriesContainer.innerHTML = '';
    valesContainer.innerHTML = '';
    
    let laborTotal = 0;
    let valeTotal = 0;
    let netTotal = 0;
    let datePaidVal = 'N/A';
    let includedJobs = [];
    let includedVales = [];
    
    if (status.startsWith('Paid')) {
        const payroll = state.payrolls.find(p => p.employeeId === employeeId && p.week === weekKey);
        if (!payroll) return;
        
        laborTotal = payroll.totalLabor;
        valeTotal = payroll.totalVale;
        netTotal = payroll.netPay;
        datePaidVal = payroll.datePaid;
        
        includedJobs = (welder.jobs || []).filter(j => payroll.workEntryIds.includes(j.id) || (j.status === 'Paid' && j.date >= mondayStr && j.date <= sundayStr));
        if (includedJobs.length === 0) {
            workEntriesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">No work entries linked.</div>`;
        } else {
            includedJobs.forEach(j => {
                workEntriesContainer.innerHTML += `
                    <div class="receipt-row" style="font-size: 13px; display: flex; justify-content: space-between;">
                        <span>${j.date} — ${j.desc}</span>
                        <span style="font-weight: 500;">₱${j.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                `;
            });
        }
        
        includedVales = state.vales.filter(v => payroll.valeIds.includes(v.id) || (v.employeeId === employeeId && v.status === 'Settled' && v.date >= mondayStr && v.date <= sundayStr));
        if (includedVales.length === 0) {
            valesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">No cash advances.</div>`;
        } else {
            includedVales.forEach(v => {
                valesContainer.innerHTML += `
                    <div class="receipt-row" style="font-size: 13px; color: var(--warning); display: flex; justify-content: space-between;">
                        <span>${v.date} — ${v.reason || 'Personal'}</span>
                        <span style="font-weight: 500;">₱${v.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                `;
            });
        }
        
        const isOver = netTotal < 0;
        document.getElementById('detail-status').textContent = isOver ? 'Paid (Over Vale)' : 'Paid';
        document.getElementById('detail-status').className = isOver ? 'receipt-value badge-info-text' : 'receipt-value badge-success-text';
        document.getElementById('detail-date-paid-row').style.display = 'flex';
        document.getElementById('detail-date-paid').textContent = datePaidVal;
    } else {
        includedJobs = (welder.jobs || []).filter(j => j.status !== 'Paid' && j.date >= mondayStr && j.date <= sundayStr);
        laborTotal = includedJobs.reduce((sum, j) => sum + j.amount, 0);
        
        includedVales = state.vales.filter(v => v.employeeId === employeeId && v.status !== 'Settled' && v.date >= mondayStr && v.date <= sundayStr);
        valeTotal = includedVales.reduce((sum, v) => sum + v.amount, 0);
        
        netTotal = laborTotal - valeTotal;
        
        if (includedJobs.length === 0) {
            workEntriesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">No unpaid work entries.</div>`;
        } else {
            includedJobs.forEach(j => {
                workEntriesContainer.innerHTML += `
                    <div class="receipt-row" style="font-size: 13px; display: flex; justify-content: space-between;">
                        <span>${j.date} — ${j.desc}</span>
                        <span style="font-weight: 500;">₱${j.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                `;
            });
        }
        
        if (includedVales.length === 0) {
            valesContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">No cash advances.</div>`;
        } else {
            includedVales.forEach(v => {
                valesContainer.innerHTML += `
                    <div class="receipt-row" style="font-size: 13px; color: var(--warning); display: flex; justify-content: space-between;">
                        <span>${v.date} — ${v.reason || 'Personal'}</span>
                        <span style="font-weight: 500;">₱${v.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                `;
            });
        }
        
        const isOver = netTotal < 0;
        document.getElementById('detail-status').textContent = isOver ? 'Paid (Over Vale)' : 'Unpaid';
        document.getElementById('detail-status').className = isOver ? 'receipt-value badge-info-text' : 'receipt-value badge-warning-text';
        document.getElementById('detail-date-paid-row').style.display = 'none';
    }
    
    document.getElementById('detail-total-labor').textContent = `₱${laborTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('detail-total-vale').textContent = `₱${valeTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    document.getElementById('detail-net-pay').textContent = `₱${netTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    
    activePayrollDetails = {
        employeeName: welder.name,
        weekLabel,
        laborTotal,
        valeTotal,
        netTotal,
        status,
        datePaid: datePaidVal,
        workEntries: includedJobs,
        vales: includedVales
    };
    
    openFormModal('modal-payroll-details');
}

function printPayrollReceipt() {
    window.print();
}

function exportPayrollToCSV() {
    if (!activePayrollDetails) return;
    
    const p = activePayrollDetails;
    let csvContent = "\ufeff"; // BOM for excel utf8 encoding
    
    csvContent += `Weekly Payroll Receipt\n`;
    csvContent += `Employee Name,${p.employeeName}\n`;
    csvContent += `Payroll Week,${p.weekLabel}\n`;
    csvContent += `Status,${p.status}\n`;
    if (p.status === 'Paid') {
        csvContent += `Date Paid,${p.datePaid}\n`;
    }
    csvContent += `\n`;
    
    csvContent += `Work Entries (Labor Earned)\n`;
    csvContent += `Date,Description,Amount\n`;
    p.workEntries.forEach(j => {
        csvContent += `${j.date},"${j.desc}",${j.amount}\n`;
    });
    csvContent += `Total Labor Cost,,₱${p.laborTotal}\n`;
    csvContent += `\n`;
    
    csvContent += `Cash Advances (Vale Deducted)\n`;
    csvContent += `Date,Reason,Amount\n`;
    p.vales.forEach(v => {
        csvContent += `${v.date},"${v.reason || 'Personal'}",${v.amount}\n`;
    });
    csvContent += `Total Cash Advances,,₱${p.valeTotal}\n`;
    csvContent += `\n`;
    
    csvContent += `Net Payout,,₱${p.netTotal}\n`;
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Payroll_Receipt_${p.employeeName.replace(/\s+/g, '_')}_${p.weekLabel.replace(/[\s,]+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Bind to window scope
window.getMondayOfDate = getMondayOfDate;
window.getWeekKeyAndLabel = getWeekKeyAndLabel;
window.renderWeeklyPayroll = renderWeeklyPayroll;
window.updateBulkSelectionSummary = updateBulkSelectionSummary;
window.processBulkPayroll = processBulkPayroll;
window.renderVales = renderVales;
window.openAddValeModal = openAddValeModal;
window.saveValeSubmit = saveValeSubmit;
window.renderPayrollHistory = renderPayrollHistory;
window.renderEmployeeLedger = renderEmployeeLedger;
window.openPayrollDetails = openPayrollDetails;
window.printPayrollReceipt = printPayrollReceipt;
window.exportPayrollToCSV = exportPayrollToCSV;

async function deleteWeeklyWorkEntry(welderId, jobId) {
    if (!confirm("Are you sure you want to delete this work entry?")) return;
    
    const welder = state.welders.find(w => w.id === welderId);
    if (!welder || !welder.jobs) return;
    
    welder.jobs = welder.jobs.filter(j => j.id !== jobId);
    await saveDocToFirestore(COLLECTIONS.WELDERS, welder);
    
    renderWeeklyPayroll();
    if (typeof renderWeldersTable === 'function') renderWeldersTable();
}

window.deleteWeeklyWorkEntry = deleteWeeklyWorkEntry;
window.deleteItem = deleteItem;
window.renderDailyTraffic = renderDailyTraffic;
window.deleteTrafficTransaction = deleteTrafficTransaction;
window.openMoneyInModal = openMoneyInModal;
window.openMoneyOutModal = openMoneyOutModal;
window.openColorsModal = openColorsModal;
window.applyColorPreset = applyColorPreset;
window.resetCardColors = resetCardColors;




