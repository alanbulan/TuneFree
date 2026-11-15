use std::sync::atomic::Ordering;

use super::credentials::{CredentialStore, SystemCredentials};
use super::{blocking, credentials, fetch_account, model::*, PlatformAccountState};
use crate::app::error::CommandResult;

impl PlatformAccountState {
    pub(super) async fn refresh_profile(
        &self,
        platform: Platform,
        previous: Session,
        revision: u64,
        store: impl CredentialStore + Send + 'static,
    ) -> CommandResult<PlatformAccount> {
        self.check_revision(platform, revision)?;
        let fetched = fetch_account(&self.0.client, platform, &previous.cookie).await;
        let mut session = match fetched {
            Ok(session) => session,
            Err(error) => {
                self.expire(platform, revision, &error);
                return Err(error);
            }
        };
        let _guard = self.0.operations.lock().await;
        self.check_revision(platform, revision)?;
        session.account.connected_at = previous.account.connected_at;
        // Portrait lookup is optional. A temporary profile-service failure
        // should not erase a portrait already saved for this same login.
        let latest = self.0.sessions.lock().get(&platform).cloned();
        if let Some(latest) =
            latest.filter(|value| value.account.user_id == session.account.user_id)
        {
            session.account.avatar_url = session.account.avatar_url.or(latest.account.avatar_url);
            session.encrypted_user_id = session.encrypted_user_id.or(latest.encrypted_user_id);
        }
        let to_save = session.clone();
        blocking(move || credentials::save_verified(&store, platform, &to_save)).await?;
        self.check_revision(platform, revision)?;
        let account = session.account.clone();
        self.0.sessions.lock().insert(platform, session);
        Ok(account)
    }

    fn claim_saved_profile_repairs(&self) -> Vec<(Platform, Session, u64)> {
        let sessions = self.0.sessions.lock();
        [Platform::Qq, Platform::Kuwo]
            .into_iter()
            .filter_map(|platform| {
                let session = sessions.get(&platform)?;
                if session.account.state != "saved"
                    || session.account.avatar_url.is_some()
                    || self.0.profile_repairs[platform.index()].swap(true, Ordering::SeqCst)
                {
                    return None;
                }
                Some((platform, session.clone(), self.revision(platform)))
            })
            .collect()
    }

    pub(super) async fn repair_saved_profiles(&self) {
        // Return the vault snapshot immediately. Portrait requests must not
        // delay the account page or repeatedly retry while offline.
        let repairs = {
            let _guard = self.0.operations.lock().await;
            self.claim_saved_profile_repairs()
        };
        for (platform, previous, revision) in repairs {
            let state = self.clone();
            tauri::async_runtime::spawn(async move {
                if state
                    .refresh_profile(platform, previous, revision, SystemCredentials)
                    .await
                    .is_ok()
                {
                    state.notify_account_changed(platform);
                }
            });
        }
    }
}

#[cfg(test)]
#[path = "__tests__/profiles.rs"]
mod tests;
