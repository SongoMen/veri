//! A local HTTP/1.1 server that can misbehave on demand.
#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub enum Act {
    Send(Vec<u8>),
    Chunked { chunk_size: usize, chunks: usize },
    Hang,
    Reset,
}

pub fn response(status: u16, body: &str) -> Act {
    typed_response(status, "text/plain", body)
}

pub fn page_response(status: u16, body: &str) -> Act {
    typed_response(status, "text/html", body)
}

pub fn typed_response(status: u16, content_type: &str, body: &str) -> Act {
    Act::Send(
        format!(
            "HTTP/1.1 {status} X\r\ncontent-type: {content_type}\r\n\
             content-length: {}\r\n\r\n{body}",
            body.len()
        )
        .into_bytes(),
    )
}

pub struct Request {
    head: String,
    body: String,
}

impl Request {
    pub fn line(&self) -> &str {
        self.head.lines().next().unwrap_or_default()
    }

    fn fields(&self, name: &str) -> Vec<&str> {
        self.head
            .lines()
            .skip(1)
            .filter_map(|l| l.split_once(':'))
            .filter(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.trim())
            .collect()
    }

    pub fn raw_count(&self, name: &str) -> usize {
        self.fields(name).len()
    }

    pub fn header(&self, name: &str) -> &str {
        self.fields(name).first().copied().unwrap_or_default()
    }

    pub fn body(&self) -> &str {
        &self.body
    }
}

pub struct Server {
    pub url: String,
    hits: Arc<AtomicUsize>,
}

impl Server {
    pub fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }
}

async fn read_request(sock: &mut tokio::net::TcpStream) -> Request {
    let deadline = Duration::from_millis(500);
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match tokio::time::timeout(deadline, sock.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => break,
            Ok(Ok(n)) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    let (head, rest) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
    let mut req = Request { head: head.to_string(), body: rest.to_string() };

    let declared: usize = req.header("content-length").parse().unwrap_or(0);
    while req.body.len() < declared {
        match tokio::time::timeout(deadline, sock.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => break,
            Ok(Ok(n)) => req.body.push_str(&String::from_utf8_lossy(&chunk[..n])),
        }
    }
    req
}

pub async fn start(act: impl Fn(usize) -> Act + Send + Sync + 'static) -> Server {
    start_reading(move |n, _| act(n)).await
}

pub async fn start_reading(act: impl Fn(usize, &Request) -> Act + Send + Sync + 'static) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));

    let act = Arc::new(act);
    let counter = hits.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else { return };
            let n = counter.fetch_add(1, Ordering::SeqCst);
            let act = act.clone();
            tokio::spawn(async move {
                let req = read_request(&mut sock).await;
                match act(n, &req) {
                    Act::Send(bytes) => {
                        let _ = sock.write_all(&bytes).await;
                        let _ = sock.flush().await;
                    }
                    Act::Chunked { chunk_size, chunks } => {
                        let head = "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\
                                    transfer-encoding: chunked\r\n\r\n";
                        if sock.write_all(head.as_bytes()).await.is_err() {
                            return;
                        }
                        let chunk = "z".repeat(chunk_size);
                        for _ in 0..chunks {
                            let framed = format!("{chunk_size:x}\r\n{chunk}\r\n");
                            // Stops early once the client hangs up, which is
                            // exactly what a working cap makes it do.
                            if sock.write_all(framed.as_bytes()).await.is_err() {
                                return;
                            }
                        }
                        let _ = sock.write_all(b"0\r\n\r\n").await;
                        let _ = sock.flush().await;
                    }
                    Act::Hang => {
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                    Act::Reset => {
                        #[allow(deprecated)]
                        let _ = sock.set_linger(Some(Duration::ZERO));
                    }
                }
            });
        }
    });

    Server { url: format!("http://{addr}/"), hits }
}
