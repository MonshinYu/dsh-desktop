use rand::RngExt;
use std::net::TcpListener;

pub fn get_available_port(preferred: Option<u16>) -> u16 {
    if let Some(port) = preferred {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }

    let mut rng = rand::rng();
    loop {
        let port: u16 = rng.random_range(1024..=65535);
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
}