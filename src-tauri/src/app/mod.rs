mod bootstrap;
mod desktop_lyric;
mod desktop_lyric_bounds;
mod desktop_lyric_render;
mod downloads;
pub mod error;
mod recommendation_commands;
pub(crate) use recommendation_commands::run_recommendation_blocking;
mod smoke;
pub(crate) use smoke::{data_dir as smoke_data_dir, is_enabled as is_smoke_test};
mod system_commands;
mod updater;

pub use bootstrap::run;
