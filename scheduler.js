const { db } = require('./db');
const { botManager } = require('./botManager');

class MultiAccountScheduler {
    constructor() {
        this.enabled = false;
        this.intervalMinutes = 30;
        this.timer = null;
        this.lastRun = null;
        this.nextRun = null;
        this.totalAccepted = 0;
        this.isRunningJob = false;
    }

    getStatus() {
        let secondsRemaining = 0;
        if (this.enabled && this.nextRun) {
            const diff = (this.nextRun.getTime() - Date.now()) / 1000;
            secondsRemaining = Math.max(0, Math.floor(diff));
        }

        const formatDt = dt => {
            if (!dt) return null;
            return dt.toISOString().replace('T', ' ').substring(0, 19);
        };

        return {
            enabled: this.enabled,
            interval_minutes: this.intervalMinutes,
            seconds_remaining: secondsRemaining,
            last_run: formatDt(this.lastRun),
            next_run: formatDt(this.nextRun),
            total_accepted: this.totalAccepted,
            is_running_job: this.isRunningJob
        };
    }

    start(intervalMinutes = 30) {
        this.intervalMinutes = intervalMinutes;
        this.enabled = true;
        this.nextRun = new Date(Date.now() + this.intervalMinutes * 60 * 1000);

        db.updateSettings({
            autoAcceptEnabled: true,
            autoAcceptIntervalMinutes: intervalMinutes
        });

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        this.timer = setInterval(async () => {
            if (!this.enabled || !this.nextRun) return;

            if (Date.now() >= this.nextRun.getTime()) {
                await this._executeJob();
            }
        }, 2000);

        botManager.log(null, 'Scheduler', `Multi-Account Auto-Accept scheduled: Runs every ${intervalMinutes} minutes across all connected stores.`, 'info');
    }

    stop() {
        this.enabled = false;
        this.nextRun = null;

        db.updateSettings({ autoAcceptEnabled: false });

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        botManager.log(null, 'Scheduler', 'Multi-Account Auto-Accept stopped.', 'warning');
    }

    async _executeJob() {
        if (this.isRunningJob) return;

        this.isRunningJob = true;
        botManager.log(null, 'Scheduler', '⚡ [Auto-Accept Job Triggered] Checking pending orders across all active stores simultaneously...', 'info');

        try {
            const allAccounts = db.data.accounts.filter(a => a.status === 'CONNECTED' && a.autoAccept !== false);

            if (allAccounts.length === 0) {
                botManager.log(null, 'Scheduler', 'Auto-Accept: No connected stores with auto-accept enabled.', 'info');
            } else {
                botManager.log(null, 'Scheduler', `Auto-Accept running for ${allAccounts.length} store(s) in parallel...`, 'info');

                // Execute for each store in parallel
                const results = await Promise.allSettled(allAccounts.map(async (acc) => {
                    const orders = await botManager.fetchAccountOrders(acc);
                    if (orders && orders.length > 0) {
                        botManager.log(acc.id, acc.storeName, `Auto-Accept: Found ${orders.length} pending order(s). Accepting all...`, 'info');
                        const res = await botManager.acceptAccountOrders(acc, null, true);
                        return res.acceptedCount || 0;
                    } else {
                        botManager.log(acc.id, acc.storeName, 'Auto-Accept: No pending orders.', 'info');
                        return 0;
                    }
                }));

                let jobAccepted = 0;
                results.forEach((r, idx) => {
                    if (r.status === 'fulfilled') {
                        jobAccepted += r.value || 0;
                    } else {
                        botManager.log(allAccounts[idx].id, allAccounts[idx].storeName, `Auto-Accept job error: ${r.reason.message}`, 'error');
                    }
                });

                this.totalAccepted += jobAccepted;
                botManager.log(null, 'Scheduler', `🎉 Auto-Accept cycle finished. Total accepted across stores: ${jobAccepted}`, 'info');
            }

            this.lastRun = new Date();
            this.nextRun = new Date(Date.now() + this.intervalMinutes * 60 * 1000);
        } catch (err) {
            botManager.log(null, 'Scheduler', `Scheduler cycle error: ${err.message}`, 'error');
            this.nextRun = new Date(Date.now() + 60 * 1000); // Retry in 1 min
        } finally {
            this.isRunningJob = false;
        }
    }
}

const scheduler = new MultiAccountScheduler();

module.exports = {
    MultiAccountScheduler,
    scheduler
};
