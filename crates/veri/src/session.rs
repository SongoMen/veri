use crate::config::Config;
use crate::error::Error;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use veri_core::url::origin_of;
use veri_core::{BridgeCall, CookieJarView, HttpBridge, Identity};
use wreq::cookie::Jar;

#[derive(Clone)]
pub struct Session {
    pub client: wreq::Client,
    pub jar: Arc<Jar>,
    pub identity: Identity,
    /// Scopes a cookie a protection installs, since the jar needs a URL.
    pub host: String,
}

impl Session {
    pub fn has_cookie(&self, name: &str) -> bool {
        self.jar.get_all().any(|c| c.name() == name)
    }

    /// Everything the jar holds, in `name=value; name=value` form.
    pub fn cookie_header(&self) -> String {
        self.jar
            .get_all()
            .map(|c| format!("{}={}", c.name(), c.value()))
            .collect::<Vec<_>>()
            .join("; ")
    }

    pub fn cookie(&self, name: &str) -> Option<String> {
        self.jar.get_all().find(|c| c.name() == name).map(|c| c.value().to_string())
    }
}

impl CookieJarView for Session {
    fn has_cookie(&self, name: &str) -> bool {
        Session::has_cookie(self, name)
    }

    fn set_cookie(&self, cookie: &str) {
        self.jar.add(cookie, format!("https://{}/", self.host).as_str());
    }

    fn cookie(&self, name: &str) -> Option<String> {
        Session::cookie(self, name)
    }
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("identity", &self.identity.name)
            .field("cookies", &self.jar.get_all().count())
            .finish()
    }
}

pub struct SessionStore {
    config: Config,
    sessions: Mutex<HashMap<(String, &'static str), Session>>,
    /// Seeded before any session exists
    pending: Mutex<HashMap<String, Vec<(String, String)>>>,
}

impl SessionStore {
    pub fn new(config: Config) -> Self {
        Self { config, sessions: Mutex::new(HashMap::new()), pending: Mutex::new(HashMap::new()) }
    }

    fn build_client(&self, identity: Identity, jar: Arc<Jar>) -> Result<wreq::Client, Error> {
        let mut builder = wreq::Client::builder()
            .emulation(crate::identity::profile_for(&identity))
            .cookie_provider(jar)
            .https_only(self.config.https_only)
            .redirect(if self.config.redirect_limit == 0 {
                wreq::redirect::Policy::none()
            } else {
                wreq::redirect::Policy::limited(self.config.redirect_limit)
            });
        if let Some(t) = self.config.timeout {
            builder = builder.timeout(t);
        }
        if let Some(t) = self.config.connect_timeout {
            builder = builder.connect_timeout(t);
        }
        if let Some(t) = self.config.read_timeout {
            builder = builder.read_timeout(t);
        }
        if let Some(p) = &self.config.proxy {
            builder = builder.proxy(wreq::Proxy::all(p.as_str()).map_err(Error::transport)?);
        }
        builder.build().map_err(Error::transport)
    }

    pub fn get(&self, host: &str, identity: Identity) -> Result<Session, Error> {
        let key = (host.to_string(), identity.name);
        if let Some(s) = self.sessions.lock().unwrap().get(&key) {
            return Ok(s.clone());
        }

        let jar = Arc::new(Jar::default());
        let session = Session {
            client: self.build_client(identity, jar.clone())?,
            jar,
            identity,
            host: host.to_string(),
        };

        if let Some(seeds) = self.pending.lock().unwrap().get(host) {
            let uri = format!("https://{host}/");
            for (_, c) in seeds {
                session.jar.add(c.as_str(), uri.as_str());
            }
        }
        Ok(self.sessions.lock().unwrap().entry(key).or_insert(session).clone())
    }

    pub fn forget(&self, host: &str) -> usize {
        let mut sessions = self.sessions.lock().unwrap();
        let before = sessions.len();
        sessions.retain(|(h, _), _| h != host);
        self.pending.lock().unwrap().remove(host);
        before - sessions.len()
    }

    pub fn set_cookie(&self, host: &str, cookie: &str) {
        let uri = format!("https://{host}/");
        for ((h, _), s) in self.sessions.lock().unwrap().iter() {
            if h == host {
                s.jar.add(cookie, uri.as_str());
            }
        }
        // Remembered so sessions opened later start with it, replaced by name so
        // a process re-seeding a rotating clearance does not grow this list.
        let Some(name) = cookie_name(cookie) else { return };
        let mut pending = self.pending.lock().unwrap();
        let seeds = pending.entry(host.to_string()).or_default();
        match seeds.iter_mut().find(|(n, _)| *n == name) {
            Some(slot) => slot.1 = cookie.to_string(),
            None => seeds.push((name, cookie.to_string())),
        }
    }

    /// First value seen for `name` across this host's sessions.
    pub fn cookie(&self, host: &str, name: &str) -> Option<String> {
        let live = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .find(|((h, _), _)| h == host)
            .and_then(|(_, s)| s.cookie(name));
        if live.is_some() {
            return live;
        }
        // Nothing open for this host yet, so anything seeded is still pending.
        self.pending.lock().unwrap().get(host).and_then(|seeds| {
            seeds.iter().find(|(n, _)| n == name).and_then(|(_, c)| {
                let head = c.split(';').next()?.trim();
                let (_, v) = head.split_once('=')?;
                Some(v.trim().to_string())
            })
        })
    }

    /// A predicate rather than a cookie name: which cookie proves clearance is
    /// the protection's business, not the store's.
    pub fn any_clearance(&self, host: &str, held: impl Fn(&Session) -> bool) -> bool {
        self.sessions.lock().unwrap().iter().any(|((h, _), s)| h == host && held(s))
    }

    pub fn len(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}

fn cookie_name(cookie: &str) -> Option<String> {
    let head = cookie.split(';').next()?.trim();
    let (k, _) = head.split_once('=')?;
    let k = k.trim();
    (!k.is_empty()).then(|| k.to_string())
}

pub struct SessionBridge {
    session: Session,
    referer: String,
    origin: String,
    log: Mutex<Vec<BridgeCall>>,
    extra: Mutex<Vec<(String, String)>>,
}

impl SessionBridge {
    pub fn new(session: Session, page_url: &str) -> Self {
        Self {
            extra: Mutex::new(Vec::new()),
            session,
            referer: page_url.to_string(),
            // Falls back to the page URL rather than inventing an origin: a
            // wrong `Origin` header is worse than a missing one.
            origin: origin_of(page_url).unwrap_or_else(|| page_url.to_string()),
            log: Mutex::new(Vec::new()),
        }
    }

    pub fn calls(&self) -> Vec<BridgeCall> {
        self.log.lock().unwrap().clone()
    }

    fn send<T: Default>(
        &self,
        method: &str,
        url: &str,
        body: &str,
        read: impl FnOnce(wreq::Response) -> std::pin::Pin<Box<dyn std::future::Future<Output = T> + Send>>
            + Send,
        err: impl Fn(String) -> T,
        len: impl Fn(&T) -> usize,
    ) -> (u16, T) {
        let fut = async {
            let mut req = if method.eq_ignore_ascii_case("POST") {
                self.session
                    .client
                    .post(url)
                    .header("content-type", veri_core::http::content_type_for(body))
                    .body(body.to_string())
            } else {
                self.session.client.get(url)
            };
            for (k, v) in self.extra.lock().unwrap().iter() {
                req = req.header(k.as_str(), v.as_str());
            }
            req = req
                .header("origin", self.origin.as_str())
                .header("referer", self.referer.as_str())
                .header("sec-fetch-dest", "empty")
                .header("sec-fetch-mode", "cors")
                .header("sec-fetch-site", "same-origin");
            match req.send().await {
                Ok(r) => {
                    let status = r.status().as_u16();
                    (status, read(r).await)
                }
                Err(e) => (0, err(format!("transport: {e}"))),
            }
        };
        let handle = match tokio::runtime::Handle::try_current() {
            Ok(h) => h,
            Err(_) => return (0, err("veri: no tokio runtime on this thread".to_string())),
        };
        if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::CurrentThread {
            return (
                0,
                err("veri: solving requires a multi-thread tokio runtime; \
                     #[tokio::main(flavor = \"current_thread\")] cannot drive a challenge"
                    .to_string()),
            );
        }
        let (status, out) = tokio::task::block_in_place(|| handle.block_on(fut));
        self.log.lock().unwrap().push(BridgeCall {
            method: method.to_ascii_uppercase(),
            url: url.to_string(),
            status,
            request_bytes: body.len(),
            response_bytes: len(&out),
        });
        (status, out)
    }
}

impl HttpBridge for SessionBridge {
    fn holds_cookie(&self, name: &str) -> bool {
        self.session.has_cookie(name)
    }

    fn request(&self, method: &str, url: &str, body: &str) -> (u16, String) {
        self.send(
            method,
            url,
            body,
            |r| Box::pin(async move { r.text().await.unwrap_or_default() }),
            |e| e,
            String::len,
        )
    }

    fn request_bytes(&self, method: &str, url: &str, body: &str) -> (u16, Vec<u8>) {
        self.send(
            method,
            url,
            body,
            |r| Box::pin(async move { r.bytes().await.map(|b| b.to_vec()).unwrap_or_default() }),
            |e| e.into_bytes(),
            Vec::len,
        )
    }

    fn request_with_headers(
        &self,
        method: &str,
        url: &str,
        body: &str,
        headers: &[(String, String)],
    ) -> (u16, String) {
        *self.extra.lock().unwrap() = headers.to_vec();
        let out = self.request(method, url, body);
        self.extra.lock().unwrap().clear();
        out
    }
}
