document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const mastodonToggle = document.getElementById('mastodon-toggle');
    const mastodonAuthBtn = document.getElementById('mastodon-auth-btn');
    const disconnectMastodonBtn = document.getElementById('disconnectMastodon');
    const mastodonStatus = document.getElementById('mastodon-status');

    // Load saved settings
    chrome.storage.sync.get([
        'mastodonEnabled',
        'mastodonToken',
        'mastodonInstance'
    ], (settings) => {
        console.log('Loaded settings:', {
            mastodonEnabled: settings.mastodonEnabled,
            mastodonToken: settings.mastodonToken ? 'Present' : 'Missing',
            mastodonInstance: settings.mastodonInstance || 'Not set'
        });
        
        mastodonToggle.checked = settings.mastodonEnabled || false;

        // Update button states and status messages
        updateMastodonUI(settings.mastodonToken);
    });

    // Mastodon handlers
    mastodonToggle.addEventListener('change', () => {
        const mastodonEnabled = mastodonToggle.checked;
        chrome.storage.sync.set({ mastodonEnabled: mastodonEnabled }, () => {
            console.log('Mastodon enable state saved:', mastodonEnabled);
        });
    });

    mastodonAuthBtn.addEventListener('click', () => {
        // Ask for the token directly
        promptForToken();
    });

    disconnectMastodonBtn.addEventListener('click', () => {
        clearMastodonToken();
    });

    // Helper functions
    function updateMastodonUI(token) {
        if (token) {
            mastodonAuthBtn.textContent = 'Connected to Mastodon';
            mastodonAuthBtn.disabled = true;
            disconnectMastodonBtn.disabled = false;
            mastodonStatus.textContent = 'Connected to Mastodon';
            mastodonStatus.style.color = '#17bf63';
        } else {
            mastodonAuthBtn.textContent = 'Connect Mastodon Account';
            mastodonAuthBtn.disabled = false;
            disconnectMastodonBtn.disabled = true;
            mastodonStatus.textContent = 'Not connected';
            mastodonStatus.style.color = '#657786';
        }
    }

    // Prompt user to enter token manually
    function promptForToken() {
        const token = prompt("Please enter your Mastodon token:");
        if (token) {
            chrome.storage.sync.set({ mastodonToken: token }, () => {
                console.log('Mastodon token saved');
                updateMastodonUI(token);
            });
        }
    }

    // Function to clear Mastodon token
    function clearMastodonToken(callback) {
        console.log('Clearing Mastodon token...');
        chrome.storage.sync.remove(['mastodonToken', 'mastodonInstance'], () => {
            console.log('Mastodon token cleared from storage');
            updateMastodonUI(null);
            if (callback) callback();
        });
    }
});