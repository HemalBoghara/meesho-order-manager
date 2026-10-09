const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { chromium } = require('playwright');

let isInstalling = false;
let installPromise = null;

function getPlaywrightCliPath() {
    try {
        const pkgPath = require.resolve('playwright/package.json');
        const cliPath = path.join(path.dirname(pkgPath), 'cli.js');
        if (fs.existsSync(cliPath)) return cliPath;
    } catch (e) {}

    try {
        const pkgCorePath = require.resolve('playwright-core/package.json');
        const cliCorePath = path.join(path.dirname(pkgCorePath), 'cli.js');
        if (fs.existsSync(cliCorePath)) return cliCorePath;
    } catch (e) {}

    return path.join(__dirname, 'node_modules', 'playwright', 'cli.js');
}

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
 * Invokes node directly on playwright's cli.js to avoid "npx: command not found" in cloud environments.
 */
function ensureChromiumInstalled(logFn = console.log) {
    if (isInstalling && installPromise) {
        logFn('[BrowserHelper] Chromium download is already in progress, awaiting completion...');
        return installPromise;
    }

    isInstalling = true;
    installPromise = new Promise((resolve, reject) => {
        logFn('[BrowserHelper] Downloading Playwright Chromium browser binary...');
        
        const nodeExec = process.execPath;
        const nodeDir = path.dirname(nodeExec);
        const cliPath = getPlaywrightCliPath();

        logFn(`[BrowserHelper] Invoking: ${nodeExec} ${cliPath} install chromium`);

        execFile(nodeExec, [cliPath, 'install', 'chromium'], {
            env: {
                ...process.env,
                PATH: `${nodeDir}:${process.env.PATH || ''}`
            },
            timeout: 300000
        }, (error, stdout, stderr) => {
            isInstalling = false;
            if (error) {
                logFn(`[BrowserHelper] Error installing Chromium: ${error.message}\n${stderr || ''}`);
                return reject(error);
            }
            logFn(`[BrowserHelper] Chromium downloaded successfully!\n${stdout || ''}`);
            resolve(stdout);
        });
    });

    return installPromise;
}

module.exports = {
    isChromiumAvailable,
    ensureChromiumInstalled,
    getPlaywrightCliPath
};
