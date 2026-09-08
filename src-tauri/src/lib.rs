pub mod api;
mod app;
pub mod recommendation;
pub mod server;

pub use app::run;

#[cfg(all(test, any(windows, target_os = "macos")))]
#[path = "__tests__/support.rs"]
pub(crate) mod test_support;
