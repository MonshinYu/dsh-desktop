use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};

pub struct AppState {
    pub port: AtomicU16,
    pub generation: AtomicU64,
}

impl AppState {
    pub fn new(port: u16) -> Self {
        Self {
            port: AtomicU16::new(port),
            generation: AtomicU64::new(1),
        }
    }

    pub fn current_port(&self) -> u16 {
        self.port.load(Ordering::SeqCst)
    }

    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    #[allow(dead_code)]
    pub fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
}