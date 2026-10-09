const { exec } = require('child_process');
const { chromium } = require('playwright');

let isInstalling = false;
let installPromise = null;

/**
 * Checks if Playwright Chromium browser can be launched or exists.
 */
async function isChromiumAvailable() {
    try {
        const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        await b.close();
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Automatically downloads and installs Playwright Chromium if missing.
 */
function ensureChromiumInstalled(logFn = console.log) {
    if (isInstalling && installPromise) {
        logFn('[BrowserHelper] Chromium download is already in progress, awaiting completion...');
        return installPromise;
    }

    isInstalling = true;
    installPromise = new Promise((resolve, reject) => {
        logFn('[BrowserHelper] Downloading Playwright Chromium browser binary...');
        
        // Run npx playwright install chromium
        exec('npx playwright install chromium', { env: process.env, timeout: 300000 }, (error, stdout, stderr) => {
            isInstalling = false;
            if (error) {
                logFn(`[BrowserHelper] Error installing Chromium: ${error.message}\n${stderr}`);
                return reject(error);
            }
            logFn(`[BrowserHelper] Chromium downloaded successfully!\n${stdout}`);
            resolve(stdout);
        });
    });

    return installPromise;
}

module.exports = {
    isChromiumAvailable,
    ensureChromiumInstalled
};
