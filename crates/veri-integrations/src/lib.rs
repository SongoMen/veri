//!
//! The integrations for the `veri` client.
//!
//! Each module classifies a response and, where the check is scripted, hands
//! the page to a [`veri_core::Solver`] and reports what came back. None of them
//! knows how a challenge works: they run the page and read the jar.
//!
//! Every provider name below is a trademark of its owner. These modules are not
//! affiliated with, endorsed by, or sponsored by any of them; the names
//! identify the systems they interoperate with.
//!
//! ```
//! use veri_integrations::{cloudflare, Cloudflare};
//!
//! // What a solver has to be told to clear this one.
//! assert_eq!(cloudflare::CONFIG_OBJECT, "_cf_chl_opt");
//! assert_eq!(cloudflare::CLEARANCE_COOKIE, "cf_clearance");
//!
//! let classify_only = Cloudflare::detect_only();
//! ```
//!
//! Registering one on a client, solver and all, is in
//! [the Rust client guide](https://github.com/songomen/veri/blob/main/docs/rust-client.md).
//!
//! The constants stay behind their module because every provider defines a
//! `CLEARANCE_COOKIE` and most define a `Config`. Only the protection types are
//! re-exported here, since those are unique.

pub mod awswaf;
pub mod cloudflare;
pub mod datadome;
pub mod perimeterx;
pub mod vercel;

pub use awswaf::AwsWaf;
pub use cloudflare::Cloudflare;
pub use datadome::DataDome;
pub use perimeterx::PerimeterX;
pub use vercel::Vercel;
