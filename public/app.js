// API Base URL (relative since we serve static files from the same server)
const API_BASE = '/api/wallets';

// DOM Elements
const blockchainSelect = document.getElementById('blockchain-select');
const btnGenerate = document.getElementById('btn-generate');
const btnRefresh = document.getElementById('btn-refresh');
const tableSearch = document.getElementById('table-search');
const tableBody = document.getElementById('table-body');
const statusApi = document.getElementById('status-api');

// Result elements
const resultPlaceholder = document.getElementById('result-placeholder');
const resultLoading = document.getElementById('result-loading');
const resultDetails = document.getElementById('result-details');
const resultCoinBadge = document.getElementById('result-coin-badge');

const valAddress = document.getElementById('val-address');
const valMnemonic = document.getElementById('val-mnemonic');
const valPrivate = document.getElementById('val-private');
const valPublic = document.getElementById('val-public');
const valPath = document.getElementById('val-path');
const valContract = document.getElementById('val-contract');
const metaContractWrapper = document.getElementById('meta-contract-wrapper');

// Admin Settings Elements
const mainBtcAddress = document.getElementById('main-btc-address');
const mainLtcAddress = document.getElementById('main-ltc-address');
const mainEvmAddress = document.getElementById('main-evm-address');
const mainSolAddress = document.getElementById('main-sol-address');
const mainTrxAddress = document.getElementById('main-trx-address');
const btnSaveSettings = document.getElementById('btn-save-settings');

// Custom Contracts Elements
const contractSymbol = document.getElementById('contract-symbol');
const contractName = document.getElementById('contract-name');
const contractNetwork = document.getElementById('contract-network');
const contractAddress = document.getElementById('contract-address');
const btnAddContract = document.getElementById('btn-add-contract');
const contractsList = document.getElementById('contracts-list');

// Registry & configuration state
let walletRegistry = [];
let customContracts = [];

// Default native blockchain choices
const DEFAULT_NATIVE_BLOCKCHAINS = [
  { value: 'eth', label: 'Ethereum (ETH)', network: 'ethereum' },
  { value: 'btc', label: 'Bitcoin (BTC)', network: 'bitcoin' },
  { value: 'bsc', label: 'BNB Smart Chain (BSC)', network: 'bsc' },
  { value: 'polygon', label: 'Polygon (MATIC)', network: 'polygon' },
  { value: 'sol', label: 'Solana (SOL)', network: 'solana' },
  { value: 'trx', label: 'Tron (TRX)', network: 'tron' },
  { value: 'ltc', label: 'Litecoin (LTC)', network: 'litecoin' }
];

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  checkServerHealth();
  fetchWalletRegistry();
  fetchSettings();
  fetchCustomContracts();
  setupEventListeners();
});

// Event Listeners Setup
function setupEventListeners() {
  // Generate Wallet
  btnGenerate.addEventListener('click', generateNewWallet);

  // Save Settings
  btnSaveSettings.addEventListener('click', saveSettings);

  // Add Custom Contract
  btnAddContract.addEventListener('click', addCustomContract);

  // Refresh Table
  btnRefresh.addEventListener('click', () => {
    btnRefresh.querySelector('i').classList.add('fa-spin');
    fetchWalletRegistry().finally(() => {
      setTimeout(() => {
        btnRefresh.querySelector('i').classList.remove('fa-spin');
      }, 500);
    });
  });

  // Filter Table search
  tableSearch.addEventListener('input', filterRegistryTable);

  // Copy and reveal triggers
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy');
    if (copyBtn) {
      const targetId = copyBtn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        copyToClipboard(input.value);
      }
    }

    const revealBtn = e.target.closest('.btn-reveal');
    if (revealBtn) {
      const targetId = revealBtn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          revealBtn.innerHTML = '<i class="fa-regular fa-eye"></i>';
        } else {
          input.type = 'password';
          revealBtn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
        }
      }
    }
  });
}

// Fetch Server Health
async function checkServerHealth() {
  try {
    const res = await fetch('/health');
    if (res.ok) {
      statusApi.innerHTML = '<i class="fa-solid fa-circle"></i> Connected';
      statusApi.className = 'stat-value status-online';
    } else {
      throw new Error();
    }
  } catch (error) {
    statusApi.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Disconnected';
    statusApi.className = 'stat-value text-red';
    showToast('Failed to connect to API server.', 'error');
  }
}

// Fetch Master Addresses settings
async function fetchSettings() {
  try {
    const res = await fetch(`${API_BASE}/config/settings`);
    const data = await res.json();
    if (data.success && data.data) {
      const settings = data.data;
      mainBtcAddress.value = settings.main_btc_address || '';
      mainLtcAddress.value = settings.main_ltc_address || '';
      mainEvmAddress.value = settings.main_evm_address || '';
      mainSolAddress.value = settings.main_sol_address || '';
      mainTrxAddress.value = settings.main_trx_address || '';
    }
  } catch (error) {
    showToast('Error loading master sweep addresses.', 'error');
  }
}

// Save Master Addresses settings
async function saveSettings() {
  btnSaveSettings.disabled = true;
  const originalHtml = btnSaveSettings.innerHTML;
  btnSaveSettings.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

  const settings = {
    main_btc_address: mainBtcAddress.value.trim(),
    main_ltc_address: mainLtcAddress.value.trim(),
    main_evm_address: mainEvmAddress.value.trim(),
    main_sol_address: mainSolAddress.value.trim(),
    main_trx_address: mainTrxAddress.value.trim()
  };

  try {
    const res = await fetch(`${API_BASE}/config/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Master addresses saved successfully.', 'success');
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    showToast(error.message || 'Failed to save master addresses.', 'error');
  } finally {
    btnSaveSettings.disabled = false;
    btnSaveSettings.innerHTML = originalHtml;
  }
}

// Fetch Custom Contract Tokens
async function fetchCustomContracts() {
  try {
    const res = await fetch(`${API_BASE}/config/contracts`);
    const data = await res.json();
    if (data.success && data.data) {
      customContracts = data.data;
      renderContractsList(customContracts);
      populateBlockchainSelect(customContracts);
    }
  } catch (error) {
    showToast('Error loading custom tokens.', 'error');
  }
}

// Render dynamic blockchain choices in Generator select
function populateBlockchainSelect(contracts) {
  const selectedVal = blockchainSelect.value;
  blockchainSelect.innerHTML = '';

  // 1. Native option group
  const nativeGroup = document.createElement('optgroup');
  nativeGroup.label = 'Native Blockchains';
  DEFAULT_NATIVE_BLOCKCHAINS.forEach(bc => {
    const opt = document.createElement('option');
    opt.value = bc.value;
    opt.textContent = bc.label;
    nativeGroup.appendChild(opt);
  });
  blockchainSelect.appendChild(nativeGroup);

  // 2. Custom contract token option group
  if (contracts.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Custom & Stable Tokens';
    contracts.forEach(c => {
      const opt = document.createElement('option');
      // Format value with prefix to identify it as custom token
      opt.value = `custom_${c.id}`;
      opt.textContent = `${c.name} (${c.symbol.toUpperCase()} - ${c.network.toUpperCase()})`;
      customGroup.appendChild(opt);
    });
    blockchainSelect.appendChild(customGroup);
  }

  // Restore selection if possible, otherwise default to first
  if (selectedVal && blockchainSelect.querySelector(`option[value="${selectedVal}"]`)) {
    blockchainSelect.value = selectedVal;
  } else {
    blockchainSelect.selectedIndex = 0;
  }
}

// Render Registered Custom Tokens list
function renderContractsList(contracts) {
  if (contracts.length === 0) {
    contractsList.innerHTML = '<div class="token-placeholder">No custom tokens registered.</div>';
    return;
  }

  contractsList.innerHTML = contracts.map(c => `
    <div class="token-list-item">
      <div class="token-info">
        <span class="token-symbol font-mono">${c.symbol.toUpperCase()}</span>
        <span class="token-network-badge">${c.network.toUpperCase()}</span>
        <div class="token-details-text">${c.name}</div>
        <div class="token-address-text font-mono">${c.address}</div>
      </div>
      <button class="btn-delete-token" onclick="deleteCustomContract(${c.id})" title="Delete Token">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `).join('');
}

// Add a Custom Token Contract address
async function addCustomContract() {
  const symbol = contractSymbol.value.trim();
  const name = contractName.value.trim();
  const network = contractNetwork.value;
  const address = contractAddress.value.trim();

  if (!symbol || !name || !address) {
    showToast('Please fill out all token contract details.', 'error');
    return;
  }

  btnAddContract.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/config/contracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, name, network, address })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Custom token added successfully.', 'success');
      contractSymbol.value = '';
      contractName.value = '';
      contractAddress.value = '';
      fetchCustomContracts();
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    showToast(error.message || 'Failed to add custom token.', 'error');
  } finally {
    btnAddContract.disabled = false;
  }
}

// Delete Custom Contract
window.deleteCustomContract = async function(id) {
  if (!confirm('Are you sure you want to delete this custom token contract?')) return;
  try {
    const res = await fetch(`${API_BASE}/config/contracts/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Custom token deleted.', 'success');
      fetchCustomContracts();
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    showToast(error.message || 'Failed to delete custom token.', 'error');
  }
};

// Generate Wallet handler (supports custom contract routes)
async function generateNewWallet() {
  const selection = blockchainSelect.value;
  let requestBody = {};

  if (selection.startsWith('custom_')) {
    const contractId = parseInt(selection.replace('custom_', ''), 10);
    const contract = customContracts.find(c => c.id === contractId);
    if (!contract) {
      showToast('Selected token contract configuration is missing.', 'error');
      return;
    }
    requestBody = {
      coin: contract.symbol,
      contractAddress: contract.address,
      networkType: contract.network
    };
  } else {
    requestBody = {
      coin: selection
    };
  }

  // Show Loading state
  resultPlaceholder.classList.add('hidden');
  resultDetails.classList.add('hidden');
  resultLoading.classList.remove('hidden');
  btnGenerate.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await res.json();

    if (data.success) {
      const wallet = data.data;

      // Populate results
      resultCoinBadge.textContent = wallet.coin.toUpperCase();
      valAddress.value = wallet.address;
      valMnemonic.value = wallet.mnemonic;
      valPrivate.value = wallet.privateKey;
      valPublic.value = wallet.publicKey;
      valPath.textContent = wallet.derivationPath;

      // Handle contract address metadata display
      if (wallet.contractAddress) {
        valContract.textContent = wallet.contractAddress;
        metaContractWrapper.classList.remove('hidden');
      } else {
        metaContractWrapper.classList.add('hidden');
      }

      // Hide Loading / Show Results
      resultLoading.classList.add('hidden');
      resultDetails.classList.remove('hidden');
      showToast(`${wallet.coin.toUpperCase()} wallet generated successfully!`, 'success');

      // Refresh DB list
      fetchWalletRegistry();
    } else {
      throw new Error(data.error || 'API generation failed.');
    }
  } catch (error) {
    resultLoading.classList.add('hidden');
    resultPlaceholder.classList.remove('hidden');
    showToast(error.message || 'Error generating wallet.', 'error');
  } finally {
    btnGenerate.disabled = false;
  }
}

// Fetch generated wallets from DB
async function fetchWalletRegistry() {
  try {
    const res = await fetch(API_BASE);
    const data = await res.json();

    if (data.success) {
      walletRegistry = data.data;
      renderRegistryTable(walletRegistry);
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    tableBody.innerHTML = `<tr><td colspan="6" class="table-loader text-red"><i class="fa-solid fa-triangle-exclamation"></i> Error loading records: ${error.message || 'Connection failed'}</td></tr>`;
  }
}

// Render DB list in Table
function renderRegistryTable(items) {
  if (items.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" class="table-loader"><i class="fa-solid fa-folder-open"></i> No wallets registered in database.</td></tr>`;
    return;
  }

  tableBody.innerHTML = items.map(wallet => {
    // Generate unique input IDs for masking toggles
    const mnemonicInputId = `tbl-mnemonic-${wallet.id}`;
    const privateInputId = `tbl-private-${wallet.id}`;

    // Highlight tokens differently
    const isToken = !!wallet.contractAddress;
    const badgeHtml = isToken 
      ? `<span class="col-coin">${wallet.coin}</span> <span class="badge" style="font-size:0.55rem; padding:0.1rem 0.3rem">Token</span>`
      : `<span class="col-coin">${wallet.coin}</span>`;

    // Format ISO Date to readable local date
    const dateFormatted = new Date(wallet.createdAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <tr>
        <td>${badgeHtml}</td>
        <td class="col-mono" title="${wallet.address}">${wallet.address}</td>
        <td>
          <div class="table-key-reveal">
            <input type="password" readonly id="${mnemonicInputId}" value="${wallet.mnemonic}" onclick="toggleTableInputType(this)">
            <button onclick="copyToClipboard('${wallet.mnemonic}')" title="Copy Mnemonic"><i class="fa-regular fa-copy"></i></button>
          </div>
        </td>
        <td>
          <div class="table-key-reveal">
            <input type="password" readonly id="${privateInputId}" value="${wallet.privateKey}" onclick="toggleTableInputType(this)">
            <button onclick="copyToClipboard('${wallet.privateKey}')" title="Copy Private Key"><i class="fa-regular fa-copy"></i></button>
          </div>
        </td>
        <td class="col-mono">${wallet.derivationPath}</td>
        <td class="col-date">${dateFormatted}</td>
      </tr>
    `;
  }).join('');
}

// Helper to reveal fields inside table on click
window.toggleTableInputType = function(input) {
  if (input.type === 'password') {
    input.type = 'text';
    setTimeout(() => { input.type = 'password'; }, 5000); // auto-hide after 5s
  } else {
    input.type = 'password';
  }
};

// Filter local list
function filterRegistryTable() {
  const query = tableSearch.value.toLowerCase().trim();
  if (!query) {
    renderRegistryTable(walletRegistry);
    return;
  }

  const filtered = walletRegistry.filter(w => {
    return (
      w.coin.toLowerCase().includes(query) ||
      w.address.toLowerCase().includes(query) ||
      w.derivationPath.toLowerCase().includes(query) ||
      (w.contractAddress && w.contractAddress.toLowerCase().includes(query))
    );
  });

  renderRegistryTable(filtered);
}

// Copy utility with toast
function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Failed to copy to clipboard.', 'error');
  });
}

// Toast alerts helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icon = type === 'success' 
    ? '<i class="fa-solid fa-circle-check"></i>' 
    : '<i class="fa-solid fa-circle-exclamation"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  // Auto-destroy after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3000);
}
