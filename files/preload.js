const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // Google authentication
    openGoogleAuth: () => ipcRenderer.invoke('open-google-auth'),
    
    // App information
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    
    // Window controls
    minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
    maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
    closeWindow: () => ipcRenderer.invoke('close-window'),
    
    // Download functionality
    downloadVideo: (videoData) => ipcRenderer.invoke('download-video', videoData),
    getDownloads: () => ipcRenderer.invoke('get-downloads'),
    
    // Settings
    getSetting: (key) => ipcRenderer.invoke('get-setting', key),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    
    // Authentication events
    onAuthSuccess: (callback) => ipcRenderer.on('auth-success', callback),
    onAuthError: (callback) => ipcRenderer.on('auth-error', callback),
    
    // Remove listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Inject CSS for better app integration
document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
        /* Desktop app specific styles */
        .desktop-app-indicator {
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 5px 10px;
            border-radius: 15px;
            font-size: 12px;
            z-index: 10000;
            pointer-events: none;
        }
        
        /* Improve scrollbar for desktop */
        ::-webkit-scrollbar {
            width: 8px;
        }
        
        ::-webkit-scrollbar-track {
            background: #f1f1f1;
        }
        
        ::-webkit-scrollbar-thumb {
            background: #888;
            border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: #555;
        }
        
        /* Hide elements not needed in desktop app */
        .mobile-only,
        .app-store-links,
        .download-app-banner {
            display: none !important;
        }
    `;
    document.head.appendChild(style);
    
    // Add desktop app indicator
    const indicator = document.createElement('div');
    indicator.className = 'desktop-app-indicator';
    indicator.textContent = 'Desktop App';
    document.body.appendChild(indicator);
});

// Google Authentication Handler
window.addEventListener('DOMContentLoaded', () => {
    // Function to handle Google login buttons
    function setupGoogleAuth() {
        // Find all Google login buttons/links
        const selectors = [
            '[data-provider="google"]',
            '.google-login',
            '.btn-google',
            '[href*="google"]',
            '[onclick*="google"]',
            'button[class*="google"]',
            'a[class*="google"]'
        ];
        
        selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                // Remove existing event listeners
                element.onclick = null;
                element.removeAttribute('onclick');
                element.removeAttribute('href');
                
                // Add new click handler
                element.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    try {
                        // Show loading state
                        const originalText = element.textContent;
                        element.textContent = 'Opening Google Login...';
                        element.disabled = true;
                        
                        // Open Google auth in external window
                        await window.electronAPI.openGoogleAuth();
                        
                        // Reset button state after a delay
                        setTimeout(() => {
                            element.textContent = originalText;
                            element.disabled = false;
                        }, 3000);
                        
                    } catch (error) {
                        console.error('Google auth error:', error);
                        element.textContent = 'Login Error - Try Again';
                        setTimeout(() => {
                            element.textContent = originalText;
                            element.disabled = false;
                        }, 3000);
                    }
                });
                
                // Add visual indicator
                if (!element.querySelector('.desktop-auth-icon')) {
                    const icon = document.createElement('span');
                    icon.className = 'desktop-auth-icon';
                    icon.innerHTML = ' 🖥️';
                    icon.title = 'Login will open in a new window';
                    element.appendChild(icon);
                }
            });
        });
    }
    
    // Run initially
    setupGoogleAuth();
    
    // Re-run when new content is loaded (for SPAs)
    const observer = new MutationObserver((mutations) => {
        let shouldRerun = false;
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Check if any added nodes contain login buttons
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const element = node;
                        if (element.matches && (
                            element.matches('[data-provider="google"]') ||
                            element.matches('.google-login') ||
                            element.querySelector('[data-provider="google"]') ||
                            element.querySelector('.google-login')
                        )) {
                            shouldRerun = true;
                        }
                    }
                });
            }
        });
        
        if (shouldRerun) {
            setTimeout(setupGoogleAuth, 100);
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
});

// Handle authentication success messages
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GOOGLE_AUTH_SUCCESS') {
        console.log('Google authentication successful!', event.data.data);
        
        // Show success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 15px 20px;
            border-radius: 5px;
            z-index: 10001;
            font-weight: bold;
        `;
        notification.textContent = 'Login successful! Reloading...';
        document.body.appendChild(notification);
        
        // Remove notification and reload after delay
        setTimeout(() => {
            document.body.removeChild(notification);
            window.location.reload();
        }, 2000);
    }
});

// Expose some utilities for the web app
window.desktopApp = {
    isDesktop: true,
    version: '1.3.0',
    platform: process.platform,
    
    // Utility functions
    openExternal: (url) => {
        // This would need to be implemented in main process
        console.log('Open external:', url);
    },
    
    showNotification: (title, body) => {
        new Notification(title, { body });
    }
};
