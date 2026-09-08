pub mod catalog;
pub mod credential_store;
pub mod db;
pub mod discovery;
pub mod events;
pub mod exclusions;
pub mod llm;
pub mod llm_config;
pub mod migration;
pub mod model;
pub mod privacy;
pub mod profile;
pub mod prompt;
pub mod provider;
pub mod rank;
pub mod recall;
pub mod rerank;
pub mod service;

pub use model::*;
pub use service::RecommendationService;

#[cfg(test)]
#[path = "__tests__/signals.rs"]
mod signal_tests;
