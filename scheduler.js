const { botInstance } = require('./meeshoBot');

class AutoAcceptScheduler {
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

        const cfg = botInstance.loadConfig();
        cfg.auto_accept = cfg.auto_accept || {};
        cfg.auto_accept.enabled = true;
        cfg.auto_accept.interval_minutes = intervalMinutes;
        botInstance.saveConfig(cfg);

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        // Loop every 2 seconds to check if nextRun is reached
        this.timer = setInterval(async () => {
            if (!this.enabled || !this.nextRun) return;

            if (Date.now() >= this.nextRun.getTime()) {
                await this._executeJob();
            }
        }, 2000);

        botInstance.log(`Auto-Accept scheduled: Runs every ${intervalMinutes} minutes.`, 'info');
    }

    stop() {
        this.enabled = false;
        this.nextRun = null;

        const cfg = botInstance.loadConfig();
        cfg.auto_accept = cfg.auto_accept || {};
        cfg.auto_accept.enabled = false;
        botInstance.saveConfig(cfg);

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        botInstance.log('Auto-Accept stopped.', 'warning');
    }

    async _executeJob() {
        if (this.isRunningJob) return;

        this.isRunningJob = true;
        botInstance.log('⚡ [Auto-Accept Job Triggered] Checking for new pending orders...', 'info');

        try {
            const orders = await botInstance.fetchPendingOrders();

            if (orders && orders.length > 0) {
                botInstance.log(`Auto-Accept: Found ${orders.length} pending orders. Accepting all...`, 'info');
                const res = await botInstance.acceptOrders(null, true);
                const count = res.accepted_count || 0;
                this.totalAccepted += count;
                botInstance.log(`🎉 Auto-Accept completed: ${count} orders accepted.`, 'info');
            } else {
                botInstance.log('Auto-Accept: No pending orders found at this time.', 'info');
            }

            this.lastRun = new Date();
            this.nextRun = new Date(Date.now() + this.intervalMinutes * 60 * 1000);
        } catch (err) {
            botInstance.log(`Auto-Accept job error: ${err.message}`, 'error');
            // Retry in 1 minute
            this.nextRun = new Date(Date.now() + 60 * 1000);
        } finally {
            this.isRunningJob = false;
        }
    }
}

const scheduler = new AutoAcceptScheduler();

module.exports = {
    AutoAcceptScheduler,
    scheduler
};
