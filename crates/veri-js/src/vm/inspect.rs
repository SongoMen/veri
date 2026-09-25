//! Opt-in v8::inspector harness (env `VERI_INSPECT=1`), used to source signal
//! collectors whose inputs live in closure-scoped VM state the JS layer cannot
//! reach. Default builds never construct any of this — every entry point is
//! behind the flag in `solve()`, so the normal solver path is untouched.

use std::ptr::addr_of;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct Sink {
    pub responses: Vec<String>,
    pub notifications: Vec<String>,
}

pub struct Channel {
    base: v8::inspector::ChannelBase,
    sink: Arc<Mutex<Sink>>,
}

impl Channel {
    pub fn new(sink: Arc<Mutex<Sink>>) -> Self {
        Self { base: v8::inspector::ChannelBase::new::<Self>(), sink }
    }
}

impl v8::inspector::ChannelImpl for Channel {
    fn base(&self) -> &v8::inspector::ChannelBase {
        &self.base
    }
    fn base_mut(&mut self) -> &mut v8::inspector::ChannelBase {
        &mut self.base
    }
    unsafe fn base_ptr(this: *const Self) -> *const v8::inspector::ChannelBase {
        unsafe { addr_of!((*this).base) }
    }
    fn send_response(&mut self, _call_id: i32, message: v8::UniquePtr<v8::inspector::StringBuffer>) {
        if let Some(m) = message.as_ref() {
            self.sink.lock().unwrap().responses.push(m.string().to_string());
        }
    }
    fn send_notification(&mut self, message: v8::UniquePtr<v8::inspector::StringBuffer>) {
        if let Some(m) = message.as_ref() {
            self.sink.lock().unwrap().notifications.push(m.string().to_string());
        }
    }
    fn flush_protocol_notifications(&mut self) {}
}

pub struct Client {
    base: v8::inspector::V8InspectorClientBase,
    next_id: i64,
}

impl Client {
    pub fn new() -> Self {
        Self { base: v8::inspector::V8InspectorClientBase::new::<Self>(), next_id: 1 }
    }
}

impl v8::inspector::V8InspectorClientImpl for Client {
    fn base(&self) -> &v8::inspector::V8InspectorClientBase {
        &self.base
    }
    fn base_mut(&mut self) -> &mut v8::inspector::V8InspectorClientBase {
        &mut self.base
    }
    unsafe fn base_ptr(this: *const Self) -> *const v8::inspector::V8InspectorClientBase {
        unsafe { addr_of!((*this).base) }
    }
    fn generate_unique_id(&mut self) -> i64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }
}

pub fn dispatch(session: &mut v8::inspector::V8InspectorSession, msg: &str) {
    let bytes = msg.as_bytes();
    let view = v8::inspector::StringView::from(bytes);
    session.dispatch_protocol_message(view);
}

pub fn enabled() -> bool {
    std::env::var("VERI_INSPECT").is_ok()
}
