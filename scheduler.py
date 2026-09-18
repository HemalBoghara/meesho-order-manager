import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from meesho_bot import bot_instance

logger = logging.getLogger("meesho_scheduler")

class AutoAcceptScheduler:
    def __init__(self):
        self.enabled: bool = False
        self.interval_minutes: int = 30
        self.task: Optional[asyncio.Task] = None
        self.last_run: Optional[datetime] = None
        self.next_run: Optional[datetime] = None
        self.total_accepted: int = 0
        self.is_running_job: bool = False

    def get_status(self) -> Dict[str, Any]:
        seconds_remaining = 0
        if self.enabled and self.next_run:
            diff = (self.next_run - datetime.now()).total_seconds()
            seconds_remaining = max(0, int(diff))

        return {
            "enabled": self.enabled,
            "interval_minutes": self.interval_minutes,
            "seconds_remaining": seconds_remaining,
            "last_run": self.last_run.strftime("%Y-%m-%d %H:%M:%S") if self.last_run else None,
            "next_run": self.next_run.strftime("%Y-%m-%d %H:%M:%S") if self.next_run else None,
            "total_accepted": self.total_accepted,
            "is_running_job": self.is_running_job
        }

    def start(self, interval_minutes: int = 30):
        self.interval_minutes = interval_minutes
        self.enabled = True
        self.next_run = datetime.now() + timedelta(minutes=self.interval_minutes)
        
        # Save to config
        cfg = bot_instance.load_config()
        cfg.setdefault("auto_accept", {})["enabled"] = True
        cfg.setdefault("auto_accept", {})["interval_minutes"] = interval_minutes
        bot_instance.save_config(cfg)
        
        if self.task and not self.task.done():
            self.task.cancel()
            
        self.task = asyncio.create_task(self._loop())
        bot_instance.log(f"Auto-Accept scheduled: Runs every {interval_minutes} minutes.", level="info")

    def stop(self):
        self.enabled = False
        self.next_run = None
        
        # Save to config
        cfg = bot_instance.load_config()
        cfg.setdefault("auto_accept", {})["enabled"] = False
        bot_instance.save_config(cfg)

        if self.task and not self.task.done():
            self.task.cancel()
            self.task = None
            
        bot_instance.log("Auto-Accept stopped.", level="warning")

    async def _loop(self):
        while self.enabled:
            try:
                # Wait until next run time (check in short increments for responsive cancellation)
                while self.enabled and self.next_run and datetime.now() < self.next_run:
                    await asyncio.sleep(2)

                if not self.enabled:
                    break

                # Execute auto-accept job
                self.is_running_job = True
                bot_instance.log(f"⚡ [Auto-Accept Job Triggered] Checking for new pending orders...", level="info")

                # 1. Fetch latest pending orders
                orders = await bot_instance.fetch_pending_orders()
                
                if orders and len(orders) > 0:
                    bot_instance.log(f"Auto-Accept: Found {len(orders)} pending orders. Accepting all...", level="info")
                    res = await bot_instance.accept_orders(accept_all=True)
                    count = res.get("accepted_count", 0)
                    self.total_accepted += count
                    bot_instance.log(f"🎉 Auto-Accept completed: {count} orders accepted.", level="info")
                else:
                    bot_instance.log("Auto-Accept: No pending orders found at this time.", level="info")

                self.last_run = datetime.now()
                self.next_run = datetime.now() + timedelta(minutes=self.interval_minutes)
                self.is_running_job = False

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.is_running_job = False
                bot_instance.log(f"Auto-Accept job error: {str(e)}", level="error")
                # Wait a minute before retrying
                await asyncio.sleep(60)

scheduler = AutoAcceptScheduler()
