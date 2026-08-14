//! `pump_until` bounds how many *rounds* of timers run, which does nothing
//! about a single callback that never returns. `terminate_execution` is the
//! only isolate method safe to call from another thread, so it is the way in.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Bounds how long a finished solve waits to join.
const TICK: Duration = Duration::from_millis(50);

pub struct Watchdog {
    finished: Arc<AtomicBool>,
    fired: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Watchdog {
    pub fn arm(handle: v8::IsolateHandle, deadline: Duration) -> Self {
        let finished = Arc::new(AtomicBool::new(false));
        let fired = Arc::new(AtomicBool::new(false));
        let (f, fi) = (finished.clone(), fired.clone());

        let thread = std::thread::spawn(move || {
            let start = Instant::now();
            // Polled, so a solve finishing early does not park a thread.
            while start.elapsed() < deadline {
                if f.load(Ordering::Acquire) {
                    return;
                }
                std::thread::sleep(TICK.min(deadline.saturating_sub(start.elapsed())));
            }
            if !f.load(Ordering::Acquire) {
                fi.store(true, Ordering::Release);
                handle.terminate_execution();
            }
        });

        Self { finished, fired, thread: Some(thread) }
    }

    pub fn fired(&self) -> bool {
        self.fired.load(Ordering::Acquire)
    }

    fn stop(&mut self) {
        self.finished.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Watchdog {
    fn drop(&mut self) {
        self.stop();
    }
}
