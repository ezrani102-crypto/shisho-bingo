const tg = window.Telegram.WebApp;

// Expand Mini App to full height
tg.expand();
tg.ready();

const UI = {
  loading: document.getElementById('wallet-loading'),
  balance: document.getElementById('wallet-balance'),
  error: document.getElementById('wallet-error'),
  amount: document.getElementById('balance-amount')
};

// Global state
let currentUser = null;

async function fetchUserData() {
  // 1. Reset UI to Loading State
  UI.loading.classList.remove('hidden');
  UI.balance.classList.add('hidden');
  UI.error.classList.add('hidden');

  try {
    // 2. Use Telegram initData for authentication
    const initData = tg.initData || ''; 
    
    // For local development testing without Telegram, we might need a mock, 
    // but in production initData must be present.
    if (!initData) {
      throw new Error("No Telegram initData found.");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout to prevent infinite loading

    const response = await fetch('/api/me', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${initData}`,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'API Error');
    }

    // 3. Success State
    currentUser = data.user;
    
    // Database returns the exact precise balance, frontend just displays it
    UI.amount.textContent = data.wallet.balance; 
    
    UI.loading.classList.add('hidden');
    UI.balance.classList.remove('hidden');

  } catch (error) {
    console.error('Wallet fetch failed:', error);
    
    // 4. Strict Failure State - NEVER show 0.00 on error!
    UI.loading.classList.add('hidden');
    UI.balance.classList.add('hidden');
    UI.error.classList.remove('hidden');
    
    // Optional: Send haptic feedback on failure
    tg.HapticFeedback.notificationOccurred('error');
  }
}

// Simple Navigation Router
function navigate(tabName) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');
  
  // Later we will implement rendering specific views here
  console.log(`Navigating to ${tabName}`);
}

// Init application
document.addEventListener('DOMContentLoaded', () => {
  fetchUserData();
});