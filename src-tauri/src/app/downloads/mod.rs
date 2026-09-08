pub(crate) mod commands;
mod meta;
mod path;
pub(crate) mod transfer;

pub(crate) use meta::DownloadMetaStore;
pub(crate) use transfer::{DownloadClient, DownloadTaskRegistry};

#[cfg(all(test, windows))]
#[path = "__tests__/fixture.rs"]
mod test_fixture;
