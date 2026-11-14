use super::*;
use std::cell::RefCell;

struct Store {
    value: RefCell<Option<String>>,
    corrupt: bool,
}
impl CredentialStore for Store {
    fn load(&self, _: Platform) -> CommandResult<Option<String>> {
        Ok(self.value.borrow().clone())
    }
    fn save(&self, _: Platform, value: &str) -> CommandResult<()> {
        *self.value.borrow_mut() = Some(if self.corrupt && value.starts_with('{') {
            "incorrect".into()
        } else {
            value.into()
        });
        Ok(())
    }
    fn delete(&self, _: Platform) -> CommandResult<()> {
        *self.value.borrow_mut() = None;
        Ok(())
    }
}

fn session() -> Session {
    super::super::netease::parse_account(
        serde_json::json!({"code":200,"profile":{"userId":123,"nickname":"fixture"}}),
        "MUSIC_U=fixture",
    )
    .unwrap()
}

#[test]
fn stores_verifies_and_rolls_back_failed_writes() {
    let store = Store {
        value: RefCell::new(None),
        corrupt: false,
    };
    save_verified(&store, Platform::Netease, &session()).unwrap();
    let loaded: Session = serde_json::from_str(store.value.borrow().as_deref().unwrap()).unwrap();
    assert_eq!(loaded.cookie, "MUSIC_U=fixture");
    for previous in [None, Some("old-session".into())] {
        let store = Store {
            value: RefCell::new(previous.clone()),
            corrupt: true,
        };
        assert_eq!(
            save_verified(&store, Platform::Netease, &session())
                .unwrap_err()
                .code,
            ErrorCode::CredentialUnavailable
        );
        assert_eq!(*store.value.borrow(), previous);
    }
}

#[test]
fn malformed_or_cross_platform_stored_cookie_is_rejected() {
    let mut value = session();
    assert!(super::super::cookies::valid_stored_session(
        Platform::Netease,
        &value
    ));
    assert!(!super::super::cookies::valid_stored_session(
        Platform::Qq,
        &value
    ));
    value.cookie = "MUSIC_U=fixture; tracking=not-allowed".into();
    assert!(!super::super::cookies::valid_stored_session(
        Platform::Netease,
        &value
    ));
}

#[cfg(any(windows, target_os = "macos"))]
#[test]
#[ignore = "writes isolated test sessions to the system credential store"]
fn native_account_session_store_round_trip() {
    let result = (|| {
        for platform in [Platform::Netease, Platform::Qq] {
            let session = if platform == Platform::Netease {
                session()
            } else {
                super::super::qq::parse_account(
                    serde_json::json!({"info":{"nick":"fixture","encryptUin":"test-euin"}}),
                    "qqmusic_uin=123; qqmusic_key=test-session",
                )?
            };
            save_verified(&SystemCredentials, platform, &session)?;
            let raw = SystemCredentials.load(platform)?.unwrap();
            let loaded: Session = serde_json::from_str(&raw)?;
            assert_eq!(loaded.cookie, session.cookie);
            assert!(super::super::cookies::valid_stored_session(
                platform, &loaded
            ));
            SystemCredentials.delete(platform)?;
            assert!(SystemCredentials.load(platform)?.is_none());
        }
        Ok::<(), CommandError>(())
    })();
    for platform in [Platform::Netease, Platform::Qq] {
        let _ = SystemCredentials.delete(platform);
    }
    result.unwrap();
}
