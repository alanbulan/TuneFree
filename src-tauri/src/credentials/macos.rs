use std::fs::{File, OpenOptions};
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;

use core_foundation::data::CFData;
use security_framework::item::{
    ItemAddOptions, ItemAddValue, ItemClass, ItemSearchOptions, ItemUpdateOptions, ItemUpdateValue,
    Limit, Location,
};
use security_framework::os::macos::keychain::{SecKeychain, SecPreferencesDomain};

use super::vault::{Backend, Manifest};
use super::CredentialKey;

const SERVICE: &str = "com.alanbulan.tunefree.credentials";
const ACCOUNT: &str = "application-vault-v1";
const NOT_FOUND: i32 = -25300;

pub(super) struct Keychain {
    suffix: String,
}

impl Keychain {
    pub(super) fn new() -> Self {
        Self {
            #[cfg(test)]
            suffix: format!(".tests-{}", std::process::id()),
            #[cfg(not(test))]
            suffix: String::new(),
        }
    }

    fn service(&self, service: &str) -> String {
        format!("{service}{}", self.suffix)
    }

    fn entry(&self, service: &str, account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service(service), account)
            .map_err(|_| "打开系统凭据失败".to_string())
    }

    fn query(&self, service: &str, account: &str) -> Result<ItemSearchOptions, String> {
        let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
            .map_err(|_| "打开系统钥匙串失败".to_string())?;
        let mut query = ItemSearchOptions::new();
        query
            .keychains(&[keychain])
            .class(ItemClass::generic_password())
            .service(&self.service(service))
            .account(account);
        Ok(query)
    }

    fn read(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        match self.entry(service, account)?.get_password() {
            Ok(raw) => Ok(Some(raw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("读取系统凭据失败，请检查钥匙串授权后手动重试".into()),
        }
    }

    fn remove(&self, service: &str, account: &str) -> Result<(), String> {
        match self.query(service, account)?.delete() {
            Ok(()) => Ok(()),
            Err(error) if error.code() == NOT_FOUND => Ok(()),
            Err(_) => Err("删除系统凭据失败，请检查钥匙串权限".into()),
        }
    }

    fn lock_path(&self) -> Result<PathBuf, String> {
        #[cfg(test)]
        return Ok(
            std::env::temp_dir().join(format!("tunefree-credential-vault{}.lock", self.suffix))
        );
        #[cfg(not(test))]
        {
            let user_home =
                std::env::var_os("HOME").ok_or_else(|| "无法确定凭据锁目录".to_string())?;
            let directory =
                PathBuf::from(user_home).join("Library/Application Support/com.alanbulan.tunefree");
            std::fs::create_dir_all(&directory).map_err(|_| "无法创建凭据锁目录".to_string())?;
            Ok(directory.join("credential-vault-v1.lock"))
        }
    }
}

impl Backend for Keychain {
    type Lock = File;

    fn lock(&self) -> Result<File, String> {
        // Only a synchronization lock is written to disk, never a secret.
        // Serialize separate app builds before merging a vault mutation.
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .mode(0o600)
            .open(self.lock_path()?)
            .map_err(|_| "无法建立凭据访问锁".to_string())?;
        file.lock().map_err(|_| "无法锁定凭据访问".to_string())?;
        Ok(file)
    }

    fn load(&self) -> Result<Option<String>, String> {
        log::info!("正在读取 TuneFree 统一钥匙串凭据");
        self.read(SERVICE, ACCOUNT)
    }

    fn manifest(&self) -> Result<Option<Manifest>, String> {
        let mut query = self.query(SERVICE, ACCOUNT)?;
        query
            .load_attributes(true)
            .load_data(false)
            .load_refs(false)
            .limit(Limit::Max(1));
        match query.search() {
            Ok(items) => {
                let raw = items
                    .first()
                    .and_then(|item| item.simplify_dict())
                    .and_then(|attrs| attrs.get("icmt").cloned())
                    .ok_or_else(|| "系统凭据元数据缺失，请检查账号或模型设置".to_string())?;
                serde_json::from_str(&raw)
                    .map(Some)
                    .map_err(|_| "系统凭据元数据格式异常".to_string())
            }
            Err(error) if error.code() == NOT_FOUND => Ok(None),
            Err(_) => Err("读取系统凭据状态失败".into()),
        }
    }

    fn save(&self, raw: &str, manifest: &Manifest) -> Result<(), String> {
        let comment =
            serde_json::to_string(manifest).map_err(|_| "凭据状态编码失败".to_string())?;
        let label = "TuneFree · 账号与模型密钥";
        let mut update = ItemUpdateOptions::new();
        update
            .set_value(ItemUpdateValue::Data(CFData::from_buffer(raw.as_bytes())))
            .set_comment(&comment)
            .set_label(label);
        let result = security_framework::item::update_item(&self.query(SERVICE, ACCOUNT)?, &update);
        match result {
            Ok(()) => Ok(()),
            Err(error) if error.code() == NOT_FOUND => {
                let keychain = SecKeychain::default_for_domain(SecPreferencesDomain::User)
                    .map_err(|_| "打开系统钥匙串失败".to_string())?;
                let mut add = ItemAddOptions::new(ItemAddValue::Data {
                    class: ItemClass::generic_password(),
                    data: CFData::from_buffer(raw.as_bytes()),
                });
                add.set_service(self.service(SERVICE))
                    .set_account_name(ACCOUNT)
                    .set_comment(&comment)
                    .set_label(label)
                    .set_location(Location::FileKeychain(keychain));
                add.add()
                    .map_err(|_| "保存系统凭据失败，请检查钥匙串权限".to_string())
            }
            Err(_) => Err("保存系统凭据失败，请检查钥匙串权限".into()),
        }
    }

    fn delete(&self) -> Result<(), String> {
        self.remove(SERVICE, ACCOUNT)
    }

    fn load_legacy(&self, key: CredentialKey) -> Result<Option<String>, String> {
        log::info!("正在迁移 TuneFree 旧凭据：{}", key.name());
        self.read(key.legacy_service(), key.name())
    }

    fn contains_legacy(&self, key: CredentialKey) -> Result<bool, String> {
        let mut query = self.query(key.legacy_service(), key.name())?;
        query
            .load_attributes(true)
            .load_data(false)
            .load_refs(false)
            .limit(Limit::Max(1));
        match query.search() {
            Ok(items) => Ok(!items.is_empty()),
            Err(error) if error.code() == NOT_FOUND => Ok(false),
            Err(_) => Err("读取旧凭据状态失败".into()),
        }
    }

    fn delete_legacy(&self, key: CredentialKey) -> Result<(), String> {
        self.remove(key.legacy_service(), key.name())
    }
}

#[cfg(test)]
#[path = "__tests__/macos.rs"]
mod tests;
