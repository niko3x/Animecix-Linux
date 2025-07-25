import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import * as path from 'path';

class MainApp {
    private mainWindow: BrowserWindow | null = null;
    private authWindow: BrowserWindow | null = null;
    private sharedSession: Electron.Session | null = null;

    constructor() {
        this.initializeApp();
    }

    private initializeApp(): void {
        app.whenReady().then(() => {
            // Create shared session after app is ready
            this.sharedSession = session.fromPartition('persist:animecix');
            this.createMainWindow();
            this.setupIpcHandlers();
        });

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                this.createMainWindow();
            }
        });
    }

    private createMainWindow(): void {
        if (!this.sharedSession) {
            console.error('Shared session not initialized');
            return;
        }

        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                webSecurity: true,
                session: this.sharedSession // Use shared session
            },
            show: false,
            titleBarStyle: 'default',
            frame: true
        });

        // Load the main website
        this.mainWindow.loadURL('https://animecix.tv');

        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow?.show();
        });

        // Handle external links - especially Google auth
        this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            console.log('Intercepted URL:', url);
            
            // Check if it's a Google login URL - be more flexible with URL matching
            if (url.includes('accounts.google.com') || 
                url.includes('oauth') || 
                url.includes('/auth/google') ||
                url.includes('/secure/auth/social/google') ||
                url.includes('/login/google') ||
                url.includes('googleapis.com') ||
                url.includes('google') && url.includes('auth')) {
                
                // If it's already a Google OAuth URL, use it directly
                if (url.includes('accounts.google.com')) {
                    this.handleGoogleAuth(url);
                } else {
                    // Otherwise, let it load normally first to get redirected to the real Google URL
                    // This will avoid the 404 and let the website handle the redirect
                    return { action: 'allow' };
                }
                return { action: 'deny' };
            }
            
            // Open other external links in default browser
            shell.openExternal(url);
            return { action: 'deny' };
        });

        // Inject custom scripts when page loads
        this.mainWindow.webContents.on('dom-ready', () => {
            this.injectAuthHandler();
        });

        // Handle navigation events
        this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
            console.log('Main window navigating to:', navigationUrl);
            
            // Allow navigation to animecix.tv and its subdomains
            if (navigationUrl.includes('animecix.tv')) {
                return; // Allow navigation
            }
            
            // Block navigation to other domains and open in external browser instead
            if (!navigationUrl.startsWith('https://animecix.tv')) {
                event.preventDefault();
                shell.openExternal(navigationUrl);
            }
        });
    }

    private handleGoogleAuth(authUrl: string): void {
        console.log('Opening Google Auth for URL:', authUrl);
        
        if (!this.sharedSession) {
            console.error('Shared session not available');
            return;
        }
        
        // Create authentication window using the SAME session
        this.authWindow = new BrowserWindow({
            width: 600,
            height: 800,
            show: true,
            modal: true,
            parent: this.mainWindow!,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                session: this.sharedSession  // Use the same session!
            },
            title: 'Google Login - AnimeCix'
        });

        // Start by loading the main site and let user navigate to login naturally
        // This avoids 404 errors from wrong URLs
        console.log('Loading main site for auth navigation');
        this.authWindow.loadURL('https://animecix.tv');
        
        // Add a message to help user navigate
        this.authWindow.webContents.once('dom-ready', () => {
            this.authWindow?.webContents.executeJavaScript(`
                // Add instruction overlay
                const overlay = document.createElement('div');
                overlay.innerHTML = \`
                    <div style="
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        background: #4CAF50;
                        color: white;
                        padding: 15px;
                        text-align: center;
                        z-index: 10000;
                        font-weight: bold;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                    ">
                        🔑 Google ile giriş yapmak için sayfadaki "Google" butonuna tıklayın
                        <button onclick="this.parentElement.parentElement.remove()" style="
                            margin-left: 15px;
                            background: rgba(255,255,255,0.2);
                            border: none;
                            color: white;
                            padding: 5px 10px;
                            border-radius: 3px;
                            cursor: pointer;
                        ">Kapat</button>
                    </div>
                \`;
                document.body.appendChild(overlay);
                
                // Auto-scroll to login area if it exists
                const loginSection = document.querySelector('.login, .auth, [class*="login"], [class*="auth"]');
                if (loginSection) {
                    loginSection.scrollIntoView({ behavior: 'smooth' });
                }
                
                // Highlight Google login buttons
                const googleButtons = document.querySelectorAll('a[href*="google"], button[data-provider="google"], .google-login, [class*="google"]');
                googleButtons.forEach(btn => {
                    btn.style.cssText += 'animation: pulse 2s infinite; box-shadow: 0 0 0 4px rgba(76, 175, 80, 0.4) !important;';
                });
                
                // Add pulse animation
                const style = document.createElement('style');
                style.textContent = \`
                    @keyframes pulse {
                        0% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                        100% { transform: scale(1); }
                    }
                \`;
                document.head.appendChild(style);
            `);
        });

        // Monitor navigation events
        this.authWindow.webContents.on('will-navigate', (event, navigationUrl) => {
            console.log('Auth window navigating to:', navigationUrl);
            this.checkAuthSuccess(navigationUrl);
        });

        this.authWindow.webContents.on('did-navigate', (event, navigationUrl) => {
            console.log('Auth window navigated to:', navigationUrl);
            this.checkAuthSuccess(navigationUrl);
        });

        this.authWindow.webContents.on('did-finish-load', () => {
            const currentUrl = this.authWindow?.webContents.getURL() || '';
            console.log('Auth window finished loading:', currentUrl);
            this.checkAuthSuccess(currentUrl);
            
            // Inject helper UI
            this.injectAuthWindowHelpers();
        });

        // Handle window closed
        this.authWindow.on('closed', () => {
            console.log('Auth window closed');
            this.authWindow = null;
            
            // Always reload main window when auth window closes
            // This ensures any new session data is picked up
            setTimeout(() => {
                console.log('Reloading main window after auth window close');
                this.mainWindow?.reload();
            }, 500);
        });
    }

    private checkAuthSuccess(url: string): void {
        // Check for successful auth callback
        if (url.includes('animecix.tv') && (
            url.includes('/secure/auth/social/google/callback') ||
            url.includes('code=') ||
            url.includes('access_token=') ||
            url.includes('/auth/google/callback')
        )) {
            console.log('Detected auth callback URL:', url);
            
            // Wait for the auth to be processed
            setTimeout(() => {
                this.handleAuthComplete();
            }, 2000);
        }
    }

    private async handleAuthComplete(): Promise<void> {
        if (!this.authWindow) return;

        try {
            console.log('Handling auth completion...');
            
            // Check if the page indicates successful login
            const pageContent = await this.authWindow.webContents.executeJavaScript(`
                ({
                    url: window.location.href,
                    title: document.title,
                    bodyText: document.body.innerText,
                    hasLoginSuccess: document.body.innerText.toLowerCase().includes('giriş yapıldı') ||
                                   document.body.innerText.toLowerCase().includes('login') ||
                                   document.body.innerText.toLowerCase().includes('başarılı') ||
                                   document.body.innerText.toLowerCase().includes('success') ||
                                   document.body.innerText.toLowerCase().includes('bu sayfayı kapatabilirsiniz')
                })
            `);

            console.log('Page content check:', pageContent);

            if (pageContent.hasLoginSuccess) {
                console.log('Login success detected!');
                
                // Show success message in auth window
                await this.authWindow.webContents.executeJavaScript(`
                    const successDiv = document.createElement('div');
                    successDiv.innerHTML = '✅ Giriş başarılı!<br>Ana pencere güncelleniyor...';
                    successDiv.style.cssText = \`
                        position: fixed;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: #4CAF50;
                        color: white;
                        padding: 20px 30px;
                        border-radius: 10px;
                        z-index: 10000;
                        font-weight: bold;
                        text-align: center;
                        font-size: 16px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                    \`;
                    document.body.appendChild(successDiv);
                `);

                // Close auth window after delay
                setTimeout(() => {
                    this.authWindow?.close();
                }, 2000);

                // Show success in main window and reload
                this.mainWindow?.webContents.executeJavaScript(`
                    const notification = document.createElement('div');
                    notification.innerHTML = '✅ Google girişi başarılı!<br><small>Sayfa yenileniyor...</small>';
                    notification.style.cssText = \`
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        background: #4CAF50;
                        color: white;
                        padding: 15px 20px;
                        border-radius: 8px;
                        z-index: 10001;
                        font-weight: bold;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        font-family: Arial, sans-serif;
                    \`;
                    document.body.appendChild(notification);
                    
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                `);
            }

        } catch (error) {
            console.error('Error in handleAuthComplete:', error);
        }
    }

    private async injectAuthWindowHelpers(): Promise<void> {
        if (!this.authWindow) return;

        try {
            await this.authWindow.webContents.executeJavaScript(`
                // Add close button
                const closeBtn = document.createElement('button');
                closeBtn.innerHTML = '❌ Kapat';
                closeBtn.style.cssText = \`
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    background: #ff4444;
                    color: white;
                    border: none;
                    padding: 8px 12px;
                    border-radius: 5px;
                    cursor: pointer;
                    z-index: 10000;
                    font-size: 12px;
                    font-weight: bold;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                \`;
                closeBtn.onclick = function() {
                    window.close();
                };
                document.body.appendChild(closeBtn);
                
                // Add instructions
                const instructions = document.createElement('div');
                instructions.innerHTML = 'Google ile giriş yapın. Başarılı olduğunda pencere otomatik kapanacak.';
                instructions.style.cssText = \`
                    position: fixed;
                    bottom: 10px;
                    left: 10px;
                    right: 10px;
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 10px;
                    border-radius: 5px;
                    z-index: 9999;
                    font-size: 12px;
                    text-align: center;
                \`;
                document.body.appendChild(instructions);
                
                // Check for success message periodically
                let checkCount = 0;
                const checkSuccess = setInterval(() => {
                    checkCount++;
                    const bodyText = document.body.innerText.toLowerCase();
                    
                    if (bodyText.includes('giriş yapıldı') || 
                        bodyText.includes('bu sayfayı kapatabilirsiniz') ||
                        bodyText.includes('login') ||
                        checkCount > 60) { // Stop after 60 checks (1 minute)
                        clearInterval(checkSuccess);
                        
                        if (bodyText.includes('giriş yapıldı') || bodyText.includes('bu sayfayı kapatabilirsiniz')) {
                            // Success detected
                            const successMsg = document.createElement('div');
                            successMsg.innerHTML = '✅ Başarılı! Pencere kapanıyor...';
                            successMsg.style.cssText = \`
                                position: fixed;
                                top: 50%;
                                left: 50%;
                                transform: translate(-50%, -50%);
                                background: #4CAF50;
                                color: white;
                                padding: 15px 25px;
                                border-radius: 8px;
                                z-index: 10001;
                                font-weight: bold;
                                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                            \`;
                            document.body.appendChild(successMsg);
                            
                            setTimeout(() => window.close(), 2000);
                        }
                    }
                }, 1000); // Check every second
            `);
        } catch (error) {
            console.error('Error injecting auth window helpers:', error);
        }
    }

    private injectAuthHandler(): void {
        const authScript = `
            console.log('Injecting auth handler...');
            
            // Function to intercept Google login attempts
            function interceptGoogleLogin() {
                const selectors = [
                    'a[href*="google"]',
                    'button[data-provider="google"]',
                    '.google-login',
                    '.btn-google',
                    '[onclick*="google"]',
                    'button[class*="google" i]',
                    'a[class*="google" i]',
                    '[href*="/secure/auth/social/google"]'
                ];
                
                let intercepted = 0;
                
                selectors.forEach(selector => {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(element => {
                        if (element.dataset.intercepted) return;
                        
                        element.dataset.intercepted = 'true';
                        intercepted++;
                        
                        // Remove original handlers
                        element.removeAttribute('onclick');
                        const originalHref = element.getAttribute('href');
                        
                        // Add new click handler
                        element.addEventListener('click', function(e) {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            console.log('Google login clicked - opening auth window');
                            
                            // Show loading state
                            const originalContent = element.innerHTML;
                            element.style.opacity = '0.6';
                            element.style.pointerEvents = 'none';
                            element.innerHTML = '🔄 Giriş penceresi açılıyor...';
                            
                            // Open a general auth window - let it navigate naturally
                            window.open('about:blank', '_blank', 'width=600,height=800');
                            
                            // Reset after delay
                            setTimeout(() => {
                                element.style.opacity = '1';
                                element.style.pointerEvents = 'auto';
                                element.innerHTML = originalContent;
                            }, 2000);
                        });
                        
                        // Add visual indicator
                        if (!element.querySelector('.desktop-indicator')) {
                            const indicator = document.createElement('span');
                            indicator.className = 'desktop-indicator';
                            indicator.innerHTML = ' 🖥️';
                            indicator.title = 'Masaüstü Uygulaması Girişi';
                            indicator.style.cssText = 'font-size: 0.8em; opacity: 0.7; margin-left: 5px;';
                            element.appendChild(indicator);
                        }
                    });
                });
                
                if (intercepted > 0) {
                    console.log(\`\${intercepted} Google giriş butonu yakalandı\`);
                }
                
                return intercepted;
            }
            
            // Run initially and on changes
            interceptGoogleLogin();
            
            const observer = new MutationObserver(() => {
                interceptGoogleLogin();
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        `;

        this.mainWindow?.webContents.executeJavaScript(authScript);
    }

    private setupIpcHandlers(): void {
        ipcMain.handle('open-google-auth', async () => {
            this.handleGoogleAuth('https://animecix.tv/secure/auth/social/google');
        });

        ipcMain.handle('get-app-version', () => {
            return app.getVersion();
        });
    }
}

// Initialize the app
new MainApp();
